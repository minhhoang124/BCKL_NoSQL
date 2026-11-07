import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StoreStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { SearchReconciliationService } from '../search/search-reconciliation.service.js';
import { CreateStoreDto } from './dto/create-store.dto.js';
import { ReviewStoreDto } from './dto/review-store.dto.js';
import { UpdateStoreDto } from './dto/update-store.dto.js';
import { onboardingEnabled } from './application-input.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { credentialMatches } from '../auth/credential-version.js';
import { UnauthorizedException } from '@nestjs/common';

@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchReconciliationService: SearchReconciliationService,
  ) {}

  async createForSeller(sellerId: number, dto: CreateStoreDto) {
    if (onboardingEnabled())
      throw new ConflictException({
        code: 'STORE_APPLICATION_WORKFLOW_REQUIRED',
      });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const store = await tx.store.create({
          data: {
            sellerId,
            name: dto.name.trim(),
            description: this.normalizeOptionalText(dto.description),
            status: StoreStatus.PENDING,
          },
        });
        await tx.storeStatusHistory.create({
          data: {
            storeId: store.id,
            fromStatus: null,
            toStatus: StoreStatus.PENDING,
            actorId: sellerId,
            reason: 'Seller tạo yêu cầu mở cửa hàng',
          },
        });
        return store;
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Tài khoản Seller đã có cửa hàng');
      }
      throw error;
    }
  }

  async getForSeller(sellerId: number) {
    const store = await this.prisma.store.findUnique({
      where: { sellerId },
      include: { statusHistory: { orderBy: { createdAt: 'asc' } }, application:{select:{revision:true}} },
    });
    if (!store) throw new NotFoundException('Seller chưa có cửa hàng');
    return store;
  }

  async getAllForAdmin() {
    return this.prisma.store.findMany({
      include: {
        seller: { select: { id: true, email: true, fullName: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        application:{select:{revision:true}},
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async updateForSeller(
    sellerId: number,
    dto: UpdateStoreDto,
    identity?: AuthenticatedUser,
  ) {
    if (dto.name === undefined && dto.description === undefined) {
      throw new BadRequestException('Cần ít nhất một trường để cập nhật');
    }

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`;
        // The same first-submit User latch closes the absent-Store TOCTOU gap.
        await tx.$queryRaw`SELECT id FROM users WHERE id=${sellerId} FOR UPDATE`;
        const owner = await tx.user.findUnique({ where: { id: sellerId } });
        if (
          !owner?.isActive ||
          owner.role !== 'SELLER' ||
          (identity &&
            !credentialMatches(
              identity.credentialVersion,
              owner.credentialVersion,
            ))
        )
          throw new UnauthorizedException();
        const current = await tx.store.findUnique({
          where: { sellerId },
          include: { application: { select: { storeId: true } } },
        });
        if (!current) throw new NotFoundException('Seller chưa có cửa hàng');
        await tx.$queryRaw`SELECT id FROM stores WHERE id=${current.id} FOR UPDATE`;
        const latest = await tx.store.findUniqueOrThrow({
          where: { id: current.id },
          include: { application: { select: { storeId: true } } },
        });
        if (latest.application)
          throw new ConflictException({
            code: 'STORE_APPLICATION_WORKFLOW_REQUIRED',
          });
        if (
          latest.status === StoreStatus.SUSPENDED ||
          latest.status === StoreStatus.CLOSED
        )
          throw new ForbiddenException(
            'Store đang bị khóa hoặc đã đóng, Seller không thể tự cập nhật',
          );
        return tx.store.update({
          where: { id: latest.id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined
              ? { description: this.normalizeOptionalText(dto.description) }
              : {}),
          },
        });
      },
      { maxWait: 2000, timeout: 5000 },
    );
  }

  async resubmit(sellerId: number) {
    return this.prisma.$transaction(async (tx) => {
      const store = await tx.store.findUnique({
        where: { sellerId },
        include: { application: { select: { storeId: true } } },
      });
      if (!store) throw new NotFoundException('Seller chưa có cửa hàng');
      if (store.application)
        throw new ConflictException({
          code: 'STORE_APPLICATION_WORKFLOW_REQUIRED',
        });
      if (store.status !== StoreStatus.REJECTED) {
        throw new ConflictException(
          'Chỉ Store bị từ chối mới được nộp lại để duyệt',
        );
      }
      const result = await tx.store.updateMany({
        where: { id: store.id, status: StoreStatus.REJECTED },
        data: { status: StoreStatus.PENDING },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'Trạng thái Store vừa thay đổi, yêu cầu nộp lại bị từ chối',
        );
      }
      await tx.storeStatusHistory.create({
        data: {
          storeId: store.id,
          fromStatus: StoreStatus.REJECTED,
          toStatus: StoreStatus.PENDING,
          actorId: sellerId,
          reason: 'Seller đã chỉnh sửa và nộp lại',
        },
      });
      return tx.store.findUniqueOrThrow({ where: { id: store.id } });
    });
  }

  async reviewByAdmin(storeId: number, adminId: number, dto: ReviewStoreDto) {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Mọi quyết định duyệt Store phải có lý do');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const store = await tx.store.findUnique({
        where: { id: storeId },
        include: { application: { select: { storeId: true } } },
      });
      if (!store) throw new NotFoundException('Không tìm thấy Store');
      if (store.application)
        throw new ConflictException({
          code: 'STORE_APPLICATION_WORKFLOW_REQUIRED',
        });
      if (!this.isAllowedAdminTransition(store.status, dto.status)) {
        throw new ConflictException(
          `Không thể chuyển Store từ ${store.status} sang ${dto.status}`,
        );
      }
      const result = await tx.store.updateMany({
        where: { id: store.id, status: store.status },
        data: { status: dto.status },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'Trạng thái Store vừa được request khác cập nhật',
        );
      }
      await tx.storeStatusHistory.create({
        data: {
          storeId: store.id,
          fromStatus: store.status,
          toStatus: dto.status,
          actorId: adminId,
          reason,
        },
      });
      const updatedStore = await tx.store.findUniqueOrThrow({
        where: { id: store.id },
      });
      const reconciliationJob =
        dto.status === StoreStatus.SUSPENDED ||
        dto.status === StoreStatus.ACTIVE
          ? await this.searchReconciliationService.enqueueStore(tx, store.id)
          : null;
      return { updatedStore, reconciliationJob };
    });
    return {
      ...result.updatedStore,
      searchReconciliation: result.reconciliationJob
        ? {
            jobId: result.reconciliationJob.id.toString(),
            status: result.reconciliationJob.status,
          }
        : null,
    };
  }

  private isAllowedAdminTransition(from: StoreStatus, to: StoreStatus) {
    return (
      (from === StoreStatus.PENDING &&
        (to === StoreStatus.ACTIVE || to === StoreStatus.REJECTED)) ||
      (from === StoreStatus.ACTIVE && to === StoreStatus.SUSPENDED) ||
      (from === StoreStatus.SUSPENDED && to === StoreStatus.ACTIVE)
    );
  }

  private normalizeOptionalText(value: string | null | undefined) {
    if (value == null) return null;
    const normalized = value.trim();
    return normalized.length ? normalized : null;
  }
}
