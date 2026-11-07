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
import {
  activeCatalogVersion,
  resolveDivision,
} from '../location/location-catalog.js';

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
  provinceCode: true,
  wardCode: true,
  divisionVersionId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserAddressSelect;

type AddressRow = Prisma.UserAddressGetPayload<{ select: typeof addressSelect }>;
type Db = Prisma.TransactionClient | PrismaService;

/** Never exposes the internal catalogue version id. */
export function presentAddress(row: AddressRow, activeVersionId: number | null) {
  const { divisionVersionId, ...rest } = row;
  return {
    ...rest,
    divisionStatus:
      divisionVersionId === null
        ? ('LEGACY_FREE_TEXT' as const)
        : divisionVersionId === activeVersionId
          ? ('STANDARD' as const)
          : ('OUTDATED' as const),
  };
}

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
    const required = config.get<string>('ADDRESS_CATALOG_REQUIRED', 'false');
    if (required !== 'true' && required !== 'false')
      throw new Error('ADDRESS_CATALOG_REQUIRED must be true or false');
    this.catalogRequired = required === 'true';
  }
  private readonly catalogRequired: boolean;

  private async present(db: Db, rows: AddressRow[]) {
    const active = rows.some((row) => row.divisionVersionId !== null)
      ? ((await activeCatalogVersion(db))?.id ?? null)
      : null;
    return rows.map((row) => presentAddress(row, active));
  }

  /**
   * Location fields: codes => names from the active catalogue (server-checked
   * pair, district cleared); text => legacy free text with codes cleared, only
   * while ADDRESS_CATALOG_REQUIRED=false. Untouched on updates without either.
   */
  private async location(
    tx: Prisma.TransactionClient,
    dto: CreateAddressDto | UpdateAddressDto,
    isCreate: boolean,
  ) {
    const { provinceCode, wardCode, ...rest } = dto;
    if (provinceCode !== undefined || wardCode !== undefined) {
      if (typeof provinceCode !== 'string' || typeof wardCode !== 'string')
        throw addressError(
          400,
          'ADDRESS_DIVISION_INCOMPLETE',
          'Cần chọn cả tỉnh/thành và phường/xã.',
        );
      const division = await resolveDivision(tx, provinceCode, wardCode);
      return { ...rest, ...division, district: null };
    }
    const textTouched = [rest.province, rest.district, rest.ward].some(
      (value) => value !== undefined,
    );
    if (!isCreate && !textTouched) return rest;
    if (this.catalogRequired)
      throw addressError(
        400,
        'ADDRESS_DIVISION_REQUIRED',
        'Vui lòng chọn tỉnh/thành và phường/xã từ danh sách.',
      );
    return {
      ...rest,
      provinceCode: null,
      wardCode: null,
      divisionVersionId: null,
    };
  }

  async list(userId: number) {
    const rows = await this.prisma.userAddress.findMany({
      where: { userId },
      select: addressSelect,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    return { items: await this.present(this.prisma, rows) };
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
      const data = await this.location(tx, dto, true);
      if (isDefault) await this.clearDefault(tx, userId);
      const row = await tx.userAddress.create({
        data: { ...(data as CreateAddressDto), userId, isDefault },
        select: addressSelect,
      });
      return (await this.present(tx, [row]))[0]!;
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
      const data = await this.location(tx, dto, false);
      if (dto.isDefault === true) await this.clearDefault(tx, userId);
      const row = await tx.userAddress.update({
        where: { id: address.id },
        data,
        select: addressSelect,
      });
      return (await this.present(tx, [row]))[0]!;
    });
  }

  setDefault(userId: number, id: number) {
    return this.write(userId, async (tx) => {
      const address = await this.owned(tx, userId, id);
      if (address.isDefault) return (await this.present(tx, [address]))[0]!;
      await this.clearDefault(tx, userId);
      const row = await tx.userAddress.update({
        where: { id: address.id },
        data: { isDefault: true },
        select: addressSelect,
      });
      return (await this.present(tx, [row]))[0]!;
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
