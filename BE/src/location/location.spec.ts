import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { vi } from 'vitest';
import type { PrismaService } from '../prisma.service.js';
import { AddressService, presentAddress } from '../address/address.service.js';
import { resolveDivision } from './location-catalog.js';
import {
  importCatalog,
  validateCatalog,
  type CatalogInput,
} from './location-import.js';

// Test-only fixture with invented names: NOT official catalogue data.
const fixture = (): CatalogInput => ({
  sourceRef: 'QA-FIXTURE-NOT-OFFICIAL',
  effectiveDate: '2025-07-01',
  sourceSha256: 'a'.repeat(64),
  provinces: [
    { code: '01', name: 'Tỉnh QA Một', kind: 'THANH_PHO' },
    { code: '02', name: 'Tỉnh QA Hai', kind: 'TINH' },
  ],
  wards: [
    { code: '00001', name: 'Phường QA A', kind: 'PHUONG', provinceCode: '01' },
    { code: '00002', name: 'Xã QA B', kind: 'XA', provinceCode: '02' },
    { code: '00003', name: 'Đặc khu QA C', kind: 'DAC_KHU', provinceCode: '02' },
  ],
});
const expected = { provinces: 2, wards: 3 };

describe('validateCatalog', () => {
  it('accepts a consistent catalogue and NFC-trims names', () => {
    const input = fixture();
    input.provinces[0]!.name = '  Tỉnh QA Một ';
    expect(validateCatalog(input, expected).provinces[0]!.name).toBe(
      'Tỉnh QA Một',
    );
  });
  it.each([
    ['bad sha', (c: CatalogInput) => (c.sourceSha256 = 'xyz')],
    ['bad date', (c: CatalogInput) => (c.effectiveDate = '2025-13-01')],
    ['empty source', (c: CatalogInput) => (c.sourceRef = ' ')],
    ['province code', (c: CatalogInput) => (c.provinces[0]!.code = '1')],
    ['ward code 4 digits', (c: CatalogInput) => (c.wards[0]!.code = '0001')],
    ['duplicate province', (c: CatalogInput) => (c.provinces[1]!.code = '01')],
    ['duplicate ward', (c: CatalogInput) => (c.wards[1]!.code = '00001')],
    ['province kind', (c: CatalogInput) => (c.provinces[0]!.kind = 'HUYEN')],
    ['ward kind', (c: CatalogInput) => (c.wards[0]!.kind = 'THI_TRAN')],
    ['unknown province', (c: CatalogInput) => (c.wards[0]!.provinceCode = '99')],
    ['empty name', (c: CatalogInput) => (c.wards[0]!.name = '  ')],
    ['province without ward', (c: CatalogInput) => c.wards.splice(0, 1)],
  ])('rejects %s', (_name, mutate) => {
    const input = fixture();
    mutate(input);
    expect(() =>
      validateCatalog(input, {
        provinces: input.provinces.length,
        wards: input.wards.length,
      }),
    ).toThrow('Catalog validation failed');
  });
  it('rejects counts that differ from the expectation (34/3321 for official)', () => {
    expect(() =>
      validateCatalog(fixture(), { provinces: 34, wards: 3321 }),
    ).toThrow(/province count 2 != 34.*ward count 3 != 3321/);
  });
});

