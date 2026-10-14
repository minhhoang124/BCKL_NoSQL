import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { OrderStatus, Role } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { gzipSync } from 'node:zlib';
import { request as nodeRequest } from 'node:http';
import { prepareOrderCommand } from '../src/order/order-command-request.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Seller preparation commands — real PostgreSQL, two app instances', () => {
  let app: INestApplication;
  let otherApp: INestApplication;
  let prisma: PrismaService;
  let otherPrisma: PrismaService;
  let buyer: { id: number; token: string };
  let seller: { id: number; token: string };
  let otherSeller: { id: number; token: string };
  let admin: { id: number; token: string };
  let storeId: number;
  let otherStoreId: number;
  let orderId: number;
  let serial = 0;
  const marker = `seller-command-${Date.now()}`;
  const key = () => `seller_command_key_${serial++}`;
  const post = (
    id = orderId,
    command = 'confirm',
    header = key(),
    instance = app,
    token = seller.token,
    body: unknown = {},
  ) =>
    request(instance.getHttpServer())
      .post(`/seller/orders/${id}/${command}`)
      .set('Authorization', token)
      .set('Idempotency-Key', header)
      .send(body as object);

  async function start() {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const instance = module.createNestApplication();
    configureApp(instance);
    await instance.listen(0, '127.0.0.1');
    return instance;
  }
  async function actor(role: Role) {
    const user = await prisma.user.create({
      data: {
        email: `${marker}-${serial++}@example.com`,
        role,
        passwordHash: 'fixture-only',
      },
    });
    const config = app.get(ConfigService);
    const jwt = app.get(JwtService).sign(
      { sub: user.id, role, email: user.email, type: 'access' },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
        expiresIn: '10m',
      },
    );
    return { id: user.id, token: `Bearer ${jwt}` };
  }
  async function fixture(
    store = storeId,
    status: OrderStatus = 'PENDING_CONFIRMATION',
  ) {
    const checkout = await prisma.checkout.create({
      data: {
        buyerId: buyer.id,
        idempotencyKey: `${marker}-${serial++}`,
        requestHash: 'legacy-controlled-fixture',
      },
    });
    const order = await prisma.order.create({
      data: {
        checkoutId: checkout.id,
        buyerId: buyer.id,
        storeId: store,
        status,
        orderNumber: `${marker}-${serial++}`,
        recipientNameSnapshot: 'Original recipient',
        phoneSnapshot: '0901234567',
        provinceSnapshot: 'Province',
        districtSnapshot: null,
        wardSnapshot: 'Ward',
        addressLineSnapshot: 'Original address',
        subtotal: '10000.00',
        total: '10000.00',
        shippingFee: 0,
        discountTotal: 0,
        payment: { create: { provider: 'COD', amount: '10000.00' } },
        statusHistory: {
          create:
            status === 'PENDING_CONFIRMATION'
              ? {
                  fromStatus: null,
                  toStatus: status,
                  actorId: buyer.id,
                  actorType: 'BUYER',
                }
              : { fromStatus: null, toStatus: status },
        },
      },
    });
    return order.id;
  }
  async function state(id = orderId) {
    return {
      order: await prisma.order.findUnique({ where: { id } }),
      payment: await prisma.payment.findUnique({ where: { orderId: id } }),
      history: await prisma.orderStatusHistory.findMany({
        where: { orderId: id },
        orderBy: { id: 'asc' },
      }),
      commands: await prisma.orderCommand.findMany({
        where: { orderId: id },
        orderBy: { id: 'asc' },
      }),
    };
  }
  beforeAll(async () => {
    // Fail closed before any fixture write; dotenv override must never target demo.
    const target = new URL(process.env.DATABASE_URL ?? '');
    const isolatedTarget =
      target.pathname.startsWith('/bckl_') ||
      (process.env.GITHUB_ACTIONS === 'true' &&
        target.pathname === '/klcn_ecommerce');
    // GitHub's disposable service uses the legacy database name, never the
    // developer's local database. Locally only a bckl_ test database is allowed.
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !isolatedTarget
    )
      throw new Error('Dedicated local bckl_ test database required');
    app = await start();
    otherApp = await start();
    prisma = app.get(PrismaService);
    otherPrisma = otherApp.get(PrismaService);
    buyer = await actor('USER');
    admin = await actor('ADMIN');
    otherSeller = await actor('SELLER');
    otherStoreId = (
      await prisma.store.create({
        data: {
          sellerId: otherSeller.id,
          name: `${marker}-other`,
          status: 'ACTIVE',
        },
      })
    ).id;
  });
  beforeEach(async () => {
    seller = await actor('SELLER');
    storeId = (
      await prisma.store.create({
        data: {
          sellerId: seller.id,
          name: `${marker}-${serial++}`,
          status: 'ACTIVE',
        },
      })
    ).id;
    orderId = await fixture();
  });
  afterAll(async () => {
    try {
      if (prisma) {
        const ownOrder = { buyer: { email: { startsWith: marker } } };
        const ownStore = { name: { startsWith: marker } };
        await prisma.stockMovement.deleteMany({
          where: { orderItem: { order: ownOrder } },
        });
        await prisma.orderStatusHistory.deleteMany({
          where: { order: ownOrder },
        });
        await prisma.orderCommand.deleteMany({ where: { order: ownOrder } });
        await prisma.payment.deleteMany({ where: { order: ownOrder } });
        await prisma.orderItem.deleteMany({ where: { order: ownOrder } });
        await prisma.order.deleteMany({ where: ownOrder });
        await prisma.checkout.deleteMany({
          where: { buyer: { email: { startsWith: marker } } },
        });
        await prisma.cartItem.deleteMany({
          where: { cart: { user: { email: { startsWith: marker } } } },
        });
        await prisma.searchOutbox.deleteMany({
          where: { product: { store: ownStore } },
        });
        await prisma.product.deleteMany({ where: { store: ownStore } });
        await prisma.category.deleteMany({ where: { slug: marker } });
        await prisma.store.deleteMany({ where: ownStore });
        await prisma.user.deleteMany({
          where: { email: { startsWith: marker } },
        });
      }
    } finally {
      await otherApp?.close();
      await app?.close();
    }
  });

  it('runs all three commands and replays the original confirm snapshot after later transitions', async () => {
    const before = await state();
    const confirmKey = key();
    const first = await post(orderId, 'confirm', confirmKey).expect(200);
    expect(first.body).toMatchObject({
      orderId,
      command: 'confirm',
      replayed: false,
      result: { status: 'CONFIRMED', cancellation: null },
    });
    expect(first.body.result.timeline).toHaveLength(1);
    expect(first.body.result.timeline[0]).toMatchObject({
      actorType: 'SELLER',
      actorId: seller.id,
      fromStatus: 'PENDING_CONFIRMATION',
      toStatus: 'CONFIRMED',
    });
    expect(first.headers['cache-control']).toBe('no-store');
    await post(orderId, 'start-packing').expect(200);
    await post(orderId, 'ready-to-ship').expect(200);
    const committed = await state();
    expect(committed.order?.status).toBe('READY_TO_SHIP');
    expect(committed.commands).toHaveLength(3);
    expect(committed.history).toHaveLength(4);
    expect(committed.payment).toEqual(before.payment);
    expect(committed.order).toEqual({
      ...before.order,
      status: 'READY_TO_SHIP',
      updatedAt: committed.order?.updatedAt,
    });
    const replay = await post(orderId, 'confirm', confirmKey, otherApp).expect(
      200,
    );
    expect(replay.body).toEqual({ ...first.body, replayed: true });
    expect(await state()).toEqual(committed);
    expect(JSON.stringify(replay.body)).not.toMatch(
      /requestHash|idempotencyKey|password|recipient|phoneSnapshot/,
    );
    const list = await request(app.getHttpServer())
      .get('/seller/orders')
      .set('Authorization', seller.token)
      .expect(200);
    expect(
      list.body.items.find((x: { id: number }) => x.id === orderId).status,
    ).toBe('READY_TO_SHIP');
  });
  it('new key at the target state is not a replay', async () => {
    await post().expect(200);
    const before = await state();
    expect((await post().expect(409)).body.code).toBe(
      'INVALID_ORDER_TRANSITION',
    );
    expect(await state()).toEqual(before);
  });
  it('key scope covers different commands and different owned Orders', async () => {
    const header = key();
    await post(orderId, 'confirm', header).expect(200);
    expect(
      (await post(orderId, 'start-packing', header).expect(409)).body.code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    const second = await fixture();
    expect((await post(second, 'confirm', header).expect(409)).body.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    expect((await state(second)).commands).toHaveLength(0);
  });
  it('same key is independent for two Sellers', async () => {
    const second = await fixture(otherStoreId);
    const header = key();
    await post(orderId, 'confirm', header).expect(200);
    await post(second, 'confirm', header, otherApp, otherSeller.token).expect(
      200,
    );
  });
  it('ownership precedes receipt lookup; wrong Store and absent Order are the same 404', async () => {
    const header = key();
    await post(orderId, 'confirm', header).expect(200);
    const wrong = await post(
      orderId,
      'confirm',
      header,
      otherApp,
      otherSeller.token,
    ).expect(404);
    const absent = await post(
      2147483647,
      'confirm',
      header,
      otherApp,
      otherSeller.token,
    ).expect(404);
    expect(wrong.body).toEqual(absent.body);
    expect(wrong.body.code).toBe('ORDER_NOT_FOUND');
  });
  it('rejects anonymous, Buyer, Admin, expired and inactive sessions before mutation/replay', async () => {
    await request(app.getHttpServer())
      .post(`/seller/orders/${orderId}/confirm`)
      .send({})
      .expect(401);
    await post(orderId, 'confirm', key(), app, buyer.token).expect(403);
    await post(orderId, 'confirm', key(), app, admin.token).expect(403);
    await post(
      orderId,
      'confirm',
      key(),
      app,
      'Bearer invalid-expired-token',
    ).expect(401);
    const header = key();
    await post(orderId, 'confirm', header).expect(200);
    const before = await state();
    await prisma.user.update({
      where: { id: seller.id },
      data: { isActive: false },
    });
    await post(orderId, 'confirm', header).expect(401);
    expect(await state()).toEqual(before);
  });
  it('uses current DB role, not the stale Seller claim in JWT', async () => {
    const header = key();
    await post(orderId, 'confirm', header).expect(200);
    const before = await state();
    await prisma.user.update({
      where: { id: seller.id },
      data: { role: 'USER' },
    });
    await post(orderId, 'confirm', header).expect(403);
    expect(await state()).toEqual(before);
  });
  it('rechecks account under DB lock after JWT guard; concurrent deactivation wins safely', async () => {
    let unlock!: () => void;
    let ready!: () => void;
    const release = new Promise<void>((r) => {
      unlock = r;
    });
    const locked = new Promise<void>((r) => {
      ready = r;
    });
    const blocker = otherPrisma.$transaction(
      async (tx) => {
        await tx.user.update({
          where: { id: seller.id },
          data: { isActive: false },
        });
        ready();
        await release;
      },
      { timeout: 5000 },
    );
    await locked;
    const pending = Promise.resolve(post());
    await delay(100);
    unlock();
    await blocker;
    const response = await pending;
    expect(response.status).toBe(401);
    expect((await state()).commands).toHaveLength(0);
  });
  it('allows ACTIVE Seller to prepare existing Orders in a SUSPENDED Store', async () => {
    await prisma.store.update({
      where: { id: storeId },
      data: { status: 'SUSPENDED' },
    });
    await post().expect(200);
    await post(orderId, 'start-packing').expect(200);
    await post(orderId, 'ready-to-ship').expect(200);
    expect((await state()).order?.status).toBe('READY_TO_SHIP');
  });
  it.each(['PENDING', 'REJECTED', 'CLOSED'] as const)(
    'blocks new preparation in Store %s without changing existing state',
    async (status) => {
      await prisma.store.update({ where: { id: storeId }, data: { status } });
      const before = await state();
      expect((await post().expect(409)).body.code).toBe('STORE_STATE_CONFLICT');
      expect(await state()).toEqual(before);
    },
  );
  it.each(['start-packing', 'ready-to-ship'])(
    'cannot skip to %s from pending',
    async (command) => {
      const before = await state();
      expect((await post(orderId, command).expect(409)).body.code).toBe(
        'INVALID_ORDER_TRANSITION',
      );
      expect(await state()).toEqual(before);
    },
  );
  it.each([
    'PACKING',
    'READY_TO_SHIP',
    'SHIPPING',
    'DELIVERED',
    'COMPLETED',
    'CANCELLED',
    'DELIVERY_FAILED',
  ] as const)('confirm rejects source %s', async (status) => {
    await prisma.order.update({ where: { id: orderId }, data: { status } });
    expect((await post().expect(409)).body.code).toBe(
      'INVALID_ORDER_TRANSITION',
    );
    expect((await state()).commands).toHaveLength(0);
  });
  it('missing legacy Payment does not get silently created', async () => {
    await prisma.payment.delete({ where: { orderId } });
    expect((await post().expect(409)).body.code).toBe('PAYMENT_STATE_CONFLICT');
    expect((await state()).payment).toBeNull();
    expect((await state()).commands).toHaveLength(0);
  });
  it.each([
    { status: 'CANCELLED' as const },
    { status: 'PAID' as const },
    { amount: '9999.00' },
    { paidAt: new Date('2026-10-10T00:00:00.000Z') },
    { provider: 'VNPAY' as const, status: 'PENDING' as const },
    { provider: 'MOMO' as const, status: 'PAID' as const },
  ])(
    'rejects inconsistent Payment %# without a command receipt',
    async (data) => {
      await prisma.payment.update({ where: { orderId }, data });
      const before = await state();
      expect((await post().expect(409)).body.code).toBe(
        'PAYMENT_STATE_CONFLICT',
      );
      expect(await state()).toEqual(before);
    },
  );
  it.each(['VNPAY', 'MOMO'] as const)(
    'accepts paid %s policy fixture, without claiming sandbox integration',
    async (provider) => {
      await prisma.payment.update({
        where: { orderId },
        data: { provider, status: 'PAID', paidAt: new Date() },
      });
      await post().expect(200);
    },
  );
  it('validates Payment again on packing, but true confirm replay retains original snapshot', async () => {
    const header = key();
    const first = await post(orderId, 'confirm', header).expect(200);
    await prisma.payment.update({
      where: { orderId },
      data: { status: 'CANCELLED' },
    });
    expect((await post(orderId, 'start-packing').expect(409)).body.code).toBe(
      'PAYMENT_STATE_CONFLICT',
    );
    expect((await post(orderId, 'confirm', header).expect(200)).body).toEqual({
      ...first.body,
      replayed: true,
    });
  });

  // Force overlapping transactions: both app instances must be blocked on real DB locks.
  async function race(
    first: () => PromiseLike<request.Response>,
    second: () => PromiseLike<request.Response>,
  ) {
    let unlock!: () => void;
    let ready!: () => void;
    const release = new Promise<void>((r) => {
      unlock = r;
    });
    const locked = new Promise<void>((r) => {
      ready = r;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${seller.id} FOR UPDATE`;
        ready();
        await release;
      },
      { timeout: 5000 },
    );
    await locked;
    const pending = [Promise.resolve(first()), Promise.resolve(second())];
    try {
      let count = 0;
      for (let i = 0; i < 20; i++) {
        const rows = await prisma.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND wait_event_type = 'Lock'`;
        count = Number(rows[0].count);
        if (count >= 2) break;
        await delay(20);
      }
      expect(count).toBeGreaterThanOrEqual(2);
    } finally {
      unlock();
      await blocker;
    }
    return Promise.all(pending);
  }
  it('same key across independent apps commits one transition/history and one receipt', async () => {
    const header = key();
    const responses = await race(
      () => post(orderId, 'confirm', header),
      () => post(orderId, 'confirm', header, otherApp),
    );
    expect(responses.map((x) => x.status)).toEqual([200, 200]);
    expect(responses.map((x) => x.body.replayed).sort()).toEqual([false, true]);
    expect(responses[0].body.commandId).toBe(responses[1].body.commandId);
    const db = await state();
    expect(db.commands).toHaveLength(1);
    expect(db.history).toHaveLength(2);
  });
  it('different keys racing the same transition have only one winner', async () => {
    const responses = await race(
      () => post(),
      () => post(orderId, 'confirm', key(), otherApp),
    );
    expect(responses.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(responses.find((x) => x.status === 409)?.body.code).toBe(
      'INVALID_ORDER_TRANSITION',
    );
    expect((await state()).commands).toHaveLength(1);
    expect((await state()).history).toHaveLength(2);
  });
  it('scope/key conflict on two different owned Orders does not mutate the losing Order', async () => {
    const second = await fixture();
    const header = key();
    const responses = await race(
      () => post(orderId, 'confirm', header),
      () => post(second, 'confirm', header, otherApp),
    );
    expect(responses.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(responses.find((x) => x.status === 409)?.body.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    const records = await prisma.orderCommand.findMany({
      where: { actorId: seller.id },
    });
    expect(records).toHaveLength(1);
    const loser = responses[0].status === 409 ? orderId : second;
    expect((await state(loser)).order?.status).toBe('PENDING_CONFIRMATION');
  });

  it.each(['history', 'receipt'] as const)(
    'real database %s failure rolls back Order, history and claim; same key can retry',
    async (stage) => {
      const functionName = `seller_cmd_fail_${Date.now()}_${serial++}`;
      const table =
        stage === 'history' ? 'order_status_history' : 'order_commands';
      const event = stage === 'history' ? 'INSERT' : 'UPDATE';
      // Identifiers are generated locally, never derived from request input.
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orderId" = ${orderId} THEN RAISE EXCEPTION 'fixture-private-database-failure'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER ${functionName} BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
      const header = key();
      const before = await state();
      try {
        const response = await post(orderId, 'confirm', header).expect(500);
        expect(response.body.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(response.body)).not.toContain('fixture-private');
        expect(await state()).toEqual(before);
      } finally {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER ${functionName} ON ${table}`,
        );
        await prisma.$executeRawUnsafe(`DROP FUNCTION ${functionName}()`);
      }
      await post(orderId, 'confirm', header).expect(200);
    },
  );
  it('bounded lock wait returns 409/Retry-After then same intent succeeds', async () => {
    let unlock!: () => void;
    let ready!: () => void;
    const release = new Promise<void>((r) => {
      unlock = r;
    });
    const locked = new Promise<void>((r) => {
      ready = r;
    });
    const blocker = otherPrisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
        ready();
        await release;
      },
      { timeout: 5000 },
    );
    await locked;
    const header = key();
    const before = await state();
    const started = Date.now();
    try {
      const response = await post(orderId, 'confirm', header).expect(409);
      expect(response.body.code).toBe('ORDER_COMMAND_IN_PROGRESS');
      expect(response.headers['retry-after']).toBe('1');
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      unlock();
      await blocker;
    }
    expect(await state()).toEqual(before);
    await post(orderId, 'confirm', header).expect(200);
  });
  it('keeps receipt across app restart and replay after a response was discarded', async () => {
    const header = key();
    const first = await post(orderId, 'confirm', header).expect(200);
    const before = await state();
    await otherApp.close();
    otherApp = await start();
    otherPrisma = otherApp.get(PrismaService);
    expect(
      (await post(orderId, 'confirm', header, otherApp).expect(200)).body,
    ).toEqual({ ...first.body, replayed: true });
    expect(await state()).toEqual(before);
  });

  it.each([
    null,
    [],
    { status: 'CONFIRMED' },
    { storeId: 1 },
    { actorId: 1 },
    { idempotencyKey: 'wrong' },
    { __extra: 1 },
  ])('rejects extra/malformed body %#', async (body) => {
    await post(orderId, 'confirm', key(), app, seller.token, body).expect(400);
    expect((await state()).commands).toHaveLength(0);
  });
  it('rejects missing/invalid key, query, noncanonical IDs and unsupported content type', async () => {
    const base = () =>
      request(app.getHttpServer())
        .post(`/seller/orders/${orderId}/confirm`)
        .set('Authorization', seller.token);
    expect((await base().send({}).expect(400)).body.code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    for (const invalid of ['short', 'a'.repeat(129), 'bad_key_with_dot_123.'])
      await post(orderId, 'confirm', invalid).expect(400);
    for (const id of ['0', '01', '-1', '2147483648', '1e2'])
      await request(app.getHttpServer())
        .post(`/seller/orders/${id}/confirm`)
        .set('Authorization', seller.token)
        .set('Idempotency-Key', key())
        .send({})
        .expect(400);
    await request(app.getHttpServer())
      .post(`/seller/orders/${orderId}/confirm?actorId=8`)
      .set('Authorization', seller.token)
      .set('Idempotency-Key', key())
      .send({})
      .expect(400);
    await base().set('Content-Type', 'text/plain').send('{}').expect(400);
    expect((await state()).commands).toHaveLength(0);
  });
  it('scoped parser protects aliases, malformed JSON and oversized chunked/gzip requests', async () => {
    const url = `/SELLER/ORDERS/${orderId}/CONFIRM/`;
    const send = () =>
      request(app.getHttpServer())
        .post(url)
        .set('Authorization', seller.token)
        .set('Idempotency-Key', key())
        .set('Content-Type', 'application/json');
    const malformed = await send().send('{"private":"do-not-echo"').expect(400);
    expect(JSON.stringify(malformed.body)).not.toContain('do-not-echo');
    const large = JSON.stringify({ private: 'x'.repeat(9000) });
    await send().send(large).expect(413);
    const stream = async (bytes: Buffer, encoding?: string) => {
      const base = await app.getUrl();
      return new Promise<number>((resolve, reject) => {
        const live = nodeRequest(
          `${base}${url}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: seller.token,
              'Idempotency-Key': key(),
              ...(encoding ? { 'Content-Encoding': encoding } : {}),
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode!));
          },
        );
        live.on('error', reject);
        live.setTimeout(5000, () =>
          live.destroy(new Error('Fixture HTTP timeout')),
        );
        live.write(bytes.subarray(0, Math.ceil(bytes.length / 2)));
        live.end(bytes.subarray(Math.ceil(bytes.length / 2)));
      });
    };
    expect(await stream(gzipSync(large), 'gzip')).toBe(413);
    expect(await stream(Buffer.from(large))).toBe(413);
    await send().send({}).expect(200);
  });
  it.each([
    'extra-json',
    'unsupported-version',
    'wrong-hash',
    'wrong-actor',
  ] as const)(
    'does not rebuild a persisted bad %s receipt from current Order state',
    async (flaw) => {
      const header = key();
      const input = prepareOrderCommand({
        actorId: seller.id,
        actorType: 'SELLER',
        orderId,
        command: 'confirm',
        idempotencyKey: header,
        body: {},
      });
      await prisma.orderCommand.create({
        data: {
          orderId,
          actorScope: input.actorScope,
          actorId: seller.id,
          actorType: flaw === 'wrong-actor' ? 'BUYER' : 'SELLER',
          command: 'confirm',
          idempotencyKey: header,
          requestHash:
            flaw === 'wrong-hash' ? '0'.repeat(64) : input.requestHash,
          hashVersion: flaw === 'unsupported-version' ? 2 : 1,
          status: 'SUCCEEDED',
          responseStatus: 200,
          resultSnapshot: { invalid: 'private-receipt-must-not-leak' },
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: new Date('2026-01-01T00:00:01.000Z'),
        },
      });
      const before = await state();
      const response = await post(orderId, 'confirm', header).expect(
        flaw === 'wrong-hash' ? 409 : 500,
      );
      expect(JSON.stringify(response.body)).not.toContain('private-receipt');
      expect(await state()).toEqual(before);
    },
  );
  it('command quota includes replay and all three paths, remains separate from Order reads', async () => {
    const header = key();
    await post(orderId, 'confirm', header).expect(200);
    for (let i = 1; i < 20; i++)
      await post(orderId, 'confirm', header).expect(200);
    const response = await post(orderId, 'start-packing').expect(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.body.code).toBe('RATE_LIMITED');
    await request(app.getHttpServer())
      .get('/seller/orders')
      .set('Authorization', seller.token)
      .expect(200);
    expect((await state()).commands).toHaveLength(1);
  });
  it('Swagger describes empty JSON, required key, bounded ID and HTTP 200 for each command', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    for (const command of ['confirm', 'start-packing', 'ready-to-ship']) {
      const operation =
        document.paths[`/seller/orders/{orderId}/${command}`].post;
      expect(operation?.responses['200']).toBeDefined();
      expect(operation?.parameters).toContainEqual(
        expect.objectContaining({
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
        }),
      );
      expect(operation?.requestBody).toMatchObject({
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', additionalProperties: false },
          },
        },
      });
    }
  });
  it('real HTTP COD checkout -> Seller commands -> Buyer/Seller detail preserves snapshots and replay', async () => {
    const category = await prisma.category.create({
      data: { name: 'Leaf fixture', slug: marker },
    });
    const product = await prisma.product.create({
      data: {
        storeId,
        categoryId: category.id,
        name: 'Purchased snapshot',
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        images: {
          create: {
            url: '/uploads/seller-command-fixture.jpg',
            isPrimary: true,
          },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        storeId,
        skuCode: `${marker}-sku`,
        price: '10000.00',
        stock: 5,
        optionSignature: 'default',
      },
    });
    const address = await prisma.userAddress.create({
      data: {
        userId: buyer.id,
        recipientName: 'Snapshot',
        phone: '0901234567',
        province: 'P',
        ward: 'W',
        addressLine: 'A',
      },
    });
    const cart = await prisma.cart.create({
      data: {
        userId: buyer.id,
        items: { create: { variantId: variant.id, quantity: 2 } },
      },
    });
    const created = await request(app.getHttpServer())
      .post('/checkouts')
      .set('Authorization', buyer.token)
      .set('Idempotency-Key', key())
      .send({
        addressId: address.id,
        paymentProvider: 'COD',
        items: [
          { variantId: variant.id, quantity: 2, expectedUnitPrice: '10000.00' },
        ],
      })
      .expect(201);
    const id = created.body.orders[0].id as number;
    const detail = (token: string, sellerRoute = false) =>
      request(app.getHttpServer())
        .get(`${sellerRoute ? '/seller' : ''}/orders/${id}`)
        .set('Authorization', token);
    const original = (await detail(buyer.token).expect(200)).body;
    await prisma.product.update({
      where: { id: product.id },
      data: { name: 'Changed catalog name' },
    });
    await prisma.userAddress.update({
      where: { id: address.id },
      data: { recipientName: 'Changed address' },
    });
    const inventory = async () => ({
      product: await prisma.product.findUnique({ where: { id: product.id } }),
      variant: await prisma.productVariant.findUnique({
        where: { id: variant.id },
      }),
      outbox: await prisma.searchOutbox.findMany({
        where: { productId: product.id },
      }),
      ledger: await prisma.stockMovement.findMany({
        where: { variantId: variant.id },
      }),
      items: await prisma.orderItem.findMany({ where: { orderId: id } }),
      checkout: await prisma.checkout.findUnique({
        where: { id: created.body.checkoutId },
      }),
      cart: await prisma.cartItem.findMany({ where: { cartId: cart.id } }),
      payment: await prisma.payment.findUnique({ where: { orderId: id } }),
    });
    const before = await inventory();
    const expected = ['CONFIRMED', 'PACKING', 'READY_TO_SHIP'];
    let firstReceipt: Record<string, unknown> | undefined;
    let firstKey = '';
    for (const [index, command] of [
      'confirm',
      'start-packing',
      'ready-to-ship',
    ].entries()) {
      const header = key();
      const response = await post(id, command, header).expect(200);
      if (index === 0) {
        firstReceipt = response.body;
        firstKey = header;
      }
      const buyerDetail = (await detail(buyer.token).expect(200)).body;
      const sellerDetail = (await detail(seller.token, true).expect(200)).body;
      for (const current of [buyerDetail, sellerDetail]) {
        expect(current.status).toBe(expected[index]);
        expect(current.items).toEqual(original.items);
        expect(current.shippingAddress).toEqual(original.shippingAddress);
        expect(current.payment).toEqual(original.payment);
        expect(
          current.timeline.map((entry: { toStatus: string }) => entry.toStatus),
        ).toEqual(['PENDING_CONFIRMATION', ...expected.slice(0, index + 1)]);
        for (const field of [
          'idempotencyKey',
          'requestHash',
          'receiptJson',
          'commands',
        ])
          expect(current).not.toHaveProperty(field);
      }
      expect(
        buyerDetail.timeline
          .slice(1)
          .every((entry: { actorId: number | null }) => entry.actorId === null),
      ).toBe(true);
      expect(
        sellerDetail.timeline
          .slice(1)
          .every(
            (entry: { actorId: number | null }) => entry.actorId === seller.id,
          ),
      ).toBe(true);
    }
    const beforeReplay = await state(id);
    expect(
      (await post(id, 'confirm', firstKey, otherApp).expect(200)).body,
    ).toEqual({ ...firstReceipt, replayed: true });
    expect(await state(id)).toEqual(beforeReplay);
    expect((await detail(buyer.token).expect(200)).body.status).toBe(
      'READY_TO_SHIP',
    );
    await detail(otherSeller.token, true).expect(404);
    expect(await inventory()).toEqual(before);
    expect((await state(id)).order?.status).toBe('READY_TO_SHIP');
  });
});
