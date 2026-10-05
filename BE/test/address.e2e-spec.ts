import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Role, Prisma } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { AddressService } from '../src/address/address.service.js';

describe('Buyer Address API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let buyer: number;
  let other: number;
  let seller: number;
  let token: string;
  let otherToken: string;
  let sellerToken: string;
  const marker = `address-e2e-${Date.now()}`;
  const body = {
    recipientName: ' Buyer ',
    phone: '0901234567',
    province: ' HCM ',
    ward: ' Ward ',
    addressLine: ' 12 Street ',
  };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    const config = app.get(ConfigService);
    const jwt = app.get(JwtService);
    async function actor(suffix: string, role: Role) {
      const user = await prisma.user.create({
        data: {
          email: `${marker}-${suffix}@example.com`,
          passwordHash: 'test-only-unused',
          role,
        },
      });
      const accessToken = jwt.sign(
        { sub: user.id, email: user.email, role, type: 'access' },
        {
          secret: config.getOrThrow('JWT_ACCESS_SECRET'),
          issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
          audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
          expiresIn: '10m',
        },
      );
      return { id: user.id, token: `Bearer ${accessToken}` };
    }
    const a = await actor('buyer', Role.USER);
    const b = await actor('other', Role.USER);
    const c = await actor('seller', Role.SELLER);
    buyer = a.id;
    token = a.token;
    other = b.id;
    otherToken = b.token;
    seller = c.id;
    sellerToken = c.token;
  });

  beforeEach(async () => {
    await prisma.userAddress.deleteMany({
      where: { userId: { in: [buyer, other] } },
    });
  });

  afterAll(async () => {
    if (prisma)
      await prisma.user.deleteMany({
        where: { email: { startsWith: marker } },
      });
    if (app) await app.close();
  });

  async function create(payload: Record<string, unknown> = body, auth = token) {
    return (
      await http()
        .post('/me/addresses')
        .set('Authorization', auth)
        .send(payload)
        .expect(201)
    ).body as { id: number; isDefault: boolean };
  }
  async function assertDefaults(count: number) {
    expect(
      await prisma.userAddress.count({
        where: { userId: buyer, isDefault: true },
      }),
    ).toBe(count);
  }

  it('GET empty does not create data; protects against caching', async () => {
    const response = await http()
      .get('/me/addresses')
      .set('Authorization', token)
      .expect(200);
    expect(response.body).toEqual({ items: [] });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await prisma.userAddress.count({ where: { userId: buyer } })).toBe(
      0,
    );
  });

  it('Swagger describes nullable district as string and ID as integer', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const schema = doc.components?.schemas?.CreateAddressDto;
    expect(schema).toMatchObject({
      properties: { district: { type: 'string', nullable: true } },
    });
    expect(doc.paths['/me/addresses/{addressId}'].patch?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'addressId',
          schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
        }),
      ]),
    );
    expect(doc.paths['/me/addresses'].post?.responses).toHaveProperty('201');
    expect(
      doc.paths['/me/addresses/{addressId}'].delete?.responses,
    ).toHaveProperty('204');
  });

  it('creates first default despite false, trims and stores district=null', async () => {
    const response = await http()
      .post('/me/addresses')
      .set('Authorization', token)
      .send({ ...body, isDefault: false })
      .expect(201);
    expect(response.body).toMatchObject({
      recipientName: 'Buyer',
      province: 'HCM',
      ward: 'Ward',
      addressLine: '12 Street',
      district: null,
      isDefault: true,
      postalCode: null,
      deliveryNote: null,
    });
    expect(response.body).not.toHaveProperty('userId');
    const second = await create();
    expect(second.isDefault).toBe(false);
    await assertDefaults(1);
  });

  it('PATCH omission preserves, optional null clears, same value is accepted', async () => {
    const a = await create({
      ...body,
      district: 'Legacy',
      postalCode: '12345',
      deliveryNote: 'Call',
    });
    await http()
      .patch(`/me/addresses/${a.id}`)
      .set('Authorization', token)
      .send({ recipientName: 'Buyer' })
      .expect(200);
    expect(
      await prisma.userAddress.findUnique({ where: { id: a.id } }),
    ).toMatchObject({
      district: 'Legacy',
      postalCode: '12345',
      deliveryNote: 'Call',
    });
    const changed = await http()
      .patch(`/me/addresses/${a.id}`)
      .set('Authorization', token)
      .send({ district: null, postalCode: null, deliveryNote: null })
      .expect(200);
    expect(changed.body).toMatchObject({
      district: null,
      postalCode: null,
      deliveryNote: null,
    });
  });

  it('rejects empty PATCH, null required fields, whitespace, wrong types and extras', async () => {
    const a = await create();
    for (const bad of [
      {},
      { ward: null },
      { phone: null },
      { isDefault: null },
      { district: ' ' },
      { userId: other },
      { isDefault: 'true' },
      { recipientName: 'x'.repeat(101) },
    ]) {
      const response = await http()
        .patch(`/me/addresses/${a.id}`)
        .set('Authorization', token)
        .send(bad)
        .expect(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
    }
  });

  it('POST rejects missing mandatory fields and unknown owner', async () => {
    for (const bad of [
      {},
      { ...body, province: null },
      { ...body, phone: '123' },
      { ...body, district: '' },
      { ...body, userId: other },
    ])
      await http()
        .post('/me/addresses')
        .set('Authorization', token)
        .send(bad)
        .expect(400);
  });

  it('cannot unset default; false for non-default is a valid no-op; PUT changes default', async () => {
    const a = await create();
    const b = await create();
    const blocked = await http()
      .patch(`/me/addresses/${a.id}`)
      .set('Authorization', token)
      .send({ isDefault: false })
      .expect(409);
    expect(blocked.body.code).toBe('DEFAULT_ADDRESS_CANNOT_BE_UNSET');
    await http()
      .patch(`/me/addresses/${b.id}`)
      .set('Authorization', token)
      .send({ isDefault: false })
      .expect(200);
    await http()
      .put(`/me/addresses/${b.id}/default`)
      .set('Authorization', token)
      .send({})
      .expect(200);
    await http()
      .put(`/me/addresses/${b.id}/default`)
      .set('Authorization', token)
      .send({})
      .expect(200);
    await assertDefaults(1);
    const list = await http()
      .get('/me/addresses')
      .set('Authorization', token)
      .expect(200);
    expect(list.body.items.map((item: { id: number }) => item.id)).toEqual([
      b.id,
      a.id,
    ]);
  });

  it('PATCH true switches default atomically', async () => {
    const a = await create();
    const b = await create();
    await http()
      .patch(`/me/addresses/${b.id}`)
      .set('Authorization', token)
      .send({ isDefault: true })
      .expect(200);
    expect(
      await prisma.userAddress.findUnique({ where: { id: a.id } }),
    ).toMatchObject({ isDefault: false });
    await assertDefaults(1);
  });

  it('PUT default rejects client-selected ownership or extra fields', async () => {
    const a = await create();
    await http()
      .put(`/me/addresses/${a.id}/default`)
      .set('Authorization', token)
      .send({ userId: other })
      .expect(400);
    await assertDefaults(1);
  });

  it('deleting default chooses oldest (createdAt,id); deleting last leaves no default', async () => {
    const a = await create();
    const b = await create();
    const c = await create({ ...body, isDefault: true });
    await prisma.userAddress.updateMany({
      where: { id: { in: [a.id, b.id] } },
      data: { createdAt: new Date('2026-01-01') },
    });
    await http()
      .delete(`/me/addresses/${c.id}`)
      .set('Authorization', token)
      .expect(204);
    expect(
      await prisma.userAddress.findUnique({ where: { id: a.id } }),
    ).toMatchObject({ isDefault: true });
    await http()
      .delete(`/me/addresses/${a.id}`)
      .set('Authorization', token)
      .expect(204);
    await http()
      .delete(`/me/addresses/${b.id}`)
      .set('Authorization', token)
      .expect(204);
    await assertDefaults(0);
    await http()
      .delete(`/me/addresses/${b.id}`)
      .set('Authorization', token)
      .expect(404);
  });

  it('ownership and nonexistent errors are identical for PATCH/default/DELETE', async () => {
    const a = await create(body, otherToken);
    for (const id of [a.id, 2147483647]) {
      for (const method of ['patch', 'put', 'delete'] as const) {
        const path = `/me/addresses/${id}${method === 'put' ? '/default' : ''}`;
        const response = await http()
          [method](path)
          .set('Authorization', token)
          .send(method === 'patch' ? { ward: 'Updated' } : {})
          .expect(404);
        expect(response.body.code).toBe('ADDRESS_NOT_FOUND');
      }
    }
    const list = await http()
      .get('/me/addresses')
      .set('Authorization', token)
      .expect(200);
    expect(list.body.items).toEqual([]);
  });

  it('guards reject absent/expired tokens, SELLER/ADMIN and inactive account', async () => {
    await http().get('/me/addresses').expect(401);
    await http()
      .post('/me/addresses')
      .set('Authorization', sellerToken)
      .send(body)
      .expect(403);
    const config = app.get(ConfigService);
    const jwt = app.get(JwtService);
    const options = {
      secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      issuer: 'klcn-ecommerce-api',
      audience: 'klcn-ecommerce-web',
    };
    const expired = jwt.sign(
      { sub: buyer, type: 'access' },
      { ...options, expiresIn: -1 },
    );
    await http()
      .get('/me/addresses')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
    await prisma.user.update({
      where: { id: seller },
      data: { role: Role.ADMIN },
    });
    try {
      await http()
        .get('/me/addresses')
        .set('Authorization', sellerToken)
        .expect(403);
    } finally {
      await prisma.user.update({
        where: { id: seller },
        data: { role: Role.SELLER },
      });
    }
    await prisma.user.update({
      where: { id: buyer },
      data: { isActive: false },
    });
    try {
      await http().get('/me/addresses').set('Authorization', token).expect(401);
    } finally {
      await prisma.user.update({
        where: { id: buyer },
        data: { isActive: true },
      });
    }
  });

  it.each(['0', '-1', '1.5', '1e2', '2147483648'])(
    'HTTP rejects invalid addressId %s without coercion',
    async (id) => {
      const response = await http()
        .patch(`/me/addresses/${id}`)
        .set('Authorization', token)
        .send({ ward: 'Valid' })
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    },
  );

  it('concurrent first creates produce exactly one default', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        http().post('/me/addresses').set('Authorization', token).send(body),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(201));
    await assertDefaults(1);
    expect(await prisma.userAddress.count({ where: { userId: buyer } })).toBe(
      6,
    );
  });

  it('concurrent default switches and switch/delete preserve one default', async () => {
    const a = await create();
    const b = await create();
    const c = await create();
    const switches = await Promise.all(
      [b.id, c.id].map((id) =>
        http()
          .put(`/me/addresses/${id}/default`)
          .set('Authorization', token)
          .send({}),
      ),
    );
    expect(switches.every((r) => r.status === 200)).toBe(true);
    await assertDefaults(1);
    const current = await prisma.userAddress.findFirstOrThrow({
      where: { userId: buyer, isDefault: true },
    });
    const responses = await Promise.all([
      http().delete(`/me/addresses/${current.id}`).set('Authorization', token),
      http()
        .put(`/me/addresses/${a.id}/default`)
        .set('Authorization', token)
        .send({}),
    ]);
    expect(responses.map((r) => r.status)).toEqual([204, 200]);
    await assertDefaults(1);
  });

  it('enforces limit atomically across independent service instances', async () => {
    for (let i = 0; i < 19; i++) await create();
    const secondInstance = new AddressService(prisma, app.get(ConfigService));
    const results = await Promise.allSettled([
      app.get(AddressService).create(buyer, body),
      secondInstance.create(buyer, body),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await prisma.userAddress.count({ where: { userId: buyer } })).toBe(
      20,
    );
    await assertDefaults(1);
    const response = await http()
      .post('/me/addresses')
      .set('Authorization', token)
      .send(body)
      .expect(409);
    expect(response.body.code).toBe('ADDRESS_LIMIT_REACHED');
  });

  it('rolls back clearing old default when setting new default fails', async () => {
    const a = await create();
    const b = await create();
    const original = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, '$transaction');
    // Execute a real DB transaction; inject failure after updateMany, before update.
    spy.mockImplementationOnce((async (
      action: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: object,
    ) =>
      original(async (tx) => {
        const delegate = new Proxy(tx.userAddress, {
          get(target, prop) {
            if (prop === 'update')
              return () => {
                throw new Error('injected failure');
              };
            return Reflect.get(target, prop);
          },
        });
        return action(
          new Proxy(tx, {
            get(target, prop) {
              return prop === 'userAddress'
                ? delegate
                : Reflect.get(target, prop);
            },
          }),
        );
      }, options)) as typeof prisma.$transaction);
    try {
      const response = await http()
        .put(`/me/addresses/${b.id}/default`)
        .set('Authorization', token)
        .send({})
        .expect(500);
      expect(response.body).toEqual({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Không thể xử lý yêu cầu.',
      });
    } finally {
      spy.mockRestore();
    }
    expect(
      await prisma.userAddress.findUnique({ where: { id: a.id } }),
    ).toMatchObject({ isDefault: true });
    await assertDefaults(1);
  });

  it('address edits/deletion preserve existing Order snapshots', async () => {
    const a = await create({ ...body, district: 'Historical' });
    const store = await prisma.store.create({
      data: { sellerId: seller, name: marker, status: 'ACTIVE' },
    });
    const checkout = await prisma.checkout.create({
      data: { buyerId: buyer, idempotencyKey: marker, requestHash: 'fixture' },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: marker,
        checkoutId: checkout.id,
        buyerId: buyer,
        storeId: store.id,
        recipientNameSnapshot: 'Historical Buyer',
        phoneSnapshot: '0901234567',
        provinceSnapshot: 'Legacy Province',
        districtSnapshot: 'Historical',
        wardSnapshot: 'Old Ward',
        addressLineSnapshot: 'Old Street',
        subtotal: 100,
        shippingFee: 0,
        total: 100,
      },
    });
    try {
      await http()
        .patch(`/me/addresses/${a.id}`)
        .set('Authorization', token)
        .send({ district: null, ward: 'New Ward' })
        .expect(200);
      await http()
        .delete(`/me/addresses/${a.id}`)
        .set('Authorization', token)
        .expect(204);
      expect(
        await prisma.order.findUnique({ where: { id: order.id } }),
      ).toMatchObject({
        districtSnapshot: 'Historical',
        wardSnapshot: 'Old Ward',
        recipientNameSnapshot: 'Historical Buyer',
      });
      // Expanded schema also permits new snapshots without the obsolete district.
      await prisma.order.update({
        where: { id: order.id },
        data: { districtSnapshot: null },
      });
    } finally {
      await prisma.order.delete({ where: { id: order.id } });
      await prisma.checkout.delete({ where: { id: checkout.id } });
      await prisma.store.delete({ where: { id: store.id } });
    }
  });
});
