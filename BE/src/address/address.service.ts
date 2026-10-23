import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { canActAsBuyer } from '../auth/buyer-access.js';
import { PrismaService } from '../prisma.service.js';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from '../product/transaction-conflict.js';
import { CreateAddressDto, UpdateAddressDto } from './address.dto.js';
import { addressError } from './address-http.js';

const addressSelect = {
  id: true,
  recipientName: true,
  phone: true,
  province: true,
  district: true,
  ward: true,
  addressLine: true,
  postalCode: true,
  deliveryNote: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserAddressSelect;

@Injectable()
export class AddressService {
  private readonly maxAddresses: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.maxAddresses = Number(
      config.get<string>('ADDRESS_MAX_PER_USER', '20'),
    );
    if (!Number.isSafeInteger(this.maxAddresses) || this.maxAddresses < 1)
      throw new Error('ADDRESS_MAX_PER_USER must be a positive integer');
  }

  async list(userId: number) {
    return {
      items: await this.prisma.userAddress.findMany({
        where: { userId },
        select: addressSelect,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
    };
  }

  create(userId: number, dto: CreateAddressDto) {
    return this.write(userId, async (tx) => {
      const count = await tx.userAddress.count({ where: { userId } });
      if (count >= this.maxAddresses)
        throw addressError(
          409,
          'ADDRESS_LIMIT_REACHED',
          'Đã đạt giới hạn địa chỉ.',
        );
      const isDefault = count === 0 || dto.isDefault === true;
      if (isDefault) await this.clearDefault(tx, userId);
      return tx.userAddress.create({
        data: { ...dto, userId, isDefault },
        select: addressSelect,
      });
    });
  }

  update(userId: number, id: number, dto: UpdateAddressDto) {
    if (!Object.values(dto).some((value) => value !== undefined))
      throw addressError(
        400,
        'VALIDATION_ERROR',
        'Cần gửi ít nhất một trường hợp lệ.',
      );
    return this.write(userId, async (tx) => {
      const address = await this.owned(tx, userId, id);
      if (address.isDefault && dto.isDefault === false)
        throw addressError(
          409,
          'DEFAULT_ADDRESS_CANNOT_BE_UNSET',
          'Hãy chọn địa chỉ mặc định khác hoặc xóa địa chỉ này.',
        );
      if (dto.isDefault === true) await this.clearDefault(tx, userId);
      return tx.userAddress.update({
        where: { id: address.id },
        data: dto,
        select: addressSelect,
      });
    });
  }

  setDefault(userId: number, id: number) {
    return this.write(userId, async (tx) => {
      const address = await this.owned(tx, userId, id);
      if (address.isDefault) return address;
      await this.clearDefault(tx, userId);
      return tx.userAddress.update({
        where: { id: address.id },
        data: { isDefault: true },
        select: addressSelect,
      });
    });
  }

  remove(userId: number, id: number) {
    return this.write(userId, async (tx) => {
      const address = await this.owned(tx, userId, id);
      await tx.userAddress.delete({ where: { id: address.id } });
      if (address.isDefault) {
        const next = await tx.userAddress.findFirst({
          where: { userId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (next)
          await tx.userAddress.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
      }
    });
  }

  private async owned(
    tx: Prisma.TransactionClient,
    userId: number,
    id: number,
  ) {
    const address = await tx.userAddress.findFirst({
      where: { id, userId },
      select: addressSelect,
    });
    if (!address)
      throw addressError(404, 'ADDRESS_NOT_FOUND', 'Không tìm thấy địa chỉ.');
    return address;
  }

  private clearDefault(tx: Prisma.TransactionClient, userId: number) {
    return tx.userAddress.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  private async write<T>(
    userId: number,
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // Stable DB lock exists even for the first address; works across replicas.
            // READ COMMITTED reads the latest rows after waiting for this lock.
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
            const user = await tx.user.findUnique({
              where: { id: userId },
              select: { isActive: true, role: true },
            });
            if (!user?.isActive)
              throw addressError(
                401,
                'UNAUTHORIZED',
                'Vui lòng đăng nhập lại.',
              );
            if (!canActAsBuyer(user.role))
              throw addressError(
                403,
                'FORBIDDEN',
                'Chỉ tài khoản người mua được quản lý địa chỉ.',
              );
            return action(tx);
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 5000,
            timeout: 10000,
          },
        );
      } catch (error) {
        if (!isTransactionConflict(error)) throw error;
        if (attempt === 4)
          throw addressError(
            409,
            'ADDRESS_WRITE_CONFLICT',
            'Địa chỉ đang được cập nhật. Vui lòng thử lại.',
          );
        await waitForTransactionRetry(attempt);
      }
    }
    throw new Error('Unreachable transaction retry state');
  }
}
