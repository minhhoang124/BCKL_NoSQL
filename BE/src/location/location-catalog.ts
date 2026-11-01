import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Official administrative catalogue (QĐ 19/2025/QĐ-TTg, effective 2025-07-01):
 * two levels, province (2 digits) and commune/ward (5 digits). Codes are the
 * stable identifiers; names always come from the imported catalogue.
 */
export const PROVINCE_CODE = /^[0-9]{2}$/;
export const WARD_CODE = /^[0-9]{5}$/;
export const PROVINCE_KINDS = ['THANH_PHO', 'TINH'] as const;
export const WARD_KINDS = ['PHUONG', 'XA', 'DAC_KHU'] as const;

export function locationError(status: number, code: string, message: string) {
  return new HttpException({ statusCode: status, code, message }, status);
}

export type ActiveCatalogVersion = {
  id: number;
  sourceRef: string;
  effectiveDate: string;
};

export async function activeCatalogVersion(
  tx: Prisma.TransactionClient,
): Promise<ActiveCatalogVersion | null> {
  const row = await tx.adminDivisionVersion.findFirst({
    where: { isActive: true },
    select: { id: true, sourceRef: true, effectiveDate: true },
  });
  return row
    ? {
        id: row.id,
        sourceRef: row.sourceRef,
        effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
      }
    : null;
}

export type ResolvedDivision = {
  divisionVersionId: number;
  provinceCode: string;
  province: string;
  wardCode: string;
  ward: string;
};

/**
 * Server-side pair check: the ward must belong to the province in the ACTIVE
 * catalogue. Never trusts names sent by the client.
 */
export async function resolveDivision(
  tx: Prisma.TransactionClient,
  provinceCode: string,
  wardCode: string,
): Promise<ResolvedDivision> {
  if (!PROVINCE_CODE.test(provinceCode) || !WARD_CODE.test(wardCode))
    throw locationError(
      400,
      'VALIDATION_ERROR',
      'Mã tỉnh/thành hoặc phường/xã không hợp lệ.',
    );
  const version = await activeCatalogVersion(tx);
  if (!version)
    throw locationError(
      503,
      'LOCATION_CATALOG_NOT_LOADED',
      'Danh mục địa giới chưa sẵn sàng. Vui lòng thử lại sau.',
    );
  const ward = await tx.adminWard.findUnique({
    where: { versionId_code: { versionId: version.id, code: wardCode } },
    select: {
      code: true,
      name: true,
      provinceCode: true,
      province: { select: { name: true } },
    },
  });
  if (!ward || ward.provinceCode !== provinceCode)
    throw locationError(
      422,
      'ADDRESS_DIVISION_INVALID',
      'Phường/xã không thuộc tỉnh/thành đã chọn.',
    );
  return {
    divisionVersionId: version.id,
    provinceCode,
    province: ward.province.name,
    wardCode: ward.code,
    ward: ward.name,
  };
}