describe('importCatalog', () => {
  it('inserts a new inactive version, rows, then switches the single active flag; never touches addresses', async () => {
    const calls: string[] = [];
    const tx = {
      adminDivisionVersion: {
        create: vi.fn(async (arg: { data: { isActive: boolean } }) => {
          calls.push('version.create:' + arg.data.isActive);
          return { id: 9 };
        }),
        updateMany: vi.fn(async () => {
          calls.push('deactivate');
          return { count: 1 };
        }),
        update: vi.fn(async () => {
          calls.push('activate');
          return {};
        }),
      },
      adminProvince: {
        createMany: vi.fn(async (arg: { data: unknown[] }) => {
          calls.push('provinces:' + arg.data.length);
          return { count: arg.data.length };
        }),
      },
      adminWard: {
        createMany: vi.fn(async (arg: { data: unknown[] }) => {
          calls.push('wards:' + arg.data.length);
          return { count: arg.data.length };
        }),
      },
      userAddress: new Proxy(
        {},
        {
          get() {
            throw new Error('import must not touch addresses');
          },
        },
      ),
    } as unknown as Prisma.TransactionClient;
    expect(await importCatalog(tx, fixture(), expected)).toEqual({
      versionId: 9,
    });
    expect(calls).toEqual([
      'version.create:false',
      'provinces:2',
      'wards:3',
      'deactivate',
      'activate',
    ]);
  });
  it('validates before any write', async () => {
    const create = vi.fn();
    const tx = {
      adminDivisionVersion: { create },
    } as unknown as Prisma.TransactionClient;
    await expect(
      importCatalog(tx, fixture(), { provinces: 34, wards: 3321 }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

function catalogTx(active: { id: number } | null) {
  return {
    adminDivisionVersion: {
      findFirst: vi.fn(async () =>
        active
          ? {
              id: active.id,
              sourceRef: 'QA-FIXTURE-NOT-OFFICIAL',
              effectiveDate: new Date('2025-07-01T00:00:00Z'),
            }
          : null,
      ),
    },
    adminWard: {
      findUnique: vi.fn(
        async (arg: { where: { versionId_code: { code: string } } }) =>
          arg.where.versionId_code.code === '00002'
            ? {
                code: '00002',
                name: 'Xã QA B',
                provinceCode: '02',
                province: { name: 'Tỉnh QA Hai' },
              }
            : null,
      ),
    },
  } as unknown as Prisma.TransactionClient;
}

describe('resolveDivision', () => {
  it('returns catalogue names for a ward inside the province', async () => {
    expect(await resolveDivision(catalogTx({ id: 3 }), '02', '00002')).toEqual(
      {
        divisionVersionId: 3,
        provinceCode: '02',
        province: 'Tỉnh QA Hai',
        wardCode: '00002',
        ward: 'Xã QA B',
      },
    );
  });
  it('rejects a ward from another province or unknown ward with 422', async () => {
    for (const [p, w] of [
      ['01', '00002'],
      ['02', '00009'],
    ])
      await expect(
        resolveDivision(catalogTx({ id: 3 }), p!, w!),
      ).rejects.toMatchObject({
        response: { statusCode: 422, code: 'ADDRESS_DIVISION_INVALID' },
      });
  });
  it('fails closed with 503 when no catalogue is loaded', async () => {
    await expect(
      resolveDivision(catalogTx(null), '02', '00002'),
    ).rejects.toMatchObject({
      response: { statusCode: 503, code: 'LOCATION_CATALOG_NOT_LOADED' },
    });
  });
});

describe('AddressService location rules (in-memory transaction)', () => {
  const row = {
    id: 1,
    recipientName: 'Buyer',
    phone: '0901234567',
    province: 'x',
    district: null,
    ward: 'y',
    addressLine: 'z',
    postalCode: null,
    deliveryNote: null,
    isDefault: true,
    provinceCode: null,
    wardCode: null,
    divisionVersionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  function setup(config: Record<string, string> = {}, active = { id: 3 }) {
    const writes: unknown[] = [];
    const tx = {
      ...catalogTx(active),
      $queryRaw: vi.fn(async () => []),
      user: {
        findUnique: vi.fn(async () => ({ isActive: true, role: 'USER' })),
      },
      userAddress: {
        count: vi.fn(async () => 0),
        updateMany: vi.fn(async () => ({ count: 0 })),
        findFirst: vi.fn(async () => ({ ...row })),
        create: vi.fn(async (arg: { data: Record<string, unknown> }) => {
          writes.push(arg.data);
          return { ...row, ...arg.data };
        }),
        update: vi.fn(async (arg: { data: Record<string, unknown> }) => {
          writes.push(arg.data);
          return { ...row, ...arg.data };
        }),
      },
    };
    const prisma = {
      $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
    } as unknown as PrismaService;
    return {
      service: new AddressService(prisma, new ConfigService(config)),
      writes,
    };
  }
  const base = {
    recipientName: 'Buyer',
    phone: '0901234567',
    addressLine: '12 Street',
  };

  it('codes: names come from the catalogue, client text ignored, district cleared', async () => {
    const { service, writes } = setup();
    const result = await service.create(1, {
      ...base,
      provinceCode: '02',
      wardCode: '00002',
      province: 'Client typed',
      ward: 'Client typed',
      district: 'Old district',
    });
    expect(writes[0]).toMatchObject({
      province: 'Tỉnh QA Hai',
      ward: 'Xã QA B',
      district: null,
      provinceCode: '02',
      wardCode: '00002',
      divisionVersionId: 3,
    });
    expect(result).toMatchObject({ divisionStatus: 'STANDARD' });
    expect(result).not.toHaveProperty('divisionVersionId');
  });
  it('codes must come as a pair', async () => {
    const { service } = setup();
    await expect(
      service.create(1, { ...base, provinceCode: '02' } as never),
    ).rejects.toMatchObject({
      response: { code: 'ADDRESS_DIVISION_INCOMPLETE' },
    });
  });
  it('legacy text is allowed by default and clears codes', async () => {
    const { service, writes } = setup();
    const result = await service.create(1, {
      ...base,
      province: 'HCM',
      ward: 'Ward',
    });
    expect(writes[0]).toMatchObject({
      province: 'HCM',
      provinceCode: null,
      wardCode: null,
      divisionVersionId: null,
    });
    expect(result).toMatchObject({ divisionStatus: 'LEGACY_FREE_TEXT' });
  });
  it('ADDRESS_CATALOG_REQUIRED=true rejects legacy text on create and on location edits, not on other edits', async () => {
    const { service, writes } = setup({ ADDRESS_CATALOG_REQUIRED: 'true' });
    await expect(
      service.create(1, { ...base, province: 'HCM', ward: 'Ward' }),
    ).rejects.toMatchObject({ response: { code: 'ADDRESS_DIVISION_REQUIRED' } });
    await expect(
      service.update(1, 1, { ward: 'Other' }),
    ).rejects.toMatchObject({ response: { code: 'ADDRESS_DIVISION_REQUIRED' } });
    await service.update(1, 1, { recipientName: 'New name' });
    expect(writes.at(-1)).toEqual({ recipientName: 'New name' });
  });
  it('update without location fields leaves location untouched', async () => {
    const { service, writes } = setup();
    await service.update(1, 1, { deliveryNote: 'Call' });
    expect(writes[0]).toEqual({ deliveryNote: 'Call' });
  });
  it('rejects invalid ADDRESS_CATALOG_REQUIRED at startup', () => {
    expect(
      () =>
        new AddressService(
          {} as PrismaService,
          new ConfigService({ ADDRESS_CATALOG_REQUIRED: 'yes' }),
        ),
    ).toThrow('ADDRESS_CATALOG_REQUIRED');
  });
  it('presentAddress marks STANDARD / OUTDATED / LEGACY_FREE_TEXT', () => {
    expect(presentAddress({ ...row, divisionVersionId: 3 }, 3).divisionStatus).toBe('STANDARD');
    expect(presentAddress({ ...row, divisionVersionId: 2 }, 3).divisionStatus).toBe('OUTDATED');
    expect(presentAddress({ ...row, divisionVersionId: 2 }, null).divisionStatus).toBe('OUTDATED');
    expect(presentAddress(row, 3).divisionStatus).toBe('LEGACY_FREE_TEXT');
  });
});
