import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { SearchReconciliationService } from '../search/search-reconciliation.service.js';
import { CreateBrandDto } from './dto/create-brand.dto.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateBrandDto } from './dto/update-brand.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { CreateCategoryAttributeDto } from './dto/create-category-attribute.dto.js';
import { UpdateCategoryAttributeDto } from './dto/update-category-attribute.dto.js';

type CategoryRow = {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
};

type CategoryNode = CategoryRow & {
  isLeaf: boolean;
  children: CategoryNode[];
};

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchReconciliationService: SearchReconciliationService,
  ) {}

  async getAllCategories() {
    return this.prisma.category.findMany({
      select: {
        id: true,
        parentId: true,
        name: true,
        slug: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async getAllBrands() {
    return this.prisma.brand.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async getActiveCategoryTree(): Promise<CategoryNode[]> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, parentId: true, name: true, slug: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const byId = new Map<number, CategoryNode>(
      rows.map((row) => [row.id, { ...row, isLeaf: true, children: [] }]),
    );
    const roots: CategoryNode[] = [];
    for (const row of rows) {
      const node = byId.get(row.id)!;
      if (row.parentId === null) {
        roots.push(node);
        continue;
      }
      const parent = byId.get(row.parentId);
      if (parent) {
        parent.children.push(node);
        parent.isLeaf = false;
      }
    }
    return roots;
  }

  async getActiveBrands() {
    return this.prisma.brand.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async getCategoryAttributes(categoryId: number) {
    await this.assertPublicCategoryPath(categoryId);
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        attributeDefinitions: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            slug: true,
            dataType: true,
            isRequired: true,
            isFilterable: true,
            allowsCustom: true,
            sortOrder: true,
            options: {
              where: { isActive: true },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              select: { id: true, value: true, slug: true, sortOrder: true },
            },
          },
        },
      },
    });
    if (!category) throw new NotFoundException('Không tìm thấy danh mục');
    return category;
  }

  async createCategory(dto: CreateCategoryDto) {
    await this.assertActiveParent(dto.parentId);
    try {
      return await this.prisma.category.create({
        data: {
          name: dto.name.trim(),
          slug: dto.slug,
          parentId: dto.parentId ?? null,
        },
      });
    } catch (error: unknown) {
      this.rethrowCatalogError(error, 'Slug danh mục đã tồn tại');
    }
  }

  async updateCategory(categoryId: number, dto: UpdateCategoryDto) {
    if (
      dto.name === undefined &&
      dto.slug === undefined &&
      dto.parentId === undefined &&
      dto.isActive === undefined
    ) {
      throw new BadRequestException('Cần ít nhất một trường để cập nhật');
    }
    if (dto.parentId !== undefined) {
      await this.assertValidCategoryParent(categoryId, dto.parentId);
    } else if (dto.isActive === true) {
      const category = await this.prisma.category.findUnique({
        where: { id: categoryId },
        select: { parentId: true },
      });
      if (!category) throw new NotFoundException('Không tìm thấy bản ghi');
      await this.assertActiveParent(category.parentId);
    }
    if (dto.isActive === false) {
      await this.assertCategoryCanDeactivate(categoryId);
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.category.update({
          where: { id: categoryId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
            ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        });
        const job =
          dto.name !== undefined ||
          dto.parentId !== undefined ||
          dto.isActive !== undefined
            ? await this.searchReconciliationService.enqueueCategory(
                tx,
                categoryId,
              )
            : null;
        return {
          ...updated,
          searchReconciliation: job
            ? { jobId: job.id.toString(), status: job.status }
            : null,
        };
      });
    } catch (error: unknown) {
      this.rethrowCatalogError(error, 'Slug danh mục đã tồn tại');
    }
  }

  deactivateCategory(categoryId: number) {
    return this.updateCategory(categoryId, { isActive: false });
  }

  async createCategoryAttribute(
    categoryId: number,
    dto: CreateCategoryAttributeDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.category.findUniqueOrThrow({ where: { id: categoryId } });
      const definition = await tx.categoryAttributeDefinition.create({
        data: {
          categoryId,
          name: dto.name,
          slug: dto.slug,
          dataType: dto.dataType,
          isRequired: dto.isRequired ?? false,
          isFilterable: dto.isFilterable ?? false,
          allowsCustom: dto.allowsCustom ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      const job =
        definition.isActive && definition.isRequired
          ? await this.searchReconciliationService.enqueueCategory(
              tx,
              categoryId,
            )
          : null;
      return {
        ...definition,
        searchReconciliation: job
          ? { jobId: job.id.toString(), status: job.status }
          : null,
      };
    });
  }

  async updateCategoryAttribute(
    categoryId: number,
    attributeId: number,
    dto: UpdateCategoryAttributeDto,
  ) {
    if (!Object.values(dto).some((value) => value !== undefined)) {
      throw new BadRequestException('Cần ít nhất một trường để cập nhật');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.categoryAttributeDefinition.findFirstOrThrow({
        where: { id: attributeId, categoryId },
      });
      const definition = await tx.categoryAttributeDefinition.update({
        where: { id: attributeId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.dataType !== undefined ? { dataType: dto.dataType } : {}),
          ...(dto.isRequired !== undefined
            ? { isRequired: dto.isRequired }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.allowsCustom !== undefined
            ? { allowsCustom: dto.allowsCustom }
            : {}),
        },
      });
      const job = await this.searchReconciliationService.enqueueCategory(
        tx,
        categoryId,
      );
      return {
        ...definition,
        searchReconciliation: { jobId: job.id.toString(), status: job.status },
      };
    });
  }

  async createBrand(dto: CreateBrandDto) {
    try {
      return await this.prisma.brand.create({
        data: { name: dto.name.trim(), slug: dto.slug },
      });
    } catch (error: unknown) {
      this.rethrowCatalogError(error, 'Slug thương hiệu đã tồn tại');
    }
  }

  async updateBrand(brandId: number, dto: UpdateBrandDto) {
    if (
      dto.name === undefined &&
      dto.slug === undefined &&
      dto.isActive === undefined
    ) {
      throw new BadRequestException('Cần ít nhất một trường để cập nhật');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.brand.update({
          where: { id: brandId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        });
        const job =
          dto.name !== undefined || dto.isActive !== undefined
            ? await this.searchReconciliationService.enqueueBrand(tx, brandId)
            : null;
        return {
          ...updated,
          searchReconciliation: job
            ? { jobId: job.id.toString(), status: job.status }
            : null,
        };
      });
    } catch (error: unknown) {
      this.rethrowCatalogError(error, 'Slug thương hiệu đã tồn tại');
    }
  }

  deactivateBrand(brandId: number) {
    return this.updateBrand(brandId, { isActive: false });
  }

  private async assertActiveParent(parentId: number | null | undefined) {
    if (parentId == null) return;
    let cursor: number | null = parentId;
    const visited = new Set<number>();
    while (cursor !== null) {
      if (visited.has(cursor)) {
        throw new BadRequestException('Cây danh mục hiện tại có chu kỳ');
      }
      visited.add(cursor);
      const category: { parentId: number | null; isActive: boolean } | null =
        await this.prisma.category.findUnique({
          where: { id: cursor },
          select: { parentId: true, isActive: true },
        });
      if (!category?.isActive) {
        throw new BadRequestException('Danh mục cha không hợp lệ');
      }
      cursor = category.parentId;
    }
  }

  private async assertPublicCategoryPath(categoryId: number) {
    let cursor: number | null = categoryId;
    const visited = new Set<number>();
    while (cursor !== null) {
      if (visited.has(cursor))
        throw new NotFoundException('Không tìm thấy danh mục');
      visited.add(cursor);
      const category: { parentId: number | null; isActive: boolean } | null =
        await this.prisma.category.findUnique({
          where: { id: cursor },
          select: { parentId: true, isActive: true },
        });
      if (!category?.isActive) {
        throw new NotFoundException('Không tìm thấy danh mục');
      }
      cursor = category.parentId;
    }
  }

  private async assertCategoryCanDeactivate(categoryId: number) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, isActive: true },
    });
    if (!category) throw new NotFoundException('Không tìm thấy bản ghi');
    if (!category.isActive) return;

    const [activeChildren, referencedProducts] = await Promise.all([
      this.prisma.category.count({
        where: { parentId: categoryId, isActive: true },
      }),
      this.prisma.product.count({ where: { categoryId } }),
    ]);
    if (activeChildren > 0) {
      throw new ConflictException(
        'Không thể tắt danh mục khi còn danh mục con đang hoạt động',
      );
    }
    if (referencedProducts > 0) {
      throw new ConflictException(
        'Không thể tắt danh mục khi còn sản phẩm tham chiếu; hãy chuyển sản phẩm sang danh mục khác trước',
      );
    }
  }

  private async assertValidCategoryParent(
    categoryId: number,
    parentId: number | null,
  ) {
    if (parentId === null) return;
    if (parentId === categoryId)
      throw new BadRequestException('Danh mục không thể là cha của chính nó');
    await this.assertActiveParent(parentId);
    let cursor: number | null = parentId;
    const visited = new Set<number>();
    while (cursor !== null) {
      if (cursor === categoryId)
        throw new BadRequestException('Quan hệ danh mục tạo thành chu kỳ');
      if (visited.has(cursor))
        throw new BadRequestException('Cây danh mục hiện tại có chu kỳ');
      visited.add(cursor);
      const ancestor: { parentId: number | null } | null =
        await this.prisma.category.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = ancestor?.parentId ?? null;
    }
  }

  private rethrowCatalogError(error: unknown, conflictMessage: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new ConflictException(conflictMessage);
      if (error.code === 'P2025')
        throw new NotFoundException('Không tìm thấy bản ghi');
    }
    throw error;
  }
}
