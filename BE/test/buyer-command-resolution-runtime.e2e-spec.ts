import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Role } from '@prisma/client';
import { Pool } from 'pg';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { prepareOrderCommand } from '../src/order/order-command-request.js';
import { completeInput } from '../src/order/order-completion-request.js';
import { OrderCompletionService } from '../src/order/order-completion.service.js';
import { OrderCancellationService } from '../src/order/order-cancellation.service.js';
import { SellerOrderCommandService } from '../src/order/seller-order-command.service.js';
import { OrderDeliveryService } from '../src/order/order-delivery.service.js';
import { OrderReturnedService } from '../src/order/order-returned.service.js';
import { assertOrderResolutionQaTarget } from './helpers/order-resolution-qa-target.js';
import { startOrderResolutionResponseProxy } from './helpers/order-resolution-response-proxy.js';

// No destructive cleanup of immutable fences: all fixtures stay only in the
// dedicated disposable QA DB (or CI's isolated service database).
describe('Buyer resolution — real Checkout/HTTP/PostgreSQL', () => {
  let app: INestApplication,
    second: INestApplication,
    p: PrismaService,
    pool: Pool;
  type Actor = { id: number; token: string };
  let buyer: Actor, seller: Actor, other: Actor, admin: Actor;
  let orderId: number, productId: number, storeId: number;
  const marker = `buyer_resolution_${randomUUID()}`;
  let serial = 0;
  const key = () => `${marker}_${serial++}`;
  const reason = {
    reasonCode: 'CHANGED_MIND',
    reasonText: '  QA đổi ý mua hàng  ',
  };
  async function start() {
    const m = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const a = m.createNestApplication();
    configureApp(a);
    await a.listen(0, '127.0.0.1');
    return a;
  }
  async function actor(role: Role): Promise<Actor> {
    const u = await p.user.create({
      data: {
        email: `${marker}_${serial++}@example.test`,
        passwordHash: 'fixture-only',
        role,
      },
    });
    const c = app.get(ConfigService);
    return {
      id: u.id,
      token:
        'Bearer ' +
        app.get(JwtService).sign(
          { sub: u.id, role, email: u.email, type: 'access' },
          {
            secret: c.getOrThrow('JWT_ACCESS_SECRET'),
            issuer: c.get('JWT_ISSUER', 'klcn-ecommerce-api'),
            audience: c.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
            expiresIn: '10m',
          },
        ),
    };
  }
  function metadata(command: 'cancel' | 'complete', k: string, id = orderId) {
    return {
      command,
      hashVersion: 1,
      requestHash:
        command === 'cancel'
          ? prepareOrderCommand({
              actorId: buyer.id,
              actorType: 'BUYER',
              orderId: id,
              command: 'cancel',
              idempotencyKey: k,
              body: reason,
            }).requestHash
          : completeInput(buyer.id, id, k, {}).requestHash,
    };
  }
  const post = (path: string, k: string, body: unknown, a = app, who = buyer) =>
    request(a.getHttpServer())
      .post(path)
      .set('Authorization', who.token)
      .set('Idempotency-Key', k)
      .send(body as object);
  const resolve = (
    k: string,
    command: 'cancel' | 'complete' = 'cancel',
    a = app,
  ) => post(`/orders/${orderId}/resolve-command`, k, metadata(command, k), a);
  const execute = (
    k: string,
    command: 'cancel' | 'complete' = 'cancel',
    a = app,
  ) =>
    post(
      `/orders/${orderId}/${command}`,
      k,
      command === 'cancel' ? reason : {},
      a,
    );
  async function state() {
    return {
      order: await p.order.findUnique({ where: { id: orderId } }),
      payment: await p.payment.findUnique({ where: { orderId } }),
      items: await p.orderItem.findMany({
        where: { orderId },
        orderBy: { id: 'asc' },
      }),
      commands: await p.orderCommand.findMany({
        where: { orderId },
        orderBy: { id: 'asc' },
      }),
      history: await p.orderStatusHistory.findMany({
        where: { orderId },
        orderBy: { id: 'asc' },
      }),
      product: await p.product.findUnique({ where: { id: productId } }),
      variants: await p.productVariant.findMany({
        where: { productId },
        orderBy: { id: 'asc' },
      }),
      movements: await p.stockMovement.findMany({
        where: { orderItem: { orderId } },
        orderBy: { id: 'asc' },
      }),
      outbox: await p.searchOutbox.findMany({
        where: { productId },
        orderBy: { id: 'asc' },
      }),
      job: await p.orderCompletionJob.findUnique({ where: { orderId } }),
    };
  }
  async function deliver() {
    for (const c of ['confirm', 'start-packing', 'ready-to-ship'])
      await post(
        `/seller/orders/${orderId}/${c}`,
        key(),
        {},
        app,
        seller,
      ).expect(200);
    await post(
      `/admin/orders/${orderId}/ship`,
      key(),
      { trackingReference: 'QA-TRACK' },
      app,
      admin,
    ).expect(200);
    await post(
      `/admin/orders/${orderId}/mark-delivered`,
      key(),
      { trackingReference: 'QA-TRACK', deliveryAttempt: 1 },
      app,
      admin,
    ).expect(200);
  }
  beforeAll(async () => {
    const u = new URL(process.env.DATABASE_URL ?? '');
    if (!(
      process.env.GITHUB_ACTIONS === 'true' &&
      ['localhost', '127.0.0.1'].includes(u.hostname) &&
      u.pathname === '/klcn_ecommerce'
    ))
      assertOrderResolutionQaTarget(process.env.DATABASE_URL);
    app = await start();
    second = await start();
    p = app.get(PrismaService);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 6,
      statement_timeout: 7000,
      connectionTimeoutMillis: 3000,
    });
  });
  beforeEach(async () => {
    buyer = await actor('USER');
    seller = await actor('SELLER');
    other = await actor('USER');
    admin = await actor('ADMIN');
    storeId = (
      await p.store.create({
        data: { sellerId: seller.id, name: marker, status: 'ACTIVE' },
      })
    ).id;
    const cat = await p.category.create({
      data: { name: 'QA leaf', slug: key() },
    });
    productId = (
      await p.product.create({
        data: {
          storeId,
          categoryId: cat.id,
          name: 'QA original',
          sellerStatus: 'ACTIVE',
          moderationStatus: 'APPROVED',
          images: {
            create: {
              url: '/uploads/buyer-resolution-fixture.jpg',
              isPrimary: true,
            },
          },
          shippingProfile: { create: { packageWeightGrams: 100 } },
        },
      })
    ).id;
    const variants = [];
    for (let i = 0; i < 2; i++)
      variants.push(
        await p.productVariant.create({
          data: {
            storeId,
            productId,
            skuCode: key(),
            optionSignature: `qa-${i}`,
            stock: 2,
            price: '10000',
          },
        }),
      );
    const address = await p.userAddress.create({
      data: {
        userId: buyer.id,
        recipientName: 'QA Buyer',
        phone: '0900000000',
        province: 'QA',
        ward: 'QA',
        addressLine: 'QA fixture',
      },
    });
    const cart = await p.cart.create({ data: { userId: buyer.id } });
    for (const v of variants)
      await p.cartItem.create({
        data: { cartId: cart.id, variantId: v.id, quantity: 2 },
      });
    const checkout = await post('/checkouts', key(), {
      addressId: address.id,
      paymentProvider: 'COD',
      items: variants.map((v) => ({
        variantId: v.id,
        quantity: 2,
        expectedUnitPrice: '10000',
      })),
    }).expect(201);
    orderId = checkout.body.orders[0].id;
  });
  afterAll(async () => {
    await pool?.end();
    await second?.close();
    await app?.close();
  });

  it.each(['cancel', 'complete'] as const)(
    'closes %s key without any business mutation, replays same fence and blocks late execute',
    async (command) => {
      const k = key(),
        before = await state();
      const r = await resolve(k, command).expect(200);
      expect(Object.keys(r.body).sort()).toEqual([
        'command',
        'orderId',
        'outcome',
        'resolutionId',
        'resolvedAt',
      ]);
      expect(r.body.outcome).toBe('CLOSED_WITHOUT_EXECUTION');
      expect(r.headers['cache-control']).toBe('no-store');
      expect((await resolve(k, command, second).expect(200)).body).toEqual(
        r.body,
      );
      expect((await execute(k, command, second).expect(409)).body.code).toBe(
        'ORDER_COMMAND_CLOSED',
      );
      expect(await state()).toEqual(before);
      expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
        1,
      );
    },
  );
  it('cancel receipt replays exact original and restores two Variants with only one Product event', async () => {
    const k = key(),
      before = await state();
    const receipt = await execute(k).expect(200);
    const after = await state();
    expect(after.variants.map((v) => v.stock)).toEqual([2, 2]);
    expect(
      after.movements.filter((m) => m.type === 'CANCELLATION_RESTORE'),
    ).toHaveLength(2);
    expect(after.product!.version).toBe(before.product!.version + 1);
    expect(after.outbox).toHaveLength(before.outbox.length + 1);
    expect(after.outbox.at(-1)).toMatchObject({
      operation: 'UPSERT',
      productId,
      version: after.product!.version,
    });
    const r = await resolve(k).expect(200);
    expect(r.body).toEqual({
      outcome: 'COMMITTED',
      receipt: { ...receipt.body, replayed: true },
    });
    expect(await state()).toEqual(after);
    expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
      0,
    );
    await execute(k).expect(200);
    expect(await state()).toEqual(after);
  });
  it('complete receipt via real preparation/delivery returns Buyer result without further mutation', async () => {
    await deliver();
    const k = key();
    const first = await execute(k, 'complete').expect(200);
    const after = await state();
    expect((await resolve(k, 'complete', second).expect(200)).body).toEqual({
      outcome: 'COMMITTED',
      receipt: { ...first.body, replayed: true },
    });
    expect(await state()).toEqual(after);
    expect(first.body.result.timeline[0].actorType).toBe('BUYER');
  });
  it('rejects wrong canonical complete hash before creating a fence', async () => {
    await post(`/orders/${orderId}/resolve-command`, key(), {
      command: 'complete',
      hashVersion: 1,
      requestHash: 'f'.repeat(64),
    }).expect(400);
    expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
      0,
    );
  });
  it('no-record cancel may fence any valid fingerprint but cannot execute/restore', async () => {
    const before = await state(),
      k = key();
    await post(`/orders/${orderId}/resolve-command`, k, {
      command: 'cancel',
      hashVersion: 1,
      requestHash: 'a'.repeat(64),
    }).expect(200);
    expect((await execute(k).expect(409)).body.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    expect(await state()).toEqual(before);
  });
  it.each(['closed', 'committed'] as const)(
    '%s rejects mismatched fingerprint/command/order',
    async (kind) => {
      const k = key();
      if (kind === 'closed') await resolve(k).expect(200);
      else await execute(k).expect(200);
      const before = await state();
      await post(`/orders/${orderId}/resolve-command`, k, {
        ...metadata('cancel', k),
        requestHash: 'b'.repeat(64),
      }).expect(409);
      await resolve(k, 'complete').expect(409);
      const checkout = await p.checkout.create({
        data: {
          buyerId: buyer.id,
          idempotencyKey: key(),
          requestHash: 'controlled-secondary-fixture',
        },
      });
      const o = await p.order.create({
        data: {
          checkoutId: checkout.id,
          buyerId: buyer.id,
          storeId,
          orderNumber: key(),
          recipientNameSnapshot: 'QA',
          phoneSnapshot: '0900000000',
          provinceSnapshot: 'QA',
          wardSnapshot: 'QA',
          addressLineSnapshot: 'QA',
          subtotal: 1,
          total: 1,
          shippingFee: 0,
        },
      });
      await post(
        `/orders/${o.id}/resolve-command`,
        k,
        metadata('cancel', k, o.id),
      ).expect(409);
      expect(await state()).toEqual(before);
    },
  );
  it('ownership/account are canonical even on replay; execute eligibility is irrelevant', async () => {
    const k = key();
    await resolve(k).expect(200);
    await p.store.update({
      where: { id: storeId },
      data: { status: 'CLOSED' },
    });
    await p.payment.delete({ where: { orderId } });
    await resolve(k, 'cancel', second).expect(200);
    await post(
      `/orders/${orderId}/resolve-command`,
      k,
      metadata('cancel', k),
      app,
      other,
    ).expect(404);
    for (const who of [seller, admin])
      await post(
        `/orders/${orderId}/resolve-command`,
        k,
        metadata('cancel', k),
        app,
        who,
      ).expect(403);
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/resolve-command`)
      .send(metadata('cancel', k))
      .expect(401);
    await p.user.update({ where: { id: buyer.id }, data: { isActive: false } });
    await resolve(k).expect(401);
  });
  it.each([
    {},
    [],
    null,
    { command: 'cancel', hashVersion: true, requestHash: 'a'.repeat(64) },
    { command: 'cancel', hashVersion: 1, requestHash: 'A'.repeat(64) },
    {
      command: 'cancel',
      hashVersion: 1,
      requestHash: 'a'.repeat(64),
      actorScope: 'USER:1',
    },
  ])('rejects malformed body %#', async (body) => {
    await post(`/orders/${orderId}/resolve-command`, key(), body).expect(400);
  });
  it('scoped parser enforces JSON, query and decompressed 8KiB including route aliases', async () => {
    const path = `/ORDERS/${orderId}/RESOLVE-COMMAND/`,
      k = key();
    await post(path + '?x=1', k, metadata('cancel', k)).expect(400);
    await request(app.getHttpServer())
      .post(path)
      .set('Content-Type', 'text/plain')
      .send('bad')
      .expect(400);
    const zipped = gzipSync(
      JSON.stringify({ ...metadata('cancel', k), padding: 'x'.repeat(9000) }),
    );
    const r = await fetch(`${await app.getUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      },
      body: new Uint8Array(zipped),
    });
    expect(r.status).toBe(413);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('PROCESSING does not become a fence', async () => {
    const k = key(),
      m = metadata('cancel', k);
    const c = await pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await c.query(
        'INSERT INTO order_commands("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion") VALUES($1,$2,\'BUYER\',$3,$4,\'cancel\',$5,1)',
        [orderId, buyer.id, `USER:${buyer.id}`, k, m.requestHash],
      );
      expect((await resolve(k).expect(409)).body.code).toBe(
        'ORDER_COMMAND_IN_PROGRESS',
      );
      expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
        0,
      );
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    // Deferred DB invariant forbids permanently committed PROCESSING rows.
    await resolve(k).expect(200);
  });
  it('SYSTEM D07 receipt is never borrowed as Buyer COMMITTED', async () => {
    await deliver();
    // Controlled due-date fixture; execute the existing internal job path, not a fake receipt.
    const deliveredAt = new Date(Date.now() - 4 * 86400000);
    await p.order.update({ where: { id: orderId }, data: { deliveredAt } });
    await p.payment.update({
      where: { orderId },
      data: { paidAt: deliveredAt },
    });
    const token = randomUUID();
    const job = await p.orderCompletionJob.create({
      data: {
        orderId,
        deliveredAt,
        dueAt: new Date(Date.now() - 1000),
        status: 'RUNNING',
        leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + 60000),
        attemptCount: 1,
      },
    });
    const system = await app
      .get(OrderCompletionService)
      .completeJob(job.id, token);
    expect(system!.result.timeline[0].actorType).toBe('SYSTEM');
    const before = await state();
    const r = await resolve(key(), 'complete').expect(200);
    expect(r.body.outcome).toBe('CLOSED_WITHOUT_EXECUTION');
    expect(await state()).toEqual(before);
  });
  it('restart and dropped response after commit replay the same durable result', async () => {
    const k = key(),
      proxy = await startOrderResolutionResponseProxy(await app.getUrl());
    try {
      proxy.dropNextSuccess();
      await expect(
        fetch(`${proxy.origin}/orders/${orderId}/resolve-command`, {
          method: 'POST',
          headers: {
            Authorization: buyer.token,
            'Idempotency-Key': k,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(metadata('cancel', k)),
        }),
      ).rejects.toThrow();
      expect(proxy.stats().discarded).toBe(1);
    } finally {
      await proxy.close();
    }
    const row = await p.orderCommandResolution.findFirstOrThrow({
      where: { orderId },
    });
    await second.close();
    second = await start();
    expect(
      (await resolve(k, 'cancel', second).expect(200)).body.resolutionId,
    ).toBe(row.id);
  });
  it.each(['insert', 'commit'])(
    'fence %s error rolls back and never sends success',
    async (fault) => {
      const k = key(),
        before = await state(),
        suffix = String(orderId);
      await pool.query(
        `CREATE FUNCTION buyer_fail_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orderId"=${orderId} THEN RAISE EXCEPTION 'controlled QA fault'; END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        fault === 'insert'
          ? `CREATE TRIGGER buyer_fail_${suffix} BEFORE INSERT ON order_command_resolutions FOR EACH ROW EXECUTE FUNCTION buyer_fail_${suffix}()`
          : `CREATE CONSTRAINT TRIGGER buyer_fail_${suffix} AFTER INSERT ON order_command_resolutions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION buyer_fail_${suffix}()`,
      );
      try {
        await resolve(k).expect(500);
        expect(await state()).toEqual(before);
        expect(
          await p.orderCommandResolution.count({ where: { orderId } }),
        ).toBe(0);
      } finally {
        await pool.query(
          `DROP TRIGGER buyer_fail_${suffix} ON order_command_resolutions`,
        );
        await pool.query(`DROP FUNCTION buyer_fail_${suffix}()`);
      }
      await resolve(k).expect(200);
    },
  );
  it.each(['cancel', 'complete'] as const)(
    'two resolvers %s produce one fence',
    async (command) => {
      const k = key();
      const [a, b] = await Promise.all([
        resolve(k, command),
        resolve(k, command, second),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body).toEqual(b.body);
      expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
        1,
      );
    },
  );
  it.each(['cancel', 'complete'] as const)(
    'real HTTP %s execute/resolver DB barriers prove both commit orders',
    async (command) => {
      if (command === 'complete') await deliver();
      // Two rounds use independent Orders (second round below needs unchanged state
      // after first fence). Resolve-first proves no execution; then fresh-key execute-first.
      for (const winner of ['resolution', 'command'] as const) {
        const gate = await pool.connect(),
          k = key(),
          suffix = `${orderId}_${winner}`;
        const table =
          winner === 'command' ? 'order_commands' : 'order_command_resolutions';
        await pool.query(
          `CREATE FUNCTION buyer_gate_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orderId"=${orderId} THEN PERFORM pg_advisory_xact_lock(90211,${orderId}); END IF; RETURN NEW; END $$`,
        );
        await pool.query(
          `CREATE TRIGGER buyer_gate_${suffix} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION buyer_gate_${suffix}()`,
        );
        let first: Promise<request.Response> | undefined,
          opponent: Promise<request.Response> | undefined;
        try {
          await gate.query('SELECT pg_advisory_lock(90211,$1)', [orderId]);
          first = (
            winner === 'command' ? execute(k, command) : resolve(k, command)
          ).then((r) => r);
          const deadline = Date.now() + 3000;
          while (
            !(
              await pool.query(
                "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=90211 AND objid=$1 AND NOT granted",
                [orderId],
              )
            ).rowCount
          ) {
            if (Date.now() > deadline)
              throw new Error('HTTP did not reach database barrier');
            await new Promise<void>((r) => setImmediate(r));
          }
          opponent = (
            winner === 'command'
              ? resolve(k, command, second)
              : execute(k, command, second)
          ).then((r) => r);
          await gate.query('SELECT pg_advisory_unlock(90211,$1)', [orderId]);
          const [a, b] = await Promise.all([first, opponent]);
          expect(a.status).toBe(200);
          if (winner === 'command') {
            expect(b.status).toBe(200);
            expect(b.body.outcome).toBe('COMMITTED');
            expect(b.body.receipt.commandId).toBe(a.body.commandId);
          } else {
            expect(b.status).toBe(409);
            expect(b.body.code).toBe('ORDER_COMMAND_CLOSED');
          }
          const where = { actorScope: `USER:${buyer.id}`, idempotencyKey: k };
          expect(await p.orderCommand.count({ where })).toBe(
            winner === 'command' ? 1 : 0,
          );
          expect(await p.orderCommandResolution.count({ where })).toBe(
            winner === 'resolution' ? 1 : 0,
          );
        } finally {
          await gate.query('SELECT pg_advisory_unlock(90211,$1)', [orderId]);
          await Promise.allSettled(
            [first, opponent].filter(
              (v): v is Promise<request.Response> => !!v,
            ),
          );
          await pool.query(`DROP TRIGGER buyer_gate_${suffix} ON ${table}`);
          await pool.query(`DROP FUNCTION buyer_gate_${suffix}()`);
          gate.release();
        }
      }
    },
  );
  it('default quota is independent from execute and includes replays', async () => {
    const k = key();
    for (let i = 0; i < 20; i++) await resolve(k).expect(200);
    const limited = await resolve(k).expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
    await execute(key()).expect(200); // resolver bucket exhaustion cannot consume execution bucket
  });
  it.each(['seller', 'cancel', 'delivery', 'returned', 'complete'])(
    'Buyer fence survives role change across %s writer',
    async (writer) => {
      const k = key();
      await resolve(k).expect(200);
      const role =
        writer === 'delivery' || writer === 'returned'
          ? 'ADMIN'
          : writer === 'complete'
            ? 'USER'
            : 'SELLER';
      await p.user.update({ where: { id: buyer.id }, data: { role } });
      if (role === 'SELLER')
        await p.store.update({
          where: { id: storeId },
          data: { sellerId: buyer.id },
        });
      const before = await state();
      let result: Promise<unknown>;
      if (writer === 'seller')
        result = app
          .get(SellerOrderCommandService)
          .execute(buyer.id, orderId, 'confirm', k, {});
      else if (writer === 'cancel')
        result = app
          .get(OrderCancellationService)
          .cancel(buyer.id, 'SELLER', orderId, k, {
            reasonCode: 'CANNOT_FULFIL',
            reasonText: 'QA',
          });
      else if (writer === 'delivery')
        result = app
          .get(OrderDeliveryService)
          .execute(buyer.id, orderId, 'ship', k, { trackingReference: 'QA' });
      else if (writer === 'returned')
        result = app
          .get(OrderReturnedService)
          .execute(buyer.id, 'ADMIN', orderId, k, {
            reasonCode: 'LOST',
            reasonText: 'QA',
            restockable: false,
            receiptReference: null,
          });
      else
        result = app
          .get(OrderCompletionService)
          .completeBuyer(buyer.id, orderId, k, {});
      await expect(result).rejects.toMatchObject({
        response: { code: 'IDEMPOTENCY_CONFLICT' },
      });
      expect(await state()).toEqual(before);
    },
  );
  it('Seller confirmation does not fabricate a Buyer cancellation receipt', async () => {
    await post(
      `/seller/orders/${orderId}/confirm`,
      key(),
      {},
      app,
      seller,
    ).expect(200);
    const before = await state(),
      k = key();
    expect((await resolve(k).expect(200)).body.outcome).toBe(
      'CLOSED_WITHOUT_EXECUTION',
    );
    expect(await state()).toEqual(before);
    expect((await execute(k).expect(409)).body.code).toBe(
      'ORDER_COMMAND_CLOSED',
    );
  });
  it('corrupt valid-shaped cancellation snapshot cannot become COMMITTED', async () => {
    const receipt = await execute(key()).expect(200),
      k = key();
    const bad = structuredClone(receipt.body.result);
    bad.cancellation.reasonText = 'Different reason';
    bad.timeline[0].reasonText = 'Different reason';
    await p.$transaction(
      (tx) =>
        tx.orderCommand.create({
          data: {
            orderId,
            actorId: buyer.id,
            actorType: 'BUYER',
            actorScope: `USER:${buyer.id}`,
            idempotencyKey: k,
            command: 'cancel',
            requestHash: metadata('cancel', k).requestHash,
            hashVersion: 1,
            status: 'SUCCEEDED',
            responseStatus: 200,
            resultSnapshot: bad,
            // One deterministic clock for the deliberately corrupt snapshot fixture.
            // Keep receipt_check intact; this case must reach the resolver itself.
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            completedAt: new Date('2026-01-01T00:00:01.000Z'),
          },
        }),
      { isolationLevel: 'Serializable' },
    );
    const before = await state();
    await resolve(k).expect(500);
    expect(await state()).toEqual(before);
    expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
      0,
    );
  });
  it('retries serialization at most three times, no fence survives a failed attempt', async () => {
    const suffix = String(orderId),
      k = key();
    await pool.query(`CREATE SEQUENCE buyer_retry_${suffix}`);
    await pool.query(
      `CREATE FUNCTION buyer_retry_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orderId"=${orderId} THEN PERFORM nextval('buyer_retry_${suffix}'); RAISE EXCEPTION 'controlled serialization failure' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER buyer_retry_${suffix} BEFORE INSERT ON order_command_resolutions FOR EACH ROW EXECUTE FUNCTION buyer_retry_${suffix}()`,
    );
    try {
      const before = await state();
      const r = await resolve(k).expect(409);
      expect(r.body.code).toBe('ORDER_COMMAND_IN_PROGRESS');
      expect(r.headers['retry-after']).toBe('1');
      expect(
        Number(
          (await pool.query(`SELECT last_value FROM buyer_retry_${suffix}`))
            .rows[0].last_value,
        ),
      ).toBe(3);
      expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
        0,
      );
      expect(await state()).toEqual(before);
    } finally {
      await pool.query(
        `DROP TRIGGER buyer_retry_${suffix} ON order_command_resolutions`,
      );
      await pool.query(`DROP FUNCTION buyer_retry_${suffix}()`);
      await pool.query(`DROP SEQUENCE buyer_retry_${suffix}`);
    }
    await resolve(k).expect(200);
  });
  it.each(['command', 'resolution'])(
    'stale SQL snapshot cannot commit opposing Buyer outcome after %s',
    async (winner) => {
      const a = await pool.connect(),
        b = await pool.connect(),
        k = key();
      const insert = (c: typeof a, kind: string) =>
        kind === 'resolution'
          ? c.query(
              'INSERT INTO order_command_resolutions("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion") VALUES($1,$2,\'BUYER\',$3,$4,\'cancel\',$5,1)',
              [
                orderId,
                buyer.id,
                `USER:${buyer.id}`,
                k,
                metadata('cancel', k).requestHash,
              ],
            )
          : c.query(
              'INSERT INTO order_commands("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion",status,"responseStatus","resultSnapshot","completedAt") VALUES($1,$2,\'BUYER\',$3,$4,\'cancel\',$5,1,\'SUCCEEDED\',200,\'{}\',CURRENT_TIMESTAMP)',
              [
                orderId,
                buyer.id,
                `USER:${buyer.id}`,
                k,
                metadata('cancel', k).requestHash,
              ],
            );
      try {
        for (const c of [a, b]) {
          await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
          await c.query('SELECT count(*) FROM order_commands');
          await c.query('SELECT count(*) FROM order_command_resolutions');
        }
        await insert(a, winner);
        await a.query('COMMIT');
        let failed = false;
        try {
          await insert(b, winner === 'command' ? 'resolution' : 'command');
          await b.query('COMMIT');
        } catch (error) {
          expect(['40001', '23514']).toContain(
            (error as { code: string }).code,
          );
          failed = true;
          await b.query('ROLLBACK');
        }
        expect(failed).toBe(true);
        const where = { actorScope: `USER:${buyer.id}`, idempotencyKey: k };
        expect(
          (await p.orderCommand.count({ where })) +
            (await p.orderCommandResolution.count({ where })),
        ).toBe(1);
      } finally {
        await a.query('ROLLBACK');
        await b.query('ROLLBACK');
        a.release();
        b.release();
      }
    },
  );
});
