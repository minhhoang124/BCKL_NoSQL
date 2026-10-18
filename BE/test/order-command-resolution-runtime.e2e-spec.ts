import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { Pool } from 'pg';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { prepareOrderCommand } from '../src/order/order-command-request.js';
import { OrderCancellationService } from '../src/order/order-cancellation.service.js';
import { OrderCompletionService } from '../src/order/order-completion.service.js';
import { OrderReturnedService } from '../src/order/order-returned.service.js';
import { OrderDeliveryService } from '../src/order/order-delivery.service.js';
import { assertOrderResolutionQaTarget } from './helpers/order-resolution-qa-target.js';
import { startOrderResolutionResponseProxy } from './helpers/order-resolution-response-proxy.js';

// Permanent fences are deliberately NOT deleted. This suite ONLY uses a
// disposable resolution DB (or GitHub's disposable service). No reset/seed.
describe('Resolver HTTP + full PostgreSQL schema', () => {
  let app: INestApplication,
    second: INestApplication,
    p: PrismaService,
    pool: Pool;
  let seller: { id: number; token: string },
    buyer: { id: number; token: string },
    other: { id: number; token: string };
  let storeId: number, orderId: number;
  const marker = `resolution_${randomUUID()}`;
  let serial = 0;
  const key = () => `${marker}_${serial++}`;
  async function start() {
    const m = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const a = m.createNestApplication();
    configureApp(a);
    await a.listen(0, '127.0.0.1');
    return a;
  }
  async function actor(role: Role) {
    const u = await p.user.create({
      data: {
        email: `${marker}_${serial++}@example.test`,
        passwordHash: 'test-only',
        role,
      },
    });
    const c = app.get(ConfigService);
    return {
      id: u.id,
      token: `Bearer ${app.get(JwtService).sign({ sub: u.id, role, email: u.email, type: 'access' }, { secret: c.getOrThrow('JWT_ACCESS_SECRET'), issuer: c.get('JWT_ISSUER', 'klcn-ecommerce-api'), audience: c.get('JWT_AUDIENCE', 'klcn-ecommerce-web'), expiresIn: '10m' })}`,
    };
  }
  const post = (
    action: string,
    k: string,
    body: unknown = {},
    a = app,
    token = seller.token,
    id = orderId,
  ) =>
    request(a.getHttpServer())
      .post(`/seller/orders/${id}/${action}`)
      .set('Authorization', token)
      .set('Idempotency-Key', k)
      .send(body as object);
  const resolve = (k: string, command = 'confirm', a = app) =>
    post('resolve-command', k, { command }, a);
  async function state() {
    return {
      order: await p.order.findUnique({ where: { id: orderId } }),
      payment: await p.payment.findUnique({ where: { orderId } }),
      history: await p.orderStatusHistory.findMany({ where: { orderId } }),
      commands: await p.orderCommand.findMany({ where: { orderId } }),
    };
  }
  beforeAll(async () => {
    const u = new URL(process.env.DATABASE_URL ?? '');
    if (!(
      process.env.GITHUB_ACTIONS === 'true' &&
      ['127.0.0.1', 'localhost'].includes(u.hostname) &&
      u.pathname === '/klcn_ecommerce'
    ))
      assertOrderResolutionQaTarget(process.env.DATABASE_URL);
    app = await start();
    second = await start();
    p = app.get(PrismaService);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      statement_timeout: 6000,
      connectionTimeoutMillis: 3000,
      max: 4,
    });
    buyer = await actor('USER');
    other = await actor('SELLER');
  });
  beforeEach(async () => {
    // Preserve the real default quota; isolate actors instead of raising limits.
    seller = await actor('SELLER');
    storeId = (
      await p.store.create({
        data: { sellerId: seller.id, name: marker, status: 'ACTIVE' },
      })
    ).id;
    const checkout = await p.checkout.create({
      data: {
        buyerId: buyer.id,
        idempotencyKey: key(),
        requestHash: 'controlled-fixture',
      },
    });
    orderId = (
      await p.order.create({
        data: {
          checkoutId: checkout.id,
          buyerId: buyer.id,
          storeId,
          orderNumber: key(),
          recipientNameSnapshot: 'QA Buyer',
          phoneSnapshot: '0900000000',
          provinceSnapshot: 'QA',
          wardSnapshot: 'QA',
          addressLineSnapshot: 'QA fixture',
          subtotal: 10000,
          total: 10000,
          shippingFee: 0,
          payment: { create: { provider: 'COD', amount: 10000 } },
          statusHistory: {
            create: {
              actorId: buyer.id,
              actorType: 'BUYER',
              fromStatus: null,
              toStatus: 'PENDING_CONFIRMATION',
            },
          },
        },
      })
    ).id;
  });
  afterAll(async () => {
    await pool?.end();
    await app?.close();
    await second?.close();
  });
  it('R02 closes a key durably and idempotently without changing business state', async () => {
    const k = key(),
      before = await state();
    const r = await resolve(k).expect(200);
    expect(Object.keys(r.body).sort()).toEqual([
      'command',
      'orderId',
      'outcome',
      'resolutionId',
      'resolvedAt',
    ]);
    expect(r.body.outcome).toBe('CLOSED_WITHOUT_EXECUTION');
    expect(r.headers['cache-control']).toBe('no-store');
    expect((await resolve(k, 'confirm', second).expect(200)).body).toEqual(
      r.body,
    );
    expect(await state()).toEqual(before);
    expect(
      await p.orderCommandResolution.count({
        where: { actorScope: `USER:${seller.id}`, idempotencyKey: k },
      }),
    ).toBe(1);
    expect((await post('confirm', k).expect(409)).body.code).toBe(
      'ORDER_COMMAND_CLOSED',
    );
  });
  it('R01 returns the ORIGINAL receipt after Order advances', async () => {
    const k = key();
    const first = await post('confirm', k).expect(200);
    await post('start-packing', key()).expect(200);
    const r = await resolve(k).expect(200);
    expect(r.body).toEqual({
      outcome: 'COMMITTED',
      receipt: { ...first.body, replayed: true },
    });
    expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
      0,
    );
  });
  it('R05 conflicts on another command for the same scoped key', async () => {
    const k = key();
    await resolve(k).expect(200);
    expect((await resolve(k, 'start-packing').expect(409)).body.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
  });
  it.each(['closed', 'committed'] as const)(
    'R05 %s key cannot be reused on another owned Order',
    async (outcome) => {
      const k = key();
      if (outcome === 'closed') await resolve(k).expect(200);
      else await post('confirm', k).expect(200);
      const checkout = await p.checkout.create({
        data: {
          buyerId: buyer.id,
          idempotencyKey: key(),
          requestHash: 'second-order-fixture',
        },
      });
      const otherOrder = await p.order.create({
        data: {
          checkoutId: checkout.id,
          buyerId: buyer.id,
          storeId,
          orderNumber: key(),
          recipientNameSnapshot: 'QA Buyer',
          phoneSnapshot: '0900000000',
          provinceSnapshot: 'QA',
          wardSnapshot: 'QA',
          addressLineSnapshot: 'QA fixture',
          subtotal: 10000,
          total: 10000,
          shippingFee: 0,
        },
      });
      const before = await state();
      const response = await post(
        'resolve-command',
        k,
        { command: 'confirm' },
        app,
        seller.token,
        otherOrder.id,
      ).expect(409);
      expect(response.body.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(await state()).toEqual(before);
      expect(
        await p.orderCommandResolution.count({
          where: { orderId: otherOrder.id },
        }),
      ).toBe(0);
      expect(
        await p.orderCommand.count({ where: { orderId: otherOrder.id } }),
      ).toBe(0);
    },
  );
  it('R05 original execution hash mismatch fails before creating a resolution', async () => {
    const k = key();
    const input = prepareOrderCommand({
      actorId: seller.id,
      actorType: 'SELLER',
      orderId,
      command: 'confirm',
      idempotencyKey: k,
      body: {},
    });
    await p.$transaction(
      (tx) =>
        tx.orderCommand.create({
          data: {
            orderId,
            actorId: seller.id,
            actorType: 'SELLER',
            actorScope: input.actorScope,
            idempotencyKey: k,
            command: 'confirm',
            requestHash:
              input.requestHash === 'a'.repeat(64)
                ? 'b'.repeat(64)
                : 'a'.repeat(64),
            hashVersion: 1,
            status: 'SUCCEEDED',
            responseStatus: 200,
            resultSnapshot: {},
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            completedAt: new Date('2026-01-01T00:00:01.000Z'),
          },
        }),
      { isolationLevel: 'Serializable' },
    );
    const before = await state();
    expect((await resolve(k).expect(409)).body.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    expect(await state()).toEqual(before);
    expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
      0,
    );
  });
  it('R06 independent apps resolving concurrently persist one outcome', async () => {
    const k = key();
    const [a, b] = await Promise.all([
      resolve(k),
      resolve(k, 'confirm', second),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
  });
  it('R06 a newly bootstrapped application replays a persistent resolution', async () => {
    const k = key();
    const first = await resolve(k).expect(200);
    await second.close();
    second = await start();
    expect((await resolve(k, 'confirm', second).expect(200)).body).toEqual(
      first.body,
    );
  });
  it('R08 database insert failure rolls back without a success response', async () => {
    const k = key(),
      before = await state();
    // DB-level fault, not an HTTP mock. Trigger is scoped to this fixture Order.
    const suffix = String(orderId);
    await pool.query(
      `CREATE FUNCTION resolver_fault_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orderId"=${orderId} THEN RAISE EXCEPTION 'controlled QA failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER resolver_fault_${suffix} BEFORE INSERT ON order_command_resolutions FOR EACH ROW EXECUTE FUNCTION resolver_fault_${suffix}()`,
    );
    try {
      await resolve(k).expect(500);
      expect(await state()).toEqual(before);
      expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
        0,
      );
    } finally {
      await pool.query(
        `DROP TRIGGER resolver_fault_${suffix} ON order_command_resolutions`,
      );
      await pool.query(`DROP FUNCTION resolver_fault_${suffix}()`);
    }
    await resolve(k).expect(200);
  });
  it('R07 socket loss after HTTP200 retains the durable result for replay', async () => {
    const k = key();
    const proxy = await startOrderResolutionResponseProxy(await app.getUrl());
    try {
      proxy.dropNextSuccess();
      await expect(
        fetch(`${proxy.origin}/seller/orders/${orderId}/resolve-command`, {
          method: 'POST',
          headers: {
            Authorization: seller.token,
            'Idempotency-Key': k,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ command: 'confirm' }),
        }),
      ).rejects.toThrow();
      expect(proxy.stats().discarded).toBe(1);
      const row = await p.orderCommandResolution.findUniqueOrThrow({
        where: {
          actorScope_idempotencyKey: {
            actorScope: `USER:${seller.id}`,
            idempotencyKey: k,
          },
        },
      });
      expect(
        (await resolve(k, 'confirm', second).expect(200)).body.resolutionId,
      ).toBe(row.id);
    } finally {
      await proxy.close();
    }
  });
  it('R14 ignores execute Store/Payment policy but not current ownership/account', async () => {
    await p.store.update({
      where: { id: storeId },
      data: { status: 'REJECTED' },
    });
    await p.payment.delete({ where: { orderId } });
    const k = key();
    await resolve(k).expect(200);
    await post(
      'resolve-command',
      k,
      { command: 'confirm' },
      app,
      other.token,
    ).expect(404);
    await post(
      'resolve-command',
      k,
      { command: 'confirm' },
      app,
      buyer.token,
    ).expect(403);
    await p.user.update({
      where: { id: seller.id },
      data: { isActive: false },
    });
    await resolve(k).expect(401);
  });
  it.each([
    null,
    [],
    {},
    { command: 'cancel' },
    { command: 'confirm', actorId: 1 },
    { command: 1 },
  ])('R15 strict body rejects %#', async (body) => {
    await post('resolve-command', key(), body).expect(400);
  });
  it('R15 rejects query/oversize/wrong content type with no-store', async () => {
    const base = `/seller/orders/${orderId}/resolve-command`;
    await request(app.getHttpServer())
      .post(`${base}?x=1`)
      .set('Authorization', seller.token)
      .set('Idempotency-Key', key())
      .send({ command: 'confirm' })
      .expect(400);
    const large = await post('resolve-command', key(), {
      command: 'confirm',
      padding: 'x'.repeat(9000),
    }).expect(413);
    expect(large.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer())
      .post(base)
      .set('Content-Type', 'text/plain')
      .send('bad')
      .expect(400);
  });
  it('R24 a fresh key can succeed while the closed key remains blocked', async () => {
    const k = key();
    await resolve(k).expect(200);
    await post('confirm', key()).expect(200);
    await post('confirm', k).expect(409);
  });
  it('R17 DB lock timeout is bounded, does not close the key and permits retry', async () => {
    const c = await pool.connect(),
      k = key();
    try {
      await c.query('BEGIN');
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [seller.id]);
      const started = Date.now();
      const r = await resolve(k).expect(409);
      expect(r.body.code).toBe('ORDER_COMMAND_IN_PROGRESS');
      expect(r.headers['retry-after']).toBeDefined();
      expect(Date.now() - started).toBeLessThan(8000);
      expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
        0,
      );
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    await resolve(k).expect(200);
  });
  it('R18 corrupt committed receipt fails closed without creating a fence', async () => {
    const k = key();
    const input = prepareOrderCommand({
      actorId: seller.id,
      actorType: 'SELLER',
      orderId,
      command: 'confirm',
      idempotencyKey: k,
      body: {},
    });
    await p.$transaction(
      (tx) =>
        tx.orderCommand.create({
          data: {
            orderId,
            actorId: seller.id,
            actorType: 'SELLER',
            actorScope: input.actorScope,
            idempotencyKey: k,
            command: 'confirm',
            requestHash: input.requestHash,
            hashVersion: 1,
            status: 'SUCCEEDED',
            responseStatus: 200,
            resultSnapshot: {},
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            completedAt: new Date('2026-01-01T00:00:01.000Z'),
          },
        }),
      { isolationLevel: 'Serializable' },
    );
    await resolve(k).expect(500);
    expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
      0,
    );
  });
  it.each(['command', 'resolution'] as const)(
    'R03/R04 real HTTP %s reaches DB barrier before its opponent',
    async (winner) => {
      const gate = await pool.connect();
      const table =
        winner === 'command' ? 'order_commands' : 'order_command_resolutions';
      const suffix = String(orderId),
        k = key();
      await pool.query(
        `CREATE FUNCTION resolver_barrier_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orderId"=${orderId} THEN PERFORM pg_advisory_xact_lock(90210,${orderId}); END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        `CREATE TRIGGER resolver_barrier_${suffix} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION resolver_barrier_${suffix}()`,
      );
      let first: Promise<request.Response> | undefined;
      let opponent: Promise<request.Response> | undefined;
      try {
        await gate.query('SELECT pg_advisory_lock(90210,$1)', [orderId]);
        first = (winner === 'command' ? post('confirm', k) : resolve(k)).then(
          (r) => r,
        );
        const deadline = Date.now() + 3000;
        while (true) {
          const waiting = await pool.query(
            "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=90210 AND objid=$1 AND NOT granted",
            [orderId],
          );
          if (waiting.rowCount) break;
          if (Date.now() >= deadline)
            throw new Error('HTTP did not reach DB barrier');
          await new Promise<void>((done) => setImmediate(done));
        }
        opponent = (
          winner === 'command'
            ? resolve(k, 'confirm', second)
            : post('confirm', k, {}, second)
        ).then((r) => r);
        await gate.query('SELECT pg_advisory_unlock(90210,$1)', [orderId]);
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
        expect(await p.orderCommand.count({ where: { orderId } })).toBe(
          winner === 'command' ? 1 : 0,
        );
        expect(
          await p.orderCommandResolution.count({ where: { orderId } }),
        ).toBe(winner === 'resolution' ? 1 : 0);
      } finally {
        await gate.query('SELECT pg_advisory_unlock(90210,$1)', [orderId]);
        await Promise.allSettled(
          [first, opponent].filter((p): p is Promise<request.Response> => !!p),
        );
        await pool.query(`DROP TRIGGER resolver_barrier_${suffix} ON ${table}`);
        await pool.query(`DROP FUNCTION resolver_barrier_${suffix}()`);
        gate.release();
      }
    },
  );
  it('resolver and execution share the default 20-request actor quota', async () => {
    const k = key();
    await resolve(k).expect(200);
    for (let i = 0; i < 18; i++) await resolve(k).expect(200);
    await post('confirm', key()).expect(200);
    const limited = await resolve(k).expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.headers['cache-control']).toBe('no-store');
  });
  it.each(['cancel', 'returned', 'delivery', 'complete'] as const)(
    'R09 %s writer cannot reuse a fenced USER key after role changes',
    async (writer) => {
      const k = key();
      await resolve(k).expect(200);
      const role =
        writer === 'complete'
          ? 'USER'
          : writer === 'cancel'
            ? 'SELLER'
            : 'ADMIN';
      await p.user.update({ where: { id: seller.id }, data: { role } });
      if (writer === 'complete') {
        // Synthetic ownership fixture must still obey the composite Checkout FK.
        const checkout = await p.checkout.create({
          data: {
            buyerId: seller.id,
            idempotencyKey: key(),
            requestHash: 'role-change-fixture',
          },
        });
        await p.order.update({
          where: { id: orderId },
          data: { buyerId: seller.id, checkoutId: checkout.id },
        });
      }
      const before = await state();
      let result: Promise<unknown>;
      if (writer === 'cancel')
        result = app
          .get(OrderCancellationService)
          .cancel(seller.id, 'SELLER', orderId, k, {
            reasonCode: 'CANNOT_FULFIL',
            reasonText: 'QA cancellation',
          });
      else if (writer === 'returned')
        result = app
          .get(OrderReturnedService)
          .execute(seller.id, 'ADMIN', orderId, k, {
            reasonCode: 'LOST',
            reasonText: 'QA loss',
            restockable: false,
            receiptReference: null,
          });
      else if (writer === 'delivery')
        result = app
          .get(OrderDeliveryService)
          .execute(seller.id, orderId, 'ship', k, {
            trackingReference: 'QA-TRACKING',
          });
      else
        result = app
          .get(OrderCompletionService)
          .completeBuyer(seller.id, orderId, k, {});
      await expect(result).rejects.toMatchObject({
        response: { code: 'IDEMPOTENCY_CONFLICT' },
      });
      expect(await state()).toEqual(before);
      expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
        1,
      );
    },
  );
  it('R17 repeated serialization conflicts exhaust exactly three attempts', async () => {
    const suffix = String(orderId),
      k = key();
    await pool.query(`CREATE SEQUENCE resolver_retry_${suffix}`);
    await pool.query(
      `CREATE FUNCTION resolver_retry_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."orderId"=${orderId} THEN PERFORM nextval('resolver_retry_${suffix}'); RAISE EXCEPTION 'controlled serialization failure' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER resolver_retry_${suffix} BEFORE INSERT ON order_command_resolutions FOR EACH ROW EXECUTE FUNCTION resolver_retry_${suffix}()`,
    );
    try {
      const r = await resolve(k).expect(409);
      expect(r.body.code).toBe('ORDER_COMMAND_IN_PROGRESS');
      expect(
        Number(
          (await pool.query(`SELECT last_value FROM resolver_retry_${suffix}`))
            .rows[0].last_value,
        ),
      ).toBe(3);
      expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
        0,
      );
    } finally {
      await pool.query(
        `DROP TRIGGER resolver_retry_${suffix} ON order_command_resolutions`,
      );
      await pool.query(`DROP FUNCTION resolver_retry_${suffix}()`);
      await pool.query(`DROP SEQUENCE resolver_retry_${suffix}`);
    }
    await resolve(k).expect(200);
  });
  // SQL barriers: both transactions establish snapshots before winner commits.
  // Real full schema/constraints, no timing sleep and no process-local lock.
  it.each(['command', 'resolution'] as const)(
    'R11 %s wins against a stale opposing snapshot',
    async (winner) => {
      const a = await pool.connect(),
        b = await pool.connect(),
        k = key();
      const input = prepareOrderCommand({
        actorId: seller.id,
        actorType: 'SELLER',
        orderId,
        command: 'confirm',
        idempotencyKey: k,
        body: {},
      });
      const insert = async (c: typeof a, kind: string) => {
        if (kind === 'resolution')
          return c.query(
            'INSERT INTO order_command_resolutions("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion") VALUES($1,$2,\'SELLER\',$3,$4,\'confirm\',$5,1)',
            [orderId, seller.id, input.actorScope, k, input.requestHash],
          );
        return c.query(
          'INSERT INTO order_commands("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion",status,"responseStatus","resultSnapshot","completedAt") VALUES($1,$2,\'SELLER\',$3,$4,\'confirm\',$5,1,\'SUCCEEDED\',200,\'{}\',CURRENT_TIMESTAMP)',
          [orderId, seller.id, input.actorScope, k, input.requestHash],
        );
      };
      try {
        await a.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await b.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        for (const c of [a, b]) {
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
        const count = await pool.query(
          'SELECT (SELECT count(*) FROM order_commands WHERE "actorScope"=$1 AND "idempotencyKey"=$2)+(SELECT count(*) FROM order_command_resolutions WHERE "actorScope"=$1 AND "idempotencyKey"=$2) AS n',
          [input.actorScope, k],
        );
        expect(Number(count.rows[0].n)).toBe(1);
      } finally {
        await a.query('ROLLBACK');
        await b.query('ROLLBACK');
        a.release();
        b.release();
      }
    },
  );
  it('R25 PROCESSING identity and NULL changes are blocked, completion allowed', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const r = await c.query(
        'INSERT INTO order_commands("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion") VALUES($1,$2,\'SELLER\',$3,$4,\'confirm\',$5,1) RETURNING id',
        [orderId, seller.id, `USER:${seller.id}`, key(), 'a'.repeat(64)],
      );
      const id = r.rows[0].id;
      const fields = {
        id: '999999',
        orderId: '"orderId"+1',
        actorId: 'NULL',
        actorType: "'BUYER'",
        actorScope: "'USER:999'",
        idempotencyKey: "'replacement_key_1234'",
        command: "'cancel'",
        requestHash: "repeat('b',64)",
        hashVersion: '2',
        createdAt: "CURRENT_TIMESTAMP+interval '1 second'",
      };
      for (const [field, value] of Object.entries(fields)) {
        await c.query('SAVEPOINT s');
        await expect(
          c.query(`UPDATE order_commands SET "${field}"=${value} WHERE id=$1`, [
            id,
          ]),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'order_commands_identity_immutable',
        });
        await c.query('ROLLBACK TO SAVEPOINT s');
      }
      await c.query(
        'UPDATE order_commands SET "actorId"="actorId",status=\'SUCCEEDED\',"responseStatus"=200,"resultSnapshot"=\'{}\',"completedAt"=CURRENT_TIMESTAMP WHERE id=$1',
        [id],
      );
      await c.query('ROLLBACK');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
  it('R12 malformed resolution identities fail the database check atomically', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const valid = [
        orderId,
        seller.id,
        'SELLER',
        `USER:${seller.id}`,
        key(),
        'confirm',
        'a'.repeat(64),
        1,
      ];
      for (const [index, value] of [
        [2, 'BUYER'],
        [3, `USER:${other.id}`],
        [4, 'short'],
        [4, 'a'.repeat(129)],
        [5, 'cancel'],
        [6, 'g'.repeat(64)],
        [6, 'a'.repeat(63)],
        [7, 2],
      ] as const) {
        const values = [...valid];
        values[index] = value;
        await c.query('SAVEPOINT malformed');
        await expect(
          c.query(
            'INSERT INTO order_command_resolutions("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion") VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            values,
          ),
        ).rejects.toMatchObject(
          index === 4 && String(value).length > 128
            ? { code: '22001' }
            : { code: '23514', constraint: 'order_resolution_identity_check' },
        );
        await c.query('ROLLBACK TO SAVEPOINT malformed');
      }
      await c.query('ROLLBACK');
      expect(await p.orderCommandResolution.count({ where: { orderId } })).toBe(
        0,
      );
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
  it('R12 fence cannot be mutated/deleted and Read Committed inserts fail', async () => {
    const k = key();
    const r = await resolve(k).expect(200);
    await expect(
      pool.query('DELETE FROM order_command_resolutions WHERE id=$1', [
        r.body.resolutionId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        "UPDATE order_command_resolutions SET command='start-packing' WHERE id=$1",
        [r.body.resolutionId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        'INSERT INTO order_command_resolutions("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion") VALUES($1,$2,\'SELLER\',$3,$4,\'confirm\',$5,1)',
        [orderId, seller.id, `USER:${seller.id}`, key(), 'a'.repeat(64)],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'order_command_serializable_required',
    });
  });
});
