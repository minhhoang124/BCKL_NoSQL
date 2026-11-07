import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { AdminFulfilmentController } from '../src/order/admin-fulfilment.controller.js';

describe('Admin fulfilment read projection — HTTP/PostgreSQL', () => {
  let app: INestApplication, db: PrismaService, id: number, adminId: number;
  const tokens = {} as Record<Role, string>;
  const marker = 'admin-read-' + randomUUID().slice(0, 8);
  let adminEmail: string;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    const actors = {} as Record<Role, number>;
    for (const role of [Role.ADMIN, Role.USER, Role.SELLER]) {
      const email = marker + '-' + role + '@example.test';
      const a = await db.user.create({
        data: { email, passwordHash: 'fixture-no-password-login', role },
      });
      actors[role] = a.id;
      if (role === Role.ADMIN) adminEmail = email;
      const cfg = app.get(ConfigService);
      tokens[role] = app.get(JwtService).sign(
        { sub: a.id, email, role, type: 'access', cv: 1 },
        {
          secret: cfg.getOrThrow('JWT_ACCESS_SECRET'),
          issuer: cfg.get('JWT_ISSUER', 'klcn-ecommerce-api'),
          audience: cfg.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
          expiresIn: '5m',
        },
      );
    }
    adminId = actors.ADMIN;
    const store = await db.store.create({
      data: { sellerId: actors.SELLER, name: marker, status: 'ACTIVE' },
    });
    // Read-only fixture, not evidence of a fulfilled purchase or stock movement.
    const checkout = await db.checkout.create({
      data: {
        buyerId: actors.USER,
        idempotencyKey: marker,
        requestHash: 'a'.repeat(64),
        hashVersion: 1,
      },
    });
    const order = await db.order.create({
      data: {
        orderNumber: marker,
        checkoutId: checkout.id,
        buyerId: actors.USER,
        storeId: store.id,
        status: 'READY_TO_SHIP',
        recipientNameSnapshot: 'PRIVATE RECIPIENT',
        phoneSnapshot: '0901234567',
        provinceSnapshot: 'PRIVATE',
        wardSnapshot: 'PRIVATE',
        addressLineSnapshot: 'PRIVATE ADDRESS',
        subtotal: '10000.00',
        shippingFee: 0,
        discountTotal: 0,
        total: '10000.00',
        payment: {
          create: { provider: 'COD', status: 'UNPAID', amount: '10000.00' },
        },
      },
    });
    id = order.id;
  });
  afterAll(async () => {
    await app?.close();
  });
  const get = (suffix = '', token = tokens.ADMIN) =>
    request(app.getHttpServer())
      .get('/admin/fulfilment/orders' + suffix)
      .set('Authorization', 'Bearer ' + token);
  it('returns only operational fields with canonical Decimal strings; reading changes no business data', async () => {
    const before = await db.order.findUniqueOrThrow({
      where: { id },
      include: { payment: true },
    });
    const res = await get('/' + id).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'id',
        'orderNumber',
        'status',
        'total',
        'currentDeliveryAttempt',
        'retryCount',
        'currentAttempt',
        'payment',
      ].sort(),
    );
    expect(res.body.total).toBe('10000.00');
    expect(res.body.payment).toEqual({
      provider: 'COD',
      status: 'UNPAID',
      amount: '10000.00',
      currency: 'VND',
    });
    expect(JSON.stringify(res.body)).not.toMatch(
      /PRIVATE|0901234567|buyerId|reasonText|idempotencyKey/,
    );
    expect(
      await db.order.findUniqueOrThrow({
        where: { id },
        include: { payment: true },
      }),
    ).toEqual(before);
    const queue = await get().expect(200);
    expect(queue.body.items.length).toBeLessThanOrEqual(20);
    expect(
      queue.body.items.every(
        (r: { status: string; total: string }) =>
          ['READY_TO_SHIP', 'SHIPPING', 'DELIVERY_FAILED'].includes(r.status) &&
          /^\d+\.\d{2}$/.test(r.total),
      ),
    ).toBe(true);
  });
  it('denies Buyer/Seller and unauthenticated reads', async () => {
    for (const role of [Role.USER, Role.SELLER]) {
      await get('', tokens[role]).expect(403);
      await get('/' + id, tokens[role]).expect(403);
    }
    await request(app.getHttpServer())
      .get('/admin/fulfilment/orders')
      .expect(401);
  });
  it('rejects malformed IDs, queries and GET bodies; absent order returns404', async () => {
    for (const suffix of [
      '/0',
      '/01',
      '/2147483648',
      '?limit=100',
      '/' + id + '?extra=1',
    ])
      await get(suffix).expect(400);
    await get('/2147483647').expect(404);
    await get('/' + id)
      .send({ extra: true })
      .expect(400);
  });
  it('looks up any status by displayed ORD code (full, 8-hex prefix, case/space), same minimal projection', async () => {
    const base = await db.order.findUniqueOrThrow({ where: { id } });
    const code = randomUUID();
    const checkout = await db.checkout.create({
      data: {
        buyerId: base.buyerId,
        idempotencyKey: marker + '-lookup',
        requestHash: 'b'.repeat(64),
        hashVersion: 1,
      },
    });
    const completed = await db.order.create({
      data: {
        orderNumber: 'ORD-' + code,
        checkoutId: checkout.id,
        buyerId: base.buyerId,
        storeId: base.storeId,
        status: 'COMPLETED',
        recipientNameSnapshot: 'PRIVATE RECIPIENT',
        phoneSnapshot: '0901234567',
        provinceSnapshot: 'PRIVATE',
        wardSnapshot: 'PRIVATE',
        addressLineSnapshot: 'PRIVATE ADDRESS',
        subtotal: '20000.00',
        shippingFee: 0,
        discountTotal: 0,
        total: '20000.00',
        payment: {
          create: { provider: 'COD', status: 'PAID', amount: '20000.00' },
        },
      },
    });
    const before = await db.order.findUniqueOrThrow({
      where: { id: completed.id },
      include: { payment: true },
    });
    const lookup = (value: string, token = tokens.ADMIN) =>
      get('?orderNumber=' + encodeURIComponent(value), token);
    for (const value of [
      'ORD-' + code,
      'ORD-' + code.slice(0, 8),
      '  ord-' + code.toUpperCase() + ' ',
      code.slice(0, 13),
    ]) {
      const res = await lookup(value).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(Object.keys(res.body)).toEqual(['items']);
      expect(res.body.items.map((r: { id: number }) => r.id)).toEqual([
        completed.id,
      ]);
      expect(Object.keys(res.body.items[0]).sort()).toEqual(
        [
          'id',
          'orderNumber',
          'status',
          'total',
          'currentDeliveryAttempt',
          'retryCount',
          'currentAttempt',
          'payment',
        ].sort(),
      );
      expect(res.body.items[0]).toMatchObject({
        orderNumber: 'ORD-' + code,
        status: 'COMPLETED',
        total: '20000.00',
      });
      expect(JSON.stringify(res.body)).not.toMatch(
        /PRIVATE|0901234567|buyerId|idempotencyKey/,
      );
    }
    // Not part of the delivery queue, and the non-ORD fixture is never matched.
    expect(
      (await get().expect(200)).body.items.some(
        (r: { id: number }) => r.id === completed.id,
      ),
    ).toBe(false);
    expect(
      (await lookup('ORD-' + 'f'.repeat(8)).expect(200)).body.items.some(
        (r: { id: number }) => r.id === completed.id || r.id === id,
      ),
    ).toBe(false);
    for (const role of [Role.USER, Role.SELLER])
      await lookup('ORD-' + code, tokens[role]).expect(403);
    for (const suffix of [
      '?orderNumber=' + encodeURIComponent('ORD-' + code.slice(0, 7)),
      '?orderNumber=' + encodeURIComponent('ORD-%'),
      '?orderNumber=' + encodeURIComponent('ORD-' + code.slice(0, 8) + '%'),
      '?orderNumber=' + encodeURIComponent("ORD-1a2b3c4d' OR 1=1"),
      '?orderNumber=ORD-' + code + '&limit=1',
      '?orderNumber=ORD-' + code + '&orderNumber=ORD-' + code,
      '?orderNumber=',
    ]) {
      const res = await get(suffix).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect(
      await db.order.findUniqueOrThrow({
        where: { id: completed.id },
        include: { payment: true },
      }),
    ).toEqual(before);
  });
  it('rechecks credential version inside the reader even without HTTP guards', async () => {
    await db.user.update({
      where: { id: adminId },
      data: { credentialVersion: 2 },
    });
    await expect(
      app.get(AdminFulfilmentController).detail(
        {
          userId: adminId,
          email: adminEmail,
          role: Role.ADMIN,
          credentialVersion: 1,
        },
        String(id),
        {},
        { headers: {} } as Request,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await get('/' + id).expect(401);
  });
  it('bounds a blocked actor lock and returns a safe503 instead of database details', async () => {
    let locked!: () => void, release!: () => void;
    const acquired = new Promise<void>((r) => {
        locked = r;
      }),
      hold = new Promise<void>((r) => {
        release = r;
      });
    const writer = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id=${adminId} FOR UPDATE`;
        locked();
        await hold;
      },
      { timeout: 5000 },
    );
    await acquired;
    try {
      const started = Date.now();
      await expect(
        app
          .get(AdminFulfilmentController)
          .detail(
            {
              userId: adminId,
              email: adminEmail,
              role: Role.ADMIN,
              credentialVersion: 2,
            },
            String(id),
            {},
            { headers: {} } as Request,
          ),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: 'FULFILMENT_READ_UNAVAILABLE' },
      });
      expect(Date.now() - started).toBeLessThan(3500);
    } finally {
      release();
      await writer;
    }
  });
});
