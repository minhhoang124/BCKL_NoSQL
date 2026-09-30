import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type ProductModerationStatus,
  type ProductSellerStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { ProductImageStorageService } from './product-image-storage.service.js';
import {
  ProductPageDto,
  ProductVisibilityDto,
  PublicProductQueryDto,
} from './dto/product-lifecycle.dto.js';
import {
  isPublicListing,
  listingInclude,
  listingProblems,
  publicProduct,
} from './product-public-policy.js';

@Injectable()
export class ProductLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ProductImageStorageService,
  ) {}

  async reviewQueue(query: ProductPageDto) {
    const rows = await this.prisma.product.findMany({
      where: {
        moderationStatus: 'PENDING',
        ...(query.afterId ? { id: { gt: query.afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      select: {
        id: true,
        name: true,
        storeId: true,
        version: true,
        submittedAt: true,
        sellerStatus: true,
        moderationStatus: true,
      },
    });
    return {
      items: rows.slice(0, query.limit),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
    };
  }

  async reviewDetail(productId: number) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        ...listingInclude,
        statusHistory: { orderBy: { version: 'desc' } },
      },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
    return product;
  }

  async moderate(
    productId: number,
    actorId: number,
    version: number,
    decision: 'APPROVED' | 'REJECTED' | 'FROZEN',
    reason?: string,
  ) {
    // Same process lock as image publish/compensation prevents approval of an
    // uploaded image whose publish is still in flight. DB version is authoritative.
    return this.images.withProductImageLock(productId, () =>
      this.transaction(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: productId },
          include: listingInclude,
        });
        if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
        if (product.version !== version)
          throw new ConflictException(
            'Phiên bản đã thay đổi; tải lại sản phẩm trước khi duyệt',
          );
        const expected = decision === 'FROZEN' ? 'APPROVED' : 'PENDING';
        if (product.moderationStatus !== expected)
          throw new ConflictException(
            'Trạng thái không cho phép quyết định này',
          );
        if (decision === 'APPROVED') {
          const problems = listingProblems(
            product,
            await tx.category.findMany({
              select: { id: true, parentId: true, isActive: true },
            }),
          );
          if (problems.length)
            throw new BadRequestException(problems.join('; '));
        }
        const updated = await tx.product.updateMany({
          where: { id: productId, version, moderationStatus: expected },
          data: {
            moderationStatus: decision,
            rejectionReason: reason ?? null,
            reviewedAt: new Date(),
            reviewedBy: actorId,
            version: { increment: 1 },
          },
        });
        if (!updated.count)
          throw new ConflictException('Sản phẩm vừa được cập nhật');
        await this.history(
          tx,
          product,
          actorId,
          product.sellerStatus,
          decision,
          reason,
        );
        return tx.product.findUniqueOrThrow({ where: { id: productId } });
      }),
    );
  }

  async visibility(
    productId: number,
    sellerId: number,
    dto: ProductVisibilityDto,
  ) {
    return this.images.withProductImageLock(productId, () =>
      this.transaction(async (tx) => {
        const product = await tx.product.findFirst({
          where: { id: productId, store: { sellerId } },
          include: listingInclude,
        });
        if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
        if (product.version !== dto.version)
          throw new ConflictException(
            'Phiên bản đã thay đổi; tải lại sản phẩm',
          );
        if (
          product.moderationStatus !== 'APPROVED' ||
          product.sellerStatus === 'DRAFT'
        )
          throw new ForbiddenException('Chỉ ẩn/hiện sản phẩm đã duyệt');
        // Hiding is allowed even when the Store is suspended; showing is not.
        if (dto.sellerStatus === 'ACTIVE') {
          const problems = listingProblems(
            product,
            await tx.category.findMany({
              select: { id: true, parentId: true, isActive: true },
            }),
          );
          if (problems.length)
            throw new BadRequestException(problems.join('; '));
        }
        if (product.sellerStatus === dto.sellerStatus)
          return tx.product.findUniqueOrThrow({ where: { id: productId } });
        const updated = await tx.product.updateMany({
          where: {
            id: productId,
            version: dto.version,
            moderationStatus: 'APPROVED',
          },
          data: { sellerStatus: dto.sellerStatus, version: { increment: 1 } },
        });
        if (!updated.count)
          throw new ConflictException('Sản phẩm vừa được cập nhật');
        await this.history(
          tx,
          product,
          sellerId,
          dto.sellerStatus,
          product.moderationStatus,
        );
        return tx.product.findUniqueOrThrow({ where: { id: productId } });
      }),
    );
  }

  async publicList(query: PublicProductQueryDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const categories = await tx.category.findMany({
          select: { id: true, parentId: true, isActive: true },
        });
        const categoryIds = query.categoryId
          ? this.categorySubtreeIds(query.categoryId, categories)
          : undefined;

        // An unknown category, or a category outside the active tree, has no
        // public descendants. Return an empty page instead of falling back to
        // an unfiltered listing.
        if (query.categoryId && !categoryIds?.length)
          return { items: [], nextCursor: null };

        // Bound DB work to 200 candidates/request. nextCursor can continue an
        // empty page when all candidates fail dynamic required-attribute checks.
        const rows = await tx.product.findMany({
          where: {
            sellerStatus: 'ACTIVE',
            moderationStatus: 'APPROVED',
            store: { status: 'ACTIVE', seller: { isActive: true } },
            ...(query.afterId ? { id: { gt: query.afterId } } : {}),
            ...(query.storeId ? { storeId: query.storeId } : {}),
            ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
            ...(query.brandId ? { brandId: query.brandId } : {}),
          },
          include: listingInclude,
          orderBy: { id: 'asc' },
          take: 200,
        });
        const items: ReturnType<typeof publicProduct>[] = [];
        for (let i = 0; i < rows.length; i++) {
          if (isPublicListing(rows[i], categories)) {
            const product = publicProduct(rows[i]);
            if (
              query.inStock === undefined ||
              product.inStock === query.inStock
            )
              items.push(product);
          }
          if (items.length === query.limit)
            return {
              items,
              nextCursor:
                i < rows.length - 1 || rows.length === 200 ? rows[i].id : null,
            };
        }
        return { items, nextCursor: rows.length === 200 ? rows[199].id : null };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private categorySubtreeIds(
    rootId: number,
    categories: Array<{
      id: number;
      parentId: number | null;
      isActive: boolean;
    }>,
  ): number[] {
    const nodes = new Map(
      categories.map((category) => [category.id, category]),
    );
    if (!nodes.get(rootId)?.isActive) return [];

    const children = new Map<number, number[]>();
    for (const category of categories) {
      if (!category.isActive || category.parentId === null) continue;
      const siblings = children.get(category.parentId) ?? [];
      siblings.push(category.id);
      children.set(category.parentId, siblings);
    }

    const result: number[] = [];
    const pending = [rootId];
    const visited = new Set<number>();
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      result.push(id);
      pending.push(...(children.get(id) ?? []));
    }
    return result;
  }

  async publicDetail(productId: number) {
    return this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: productId },
          include: listingInclude,
        });
        const categories = await tx.category.findMany({
          select: { id: true, parentId: true, isActive: true },
        });
        if (!product || !isPublicListing(product, categories))
          throw new NotFoundException('Không tìm thấy sản phẩm');
        return publicProduct(product);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private history(
    tx: Prisma.TransactionClient,
    product: {
      id: number;
      version: number;
      sellerStatus: ProductSellerStatus;
      moderationStatus: ProductModerationStatus;
    },
    actorId: number,
    sellerStatus: ProductSellerStatus,
    moderationStatus: ProductModerationStatus,
    reason?: string,
  ) {
    return tx.productStatusHistory.create({
      data: {
        productId: product.id,
        actorId,
        version: product.version + 1,
        fromSellerStatus: product.sellerStatus,
        toSellerStatus: sellerStatus,
        fromModerationStatus: product.moderationStatus,
        toModerationStatus: moderationStatus,
        reason,
      },
    });
  }

  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            'Phiên bản đã có lịch sử xử lý; tải lại sản phẩm',
          );
        }
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          if (attempt < 2) continue;
          throw new ConflictException(
            'Cập nhật đồng thời; vui lòng tải lại sản phẩm',
          );
        }
        throw error;
      }
    }
    throw new ConflictException();
  }
}
