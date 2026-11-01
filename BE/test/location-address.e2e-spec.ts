import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import {
  importCatalog,
  type CatalogInput,
} from '../src/location/location-import.js';

// Fixture catalogue with invented names, imported ONLY into a fresh QA DB
// that has no active catalogue. It is never official data.
const fixture = (suffix: string): CatalogInput => ({
  sourceRef: 'QA-FIXTURE-NOT-OFFICIAL',
  effectiveDate: '2025-07-01',
  sourceSha256: randomBytes(32).toString('hex'),
  provinces: [
    { code: '01', name: `Thành phố QA ${suffix}`, kind: 'THANH_PHO' },
    { code: '02', name: `Tỉnh QA ${suffix}`, kind: 'TINH' },
  ],
  wards: [
    { code: '00001', name: `Phường QA A ${suffix}`, kind: 'PHUONG', provinceCode: '01' },
    { code: '00002', name: `Phường QA B ${suffix}`, kind: 'PHUONG', provinceCode: '01' },
    { code: '00003', name: `Xã QA C ${suffix}`, kind: 'XA', provinceCode: '02' },
  ],
});

describe('Location catalogue + coded addresses — HTTP/PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let buyerId: number;
  const marker = `location-e2e-${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const post = (body: object) =>
    http().post('/me/addresses').set('Authorization', token).send(body);
  const base = {
    recipientName: 'QA Buyer',
    phone: '0901234567',
    addressLine: '12 QA Street',
  };

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    // Never activate a fixture over a real catalogue.
    if (await prisma.adminDivisionVersion.count())
      throw new Error('Location e2e requires a fresh QA DB without catalogue');
    const user = await prisma.user.create({
      data: {
        email: `${marker}@example.test`,
        passwordHash: 'fixture-only',
        role: Role.USER,
      },
    });
    buyerId = user.id;
    const config = app.get(ConfigService);
    token =
      'Bearer ' +
      app.get(JwtService).sign(
        { sub: user.id, email: user.email, role: Role.USER, type: 'access' },
        {
          secret: config.getOrThrow('JWT_ACCESS_SECRET'),
          issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
          audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
          expiresIn: '10m',
        },
      );
  });
  afterAll(async () => {
    await app?.close();
  });

  it('without a catalogue: lookups 503, coded address 503, legacy text still works', async () => {
    const provinces = await http().get('/locations/provinces').expect(503);
    expect(provinces.body.code).toBe('LOCATION_CATALOG_NOT_LOADED');
    expect(
      (await post({ ...base, provinceCode: '01', wardCode: '00001' }).expect(503))
        .body.code,
    ).toBe('LOCATION_CATALOG_NOT_LOADED');
    const legacy = await post({
      ...base,
      phone: '+84 90 123 4567',
      province: 'Typed province',
      district: 'Typed district',
      ward: 'Typed ward',
    }).expect(201);
    expect(legacy.body).toMatchObject({
      phone: '0901234567',
      province: 'Typed province',
      district: 'Typed district',
      provinceCode: null,
      wardCode: null,
      divisionStatus: 'LEGACY_FREE_TEXT',
    });
    expect(legacy.body).not.toHaveProperty('divisionVersionId');
  });

  it('serves the active catalogue; coded addresses take names from it and pairs are enforced', async () => {
    await prisma.$transaction((tx) =>
      importCatalog(tx, fixture('v1'), { provinces: 2, wards: 3 }),
    );
    const provinces = await http().get('/locations/provinces').expect(200);
    expect(provinces.headers['cache-control']).toBe('public, max-age=300');
    expect(provinces.body.version).toMatchObject({
      sourceRef: 'QA-FIXTURE-NOT-OFFICIAL',
      effectiveDate: '2025-07-01',
    });
    expect(provinces.body.items).toEqual([
      { code: '01', name: 'Thành phố QA v1', kind: 'THANH_PHO' },
      { code: '02', name: 'Tỉnh QA v1', kind: 'TINH' },
    ]);
    const wards = await http().get('/locations/provinces/01/wards').expect(200);
    expect(wards.body.province).toEqual({
      code: '01',
      name: 'Thành phố QA v1',
      kind: 'THANH_PHO',
    });
    expect(wards.body.items.map((w: { code: string }) => w.code)).toEqual([
      '00001',
      '00002',
    ]);
    expect(
      (await http().get('/locations/provinces/99/wards').expect(404)).body.code,
    ).toBe('PROVINCE_NOT_FOUND');
    for (const url of [
      '/locations/provinces/1/wards',
      '/locations/provinces/abc/wards',
      '/locations/provinces?all=1',
      '/locations/provinces/01/wards?x=1',
    ])
      expect((await http().get(url).expect(400)).body.code).toBe(
        'VALIDATION_ERROR',
      );

    const coded = await post({
      ...base,
      provinceCode: '01',
      wardCode: '00002',
      province: 'Client typed must be ignored',
      district: 'Old district',
    }).expect(201);
    expect(coded.body).toMatchObject({
      province: 'Thành phố QA v1',
      ward: 'Phường QA B v1',
      district: null,
      provinceCode: '01',
      wardCode: '00002',
      divisionStatus: 'STANDARD',
    });
    // Ward of another province, unknown ward, half a pair.
    expect(
      (await post({ ...base, provinceCode: '02', wardCode: '00001' }).expect(422))
        .body.code,
    ).toBe('ADDRESS_DIVISION_INVALID');
    expect(
      (await post({ ...base, provinceCode: '01', wardCode: '09999' }).expect(422))
        .body.code,
    ).toBe('ADDRESS_DIVISION_INVALID');
    expect(
      (await post({ ...base, provinceCode: '01' }).expect(400)).body.code,
    ).toBe('ADDRESS_DIVISION_INCOMPLETE');
    for (const phone of ['0123456789', '12345678', '0901234'])
      await post({ ...base, phone, provinceCode: '01', wardCode: '00001' }).expect(
        400,
      );

    // PATCH: codes switch location; non-location edit keeps codes.
    const switched = await http()
      .patch(`/me/addresses/${coded.body.id}`)
      .set('Authorization', token)
      .send({ provinceCode: '02', wardCode: '00003' })
      .expect(200);
    expect(switched.body).toMatchObject({
      province: 'Tỉnh QA v1',
      ward: 'Xã QA C v1',
      wardCode: '00003',
      divisionStatus: 'STANDARD',
    });
    const renamed = await http()
      .patch(`/me/addresses/${coded.body.id}`)
      .set('Authorization', token)
      .send({ recipientName: 'Renamed' })
      .expect(200);
    expect(renamed.body).toMatchObject({
      wardCode: '00003',
      divisionStatus: 'STANDARD',
    });
  });

  it('PostgreSQL itself rejects a ward/province mismatch and partial codes', async () => {
    const version = await prisma.adminDivisionVersion.findFirstOrThrow({
      where: { isActive: true },
    });
    const row = {
      userId: buyerId,
      recipientName: 'DB',
      phone: '0901234567',
      province: 'x',
      ward: 'y',
      addressLine: 'z',
    };
    await expect(
      prisma.userAddress.create({
        data: {
          ...row,
          provinceCode: '02',
          wardCode: '00001',
          divisionVersionId: version.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.userAddress.create({
        data: { ...row, provinceCode: '01', wardCode: null },
      }),
    ).rejects.toThrow();
  });

  it('a new catalogue version marks old coded addresses OUTDATED without rewriting them', async () => {
    const before = await prisma.userAddress.findMany({
      where: { userId: buyerId },
      orderBy: { id: 'asc' },
    });
    await prisma.$transaction((tx) =>
      importCatalog(tx, fixture('v2'), { provinces: 2, wards: 3 }),
    );
    expect(
      await prisma.adminDivisionVersion.count({ where: { isActive: true } }),
    ).toBe(1);
    const list = await http()
      .get('/me/addresses')
      .set('Authorization', token)
      .expect(200);
    const statuses = list.body.items.map(
      (a: { divisionStatus: string }) => a.divisionStatus,
    );
    expect(statuses).toContain('OUTDATED');
    expect(statuses).toContain('LEGACY_FREE_TEXT');
    expect(statuses).not.toContain('STANDARD');
    expect(
      await prisma.userAddress.findMany({
        where: { userId: buyerId },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(
      (await http().get('/locations/provinces').expect(200)).body.items[0].name,
    ).toBe('Thành phố QA v2');
  });
});
