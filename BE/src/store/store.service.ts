import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StoreStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { CreateStoreDto } from './dto/create-store.dto.js';
import { ReviewStoreDto } from './dto/review-store.dto.js';
import { UpdateStoreDto } from './dto/update-store.dto.js';

@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  async createForSeller(sellerId: number, dto: CreateStoreDto) {
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
      include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
    });
    if (!store) throw new NotFoundException('Seller chưa có cửa hàng');
    return store;
  }

  async getAllForAdmin() {
    return this.prisma.store.findMany({
      include: {
        seller: { select: { id: true, email: true, fullName: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async updateForSeller(sellerId: number, dto: UpdateStoreDto) {
    if (dto.name === undefined && dto.description === undefined) {
      throw new BadRequestException('Cần ít nhất một trường để cập nhật');
    }

    const result = await this.prisma.store.updateMany({
      where: {
        sellerId,
        status: {
          in: [StoreStatus.PENDING, StoreStatus.REJECTED, StoreStatus.ACTIVE],
        },
      },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: this.normalizeOptionalText(dto.description) }
          : {}),
      },
    });
    if (result.count === 0) {
      const current = await this.prisma.store.findUnique({
        where: { sellerId },
        select: { status: true },
      });
      if (!current) throw new NotFoundException('Seller chưa có cửa hàng');
      if (
        current.status === StoreStatus.SUSPENDED ||
        current.status === StoreStatus.CLOSED
      ) {
        throw new ForbiddenException(
          'Store đang bị khóa hoặc đã đóng, Seller không thể tự cập nhật',
        );
      }
      throw new ConflictException(
        'Trạng thái Store vừa thay đổi, vui lòng tải lại và thử lại',
      );
    }
    return this.prisma.store.findUniqueOrThrow({ where: { sellerId } });
  }

  async resubmit(sellerId: number) {
    return this.prisma.$transaction(async (tx) => {
      const store = await tx.store.findUnique({ where: { sellerId } });
      if (!store) throw new NotFoundException('Seller chưa có cửa hàng');
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

    return this.prisma.$transaction(async (tx) => {
      const store = await tx.store.findUnique({ where: { id: storeId } });
      if (!store) throw new NotFoundException('Không tìm thấy Store');
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
      return tx.store.findUniqueOrThrow({ where: { id: store.id } });
    });
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
