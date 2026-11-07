// NoSQL #24 Redis cart, PostgreSQL + real Redis. Opt-in: set REDIS_CART_E2E_URL to a
// local, disposable Redis (e.g. redis://127.0.0.1:6380/15). The suite never FLUSHes; it
// only touches cart:{id} keys of users it creates. Design and race IDs (R1-R17):
// docs/agent-context/handoffs/2026-11-07-NOSQL24-redis-cart-design-v3.md
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { Redis } from 'ioredis';
import request from 'supertest';
import { vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { CartLineStore } from '../src/cart/cart-line-store.js';
import { RedisService, defineCartCommands } from '../src/redis/redis.service.js';
import { BIGINT_MAX, cartKey } from '../src/cart/cart-redis-protocol.js';

const execFileAsync = promisify(execFile);
const redisUrl = process.env.REDIS_CART_E2E_URL;
const localRedis = (() => {
  if (!redisUrl) return false;
  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' || !['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('REDIS_CART_E2E_URL must be a local redis:// URL');
  return true;
})();

describe.skipIf(!localRedis)('Redis cart (PostgreSQL + Redis e2e)', () => {
  let app: INestApplication;
  let app2: INestApplication;
  let prisma: PrismaService;
  let admin: ReturnType<typeof defineCartCommands>;
  let storeId: number;
  let otherStoreId: number;
  let sellerToken: string;
  let categoryId: number;
  let serial = 0;
  const marker = `cart-redis-${Date.now()}`;
  const users: number[] = [];
  const saved: Record<string, string | undefined> = {};
  type Actor = { id: number; token: string; addressId: number };

  const http = (instance = app) => request(instance.getHttpServer());
  const put = (a: Actor, variantId: number, quantity: number, instance = app) =>
    http(instance).put(`/cart/items/${variantId}`).set('Authorization', a.token).send({ quantity });
  const del = (a: Actor, variantId: number) =>
    http().delete(`/cart/items/${variantId}`).set('Authorization', a.token);
  const get = (a: Actor) => http().get('/cart').set('Authorization', a.token);
  const checkout = (
    a: Actor,
    key: string,
    items: { variantId: number; quantity: number; expectedUnitPrice?: string }[],
    instance = app,
  ) =>
    http(instance)
      .post('/checkouts')
      .set('Authorization', a.token)
      .set('Idempotency-Key', key)
      .send({
        addressId: a.addressId,
        paymentProvider: 'COD',
        items: items.map((i) => ({ expectedUnitPrice: '10000.00', ...i })),
      });
  const preview = (a: Actor, items: { variantId: number; quantity: number }[]) =>
    http()
      .post('/checkout/preview')
      .set('Authorization', a.token)
      .send({
        addressId: a.addressId,
        paymentProvider: 'COD',
        items: items.map((i) => ({ ...i, expectedUnitPrice: '10000.00' })),
      });

  async function start() {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const instance = module.createNestApplication();
    configureApp(instance);
    await instance.listen(0, '127.0.0.1');
    return instance;
  }
  async function user(role: Role = Role.USER): Promise<Actor> {
    const created = await prisma.user.create({
      data: { email: `${marker}-${serial++}@example.com`, passwordHash: 'fixture-no-login', role },
    });
    users.push(created.id);
    const config = app.get(ConfigService);
    const jwt = app.get(JwtService).sign(
      { sub: created.id, email: created.email, role, type: 'access' },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
        audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
        expiresIn: '10m',
      },
    );
    const address = await prisma.userAddress.create({
      data: {
        userId: created.id,
        recipientName: 'Redis buyer',
        phone: '0901234567',
        province: 'Province',
        ward: 'Ward',
        addressLine: 'Line',
        isDefault: true,
      },
    });
    return { id: created.id, token: `Bearer ${jwt}`, addressId: address.id };
  }
  async function variant(stock = 5, store = storeId, price = '10000.00') {
    const product = await prisma.product.create({
      data: {
        storeId: store,
        categoryId,
        name: 'Redis cart sample',
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        images: { create: { url: '/uploads/redis-cart.jpg', isPrimary: true } },
        shippingProfile: { create: { packageWeightGrams: 100 } },
      },
    });
    const v = await prisma.productVariant.create({
      data: {
        productId: product.id,
        storeId: store,
        skuCode: `${marker}-${serial++}`,
        price,
        stock,
        optionSignature: `fixture-${serial}`,
      },
    });
    return v.id;
  }
  const items = async (a: Actor) => {
    const body = (await get(a).expect(200)).body as {
      groups: { items: { variantId: number; quantity: number; available: boolean }[] }[];
      unavailableItems: { variantId: number }[];
      lineCount: number;
    };
    return body;
  };
  const visible = async (a: Actor) =>
    Object.fromEntries(
      (await items(a)).groups.flatMap((g) => g.items).map((i) => [i.variantId, i.quantity]),
    );
  const nextval = async () =>
    (await prisma.$queryRaw<{ seq: string }[]>`SELECT nextval('cart_line_seq')::text AS seq`)[0].seq;
  const hw = (a: Actor) => admin.hget(cartKey(a.id), '_hw');
  const stock = async (id: number) =>
    (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;

  beforeAll(async () => {
    for (const name of ['USE_REDIS_CART', 'REDIS_URL', 'REDIS_COMMAND_TIMEOUT_MS']) saved[name] = process.env[name];
    process.env.USE_REDIS_CART = 'true';
    process.env.REDIS_URL = redisUrl;
    process.env.REDIS_COMMAND_TIMEOUT_MS = '900';
    app = await start();
    app2 = await start();
    prisma = app.get(PrismaService);
    admin = defineCartCommands(new Redis(redisUrl!));
    const seller = await user(Role.SELLER);
    sellerToken = seller.token;
    storeId = (await prisma.store.create({ data: { sellerId: seller.id, name: `${marker}-store`, status: 'ACTIVE' } })).id;
    const other = await user(Role.SELLER);
    otherStoreId = (await prisma.store.create({ data: { sellerId: other.id, name: `${marker}-store2`, status: 'ACTIVE' } })).id;
    categoryId = (await prisma.category.create({ data: { name: 'Redis leaf', slug: marker } })).id;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (admin) {
      await admin.client('UNPAUSE').catch(() => undefined);
      for (const id of users) await admin.del(cartKey(id));
      admin.disconnect();
    }
    if (app2) await app2.close();
    if (app) await app.close();
    for (const [name, value] of Object.entries(saved))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });

  it('starts in Redis mode and keeps PostgreSQL cart tables untouched', async () => {
    expect(app.get(CartLineStore).redisMode).toBe(true);
    const a = await user();
    const v = await variant();
    await put(a, v, 2).expect(200);
    expect(await prisma.cartItem.count({ where: { cart: { userId: a.id } } })).toBe(0);
    expect(await prisma.cart.count({ where: { userId: a.id } })).toBe(0);
    expect(await admin.ttl(cartKey(a.id))).toBeGreaterThan(604000);
  });

  it('CRUD: absolute PUT replay, DELETE replay, order kept, validation unchanged', async () => {
    const a = await user();
    const [v1, v2] = [await variant(), await variant(3)];
    await put(a, v1, 2).expect(200);
    await put(a, v2, 1).expect(200);
    const line1 = await admin.hget(cartKey(a.id), String(v1));
    const hw1 = await hw(a);
    await put(a, v1, 2).expect(200); // replay: line unchanged, _hw raised (F1 fence)
    expect(await admin.hget(cartKey(a.id), String(v1))).toBe(line1);
    expect(BigInt((await hw(a))!)).toBeGreaterThan(BigInt(hw1!));
    await put(a, v1, 3).expect(200); // edit keeps first-added order
    expect((await items(a)).groups[0].items.map((i) => i.variantId)).toEqual([v1, v2]);
    expect(await visible(a)).toEqual({ [v1]: 3, [v2]: 1 });
    await put(a, v2, 4).expect(409).expect((r) => expect(r.body.code).toBe('INSUFFICIENT_STOCK'));
    await put(a, v1, 0).expect(400);
    await put(a, 2147483647, 1).expect(409).expect((r) => expect(r.body.code).toBe('VARIANT_NOT_AVAILABLE'));
    // Same fixture as the PostgreSQL suite: a USER who owns the store.
    const own = await prisma.store.create({ data: { sellerId: a.id, name: `${marker}-self-${a.id}`, status: 'ACTIVE' } });
    await put(a, await variant(5, own.id), 1)
      .expect(409).expect((r) => expect(r.body.code).toBe('SELF_PURCHASE_FORBIDDEN'));
    await http().put(`/cart/items/${v1}`).set('Authorization', sellerToken).send({ quantity: 1 }).expect(403);
    await del(a, v2).expect(204);
    const hw2 = await hw(a);
    await del(a, v2).expect(204); // replay: still raises _hw (F1 fence)
    expect(BigInt((await hw(a))!)).toBeGreaterThan(BigInt(hw2!));
    expect(await visible(a)).toEqual({ [v1]: 3 });
  });

  it('variant gone or unlisted after adding: line stays, reported unavailable', async () => {
    const a = await user();
    const v = await variant();
    await put(a, v, 1).expect(200);
    await prisma.productVariant.update({ where: { id: v }, data: { stock: 0 } });
    const body = await items(a);
    expect(body.groups[0].items[0]).toMatchObject({ variantId: v, available: false });
    // A Redis line for a variant id that no longer exists (no FK in Redis).
    await admin.cartWrite(cartKey(a.id), await nextval(), 'set', '2147483000', '1|1|1', 604800);
    const after = await items(a);
    expect(after.unavailableItems.map((i) => i.variantId)).toContain(2147483000);
    const previewed = await preview(a, [{ variantId: 2147483000, quantity: 1 }]).expect(200);
    expect(previewed.body).toMatchObject({
      canCheckout: false,
      unavailableItems: [{ variantId: 2147483000, errors: ['VARIANT_NOT_AVAILABLE'] }],
    });
    await checkout(a, 'redis_missing_variant_01', [{ variantId: 2147483000, quantity: 1 }])
      .expect(409).expect((r) => expect(r.body.code).toBe('VARIANT_NOT_AVAILABLE'));
    await del(a, 2147483000).expect(204);
  });

  it('partial, multi-store checkout keeps unbought lines; price/stock rechecked', async () => {
    const a = await user();
    const [v1, v2, v3] = [await variant(), await variant(5, otherStoreId), await variant()];
    for (const v of [v1, v2, v3]) await put(a, v, 1).expect(200);
    await prisma.productVariant.update({ where: { id: v3 }, data: { price: '12000.00' } });
    await checkout(a, 'redis_partial_price_0001', [{ variantId: v3, quantity: 1 }])
      .expect(409).expect((r) => expect(r.body.code).toBe('PRICE_CHANGED'));
    const res = await checkout(a, 'redis_partial_ok_000001', [
      { variantId: v1, quantity: 1 },
      { variantId: v2, quantity: 1 },
    ]).expect(201);
    expect(res.body.orders).toHaveLength(2);
    expect(await visible(a)).toEqual({ [v3]: 1 });
    expect(await stock(v1)).toBe(4);
  });

  it('R4: two checkouts with different keys for one line, cleanup lost: one order, one decrement', async () => {
    const a = await user();
    const v = await variant();
    await put(a, v, 2).expect(200);
    vi.spyOn(CartLineStore.prototype, 'cleanup').mockResolvedValue(undefined);
    const results = await Promise.all([
      checkout(a, 'redis_race_key_00000001', [{ variantId: v, quantity: 2 }]),
      checkout(a, 'redis_race_key_00000002', [{ variantId: v, quantity: 2 }], app2),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 404]);
    expect(results.find((r) => r.status === 404)!.body.code).toBe('CART_ITEM_NOT_FOUND');
    expect(await stock(v)).toBe(3);
    expect(await prisma.order.count({ where: { buyerId: a.id } })).toBe(1);
    // Redis still holds the line (no cleanup), the fence hides it everywhere.
    expect(await admin.hexists(cartKey(a.id), String(v))).toBe(1);
    expect(await visible(a)).toEqual({});
    await checkout(a, 'redis_race_key_00000003', [{ variantId: v, quantity: 2 }])
      .expect(404);
    // Re-adding after purchase gets a new seq above the fence and is effective.
    await put(a, v, 1).expect(200);
    expect(await visible(a)).toEqual({ [v]: 1 });
  });

  it('R10/R11/R12: replay after commit, failed cleanup, TTL loss and Redis outage', async () => {
    const a = await user();
    const v = await variant();
    await put(a, v, 1).expect(200);
    const cleanup = vi.spyOn(app.get(RedisService).client, 'cartCleanup').mockRejectedValueOnce(new Error('down'));
    const first = await checkout(a, 'redis_replay_key_000001', [{ variantId: v, quantity: 1 }]).expect(201);
    expect(cleanup).toHaveBeenCalled();
    const again = await checkout(a, 'redis_replay_key_000001', [{ variantId: v, quantity: 1 }]).expect(200);
    expect(again.body).toMatchObject({ checkoutId: first.body.checkoutId, replayed: true });
    await checkout(a, 'redis_replay_key_000001', [{ variantId: v, quantity: 1, expectedUnitPrice: '10001.00' }])
      .expect(409).expect((r) => expect(r.body.code).toBe('IDEMPOTENCY_CONFLICT'));
    await admin.del(cartKey(a.id)); // TTL expiry
    await checkout(a, 'redis_replay_key_000001', [{ variantId: v, quantity: 1 }]).expect(200)
      .expect((r) => expect(r.body.replayed).toBe(true));
    const v2 = await variant();
    await put(a, v2, 1).expect(200);
    const client = app.get(RedisService).client;
    client.disconnect(); // real outage of this instance's client
    try {
      await checkout(a, 'redis_replay_key_000001', [{ variantId: v, quantity: 1 }]).expect(200);
      await checkout(a, 'redis_outage_key_000001', [{ variantId: v2, quantity: 1 }])
        .expect(503).expect((r) => expect(r.body.code).toBe('CART_STORE_UNAVAILABLE'));
      await get(a).expect(503);
    } finally {
      await client.connect();
    }
    expect(await stock(v)).toBe(4);
    expect(await stock(v2)).toBe(5);
    expect(await prisma.order.count({ where: { buyerId: a.id } })).toBe(1);
  });

  it('R1/R3: stale write arriving after DELETE, cleanup or a newer PUT is rejected', async () => {
    const a = await user();
    const v = await variant();
    await put(a, v, 1).expect(200);
    const stale = await nextval(); // a PUT that timed out before reaching Redis
    await del(a, v).expect(204);
    expect(await admin.cartWrite(cartKey(a.id), stale, 'set', String(v), `5|${stale}|${stale}`, 604800)).toBe(0);
    expect(await visible(a)).toEqual({});
    const stale2 = await nextval();
    await put(a, v, 3).expect(200); // re-add same SKU (newer seq)
    expect(await admin.cartWrite(cartKey(a.id), stale2, 'set', String(v), `9|${stale2}|${stale2}`, 604800)).toBe(0);
    expect(await visible(a)).toEqual({ [v]: 3 });
  });

  it('F1: a stale PUT arriving after a successful same-quantity PUT or absent-line DELETE is rejected', async () => {
    const a = await user();
    const v = await variant();
    await put(a, v, 1).expect(200);
    const line = await admin.hget(cartKey(a.id), String(v));
    const stale = await nextval(); // PUT qty 2 that timed out before reaching Redis
    await put(a, v, 1).expect(200); // newer intent, no data change
    expect(await admin.cartWrite(cartKey(a.id), stale, 'set', String(v), `2|${stale}|${stale}`, 604800)).toBe(0);
    expect(await admin.hget(cartKey(a.id), String(v))).toBe(line);
    expect(await visible(a)).toEqual({ [v]: 1 });
    const b = await user();
    const stale2 = await nextval(); // PUT qty 3 in flight while the cart has no line
    await del(b, v).expect(204); // newer intent on an absent line
    expect(await admin.cartWrite(cartKey(b.id), stale2, 'set', String(v), `3|${stale2}|${stale2}`, 604800)).toBe(0);
    expect(await visible(b)).toEqual({});
  });

  it('R2: stale write after checkout+cleanup: rejected if a newer write exists, else applied (R5 contract)', async () => {
    const a = await user();
    const [v, other] = [await variant(), await variant()];
    await put(a, v, 1).expect(200);
    const stale = await nextval();
    await checkout(a, 'redis_r2_checkout_00001', [{ variantId: v, quantity: 1 }]).expect(201);
    expect(await admin.hexists(cartKey(a.id), String(v))).toBe(0); // cleaned up
    await put(a, other, 1).expect(200); // newer accepted write
    expect(await admin.cartWrite(cartKey(a.id), stale, 'set', String(v), `2|${stale}|${stale}`, 604800)).toBe(0);
    expect(await visible(a)).toEqual({ [other]: 1 });
    // Without a newer write the late command is the last write: documented unknown outcome.
    const b = await user();
    await put(b, v, 1).expect(200);
    const late = await nextval();
    await checkout(b, 'redis_r2_checkout_00002', [{ variantId: v, quantity: 1 }]).expect(201);
    expect(await admin.cartWrite(cartKey(b.id), late, 'set', String(v), `2|${late}|${late}`, 604800)).toBe(1);
    expect(await visible(b)).toEqual({ [v]: 2 }); // checkout rechecks before any purchase
  });

  it('R6: a Redis read taken before a checkout commit cannot show the bought line', async () => {
    const a = await user();
    const v = await variant();
    await put(a, v, 1).expect(200);
    const store = app.get(CartLineStore);
    const before = await store.snapshot(a.id);
    vi.spyOn(CartLineStore.prototype, 'cleanup').mockResolvedValue(undefined);
    await checkout(a, 'redis_r6_checkout_00001', [{ variantId: v, quantity: 1 }]).expect(201);
    const lines = await prisma.$transaction((tx) => store.lines(tx, a.id, before));
    expect(lines).toEqual([]);
  });

  it('R7: a write between Redis reads makes the versioned read retry with the new state', async () => {
    const a = await user();
    const v = await variant();
    await put(a, v, 1).expect(200);
    const store = app.get(CartLineStore);
    let calls = 0;
    const result = await store.versioned(a.id, async (snapshot) => {
      if (calls++ === 0) await put(a, v, 4, app2).expect(200);
      return snapshot!.lines.get(v)!.quantity;
    });
    expect(calls).toBe(2);
    expect(result).toBe(4);
  });

  it('R8a/R17: sequence behind fence (Redis empty) or behind Redis _hw fails closed, no setval', async () => {
    const [a, b] = [await user(), await user()];
    const v = await variant();
    const ahead = (BigInt(await nextval()) + 1000n).toString();
    for (const x of [a, b]) {
      const c = await prisma.checkout.create({
        data: { buyerId: x.id, idempotencyKey: `redis_r8a_${x.id}_000000`, requestHash: 'h', status: 'COMPLETED' },
      });
      await prisma.cartConsumedLine.create({
        data: { buyerId: x.id, variantId: v, consumedSeq: BigInt(ahead), checkoutId: c.id },
      });
    }
    const seqBefore = BigInt(
      (await prisma.$queryRaw<{ v: string }[]>`SELECT last_value::text AS v FROM cart_line_seq`)[0].v,
    );
    const results = await Promise.all([put(a, v, 1), put(b, v, 1, app2)]);
    for (const r of results) {
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('CART_SEQUENCE_BEHIND');
    }
    expect(await admin.exists(cartKey(a.id), cartKey(b.id))).toBe(0);
    const seqAfter = BigInt(
      (await prisma.$queryRaw<{ v: string }[]>`SELECT last_value::text AS v FROM cart_line_seq`)[0].v,
    );
    expect(seqAfter - seqBefore).toBe(2n); // nextval consumed, never rolled back or setval'd
    expect((await prisma.cartConsumedLine.findMany({ where: { buyerId: { in: [a.id, b.id] } } }))
      .every((f) => f.consumedSeq === BigInt(ahead))).toBe(true);
    // R17: Redis keeps a seq from an uncommitted transaction above the sequence.
    const c = await user();
    await admin.cartWrite(cartKey(c.id), ahead, 'set', String(v), `1|${ahead}|${ahead}`, 604800);
    await put(c, v, 2).expect(503).expect((r) => expect(r.body.code).toBe('CART_SEQUENCE_BEHIND'));
    expect(await admin.hget(cartKey(c.id), String(v))).toBe(`1|${ahead}|${ahead}`);
  });

  it('R9: Lua compares seqs exactly around 2^53 and rejects values beyond bigint', async () => {
    const key = cartKey((await user()).id);
    const p53 = (2n ** 53n).toString();
    const p53p1 = (2n ** 53n + 1n).toString();
    expect(await admin.cartWrite(key, p53, 'set', '1', `1|${p53}|${p53}`, 600)).toBe(1);
    expect(await admin.cartWrite(key, p53p1, 'set', '1', `2|${p53p1}|${p53}`, 600)).toBe(1);
    expect(await admin.cartWrite(key, p53, 'set', '1', `3|${p53}|${p53}`, 600)).toBe(0);
    expect(await admin.cartCleanup(key, '1', p53)).toBe(0); // 2^53+1 > 2^53: kept
    expect(await admin.cartCleanup(key, '1', p53p1)).toBe(1);
    expect(await admin.cartWrite(key, BIGINT_MAX, 'set', '1', `1|${BIGINT_MAX}|${BIGINT_MAX}`, 600)).toBe(1);
    await expect(admin.cartWrite(key, '9223372036854775808', 'set', '1', '1|1|1', 600)).rejects.toThrow(/CART_BAD_SEQ/);
    await expect(admin.cartWrite(key, '01', 'set', '1', '1|1|1', 600)).rejects.toThrow(/CART_BAD_SEQ/);
    expect(await admin.hget(key, '_hw')).toBe(BIGINT_MAX);
  });

  it('R5: Redis write times out (paused), API errors, outcome applied later; retry converges', async () => {
    const a = await user();
    const v = await variant();
    await put(a, v, 1).expect(200);
    await admin.client('PAUSE', 1500, 'WRITE');
    try {
      await put(a, v, 3).expect(503).expect((r) => expect(r.body.code).toBe('CART_STORE_UNAVAILABLE'));
    } finally {
      await admin.client('UNPAUSE');
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await visible(a)).toEqual({ [v]: 3 }); // queued server-side, executed after pause
    const line = await admin.hget(cartKey(a.id), String(v));
    await put(a, v, 3).expect(200); // retry of absolute PUT: line unchanged
    expect(await admin.hget(cartKey(a.id), String(v))).toBe(line);
  });

  /**
   * Starts the PUT now and returns (without awaiting the HTTP response) once its Lua write
   * was sent and Redis is holding it. The result is wrapped in an object on purpose: an
   * async function returning the response promise itself would wait for the HTTP end.
   * Records a timeline: held -> fault -> client close -> cartWrite rejected -> HTTP end.
   */
  async function pendingPut(a: Actor, variantId: number, quantity: number) {
    const client = app.get(RedisService).client;
    const original = client.cartWrite.bind(client);
    const t0 = performance.now();
    const at = () => Math.round((performance.now() - t0) * 10) / 10;
    const timeline: Record<string, number | string | boolean> = {};
    let sent!: () => void;
    const wasSent = new Promise<void>((resolve) => (sent = resolve));
    vi.spyOn(client, 'cartWrite').mockImplementation((...args) => {
      const result = original(...args);
      timeline.sent = at();
      sent();
      result.catch((error: unknown) => {
        timeline.writeRejected = at();
        timeline.rejectReason = error instanceof Error ? error.message : String(error);
      });
      return result;
    });
    client.once('close', () => (timeline.clientClosed = at()));
    // .then() dispatches the HTTP request immediately (Supertest is lazy until then).
    let done = false;
    const response = put(a, variantId, quantity).then((r) => {
      done = true;
      timeline.httpEnded = at();
      return r;
    });
    const first = await Promise.race([wasSent.then(() => null), response]);
    if (first) throw new Error(`PUT finished before its Redis write was sent: ${first.status}`);
    let held = false;
    for (let i = 0; i < 100 && !held; i++) {
      const list = String(await admin.client('LIST'));
      held = list.split('\n').some((line) => /cmd=evalsha/.test(line) && /flags=\S*b/.test(line));
      if (!held) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(held).toBe(true); // the write reached Redis and is waiting (CLIENT PAUSE WRITE)
    timeline.held = at();
    return {
      timeline,
      /** Call right before injecting the fault; the HTTP request must still be open. */
      fault() {
        timeline.fault = at();
        timeline.httpOpenAtFault = !done;
        expect(done).toBe(false);
      },
      response,
    };
  }
  function expectFaultOrder(timeline: Record<string, number | string | boolean>) {
    console.log('R15-TIMELINE', JSON.stringify(timeline));
    const t = timeline as Record<string, number>;
    expect(timeline.httpOpenAtFault).toBe(true);
    expect(t.sent).toBeLessThanOrEqual(t.held);
    expect(t.held).toBeLessThanOrEqual(t.fault);
    expect(t.fault).toBeLessThan(t.clientClosed);
    expect(t.clientClosed).toBeLessThanOrEqual(t.writeRejected);
    expect(t.writeRejected).toBeLessThanOrEqual(t.httpEnded);
    // The write failed because the connection went away, not by command timeout.
    expect(String(timeline.rejectReason)).not.toMatch(/timed out/i);
  }
  async function eventuallyVisible(a: Actor) {
    for (let i = 0; i < 50; i++) {
      if ((await get(a)).status === 200) return visible(a);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('cart never became readable after reconnect');
  }

  it('R15: connection killed while a sent write is held: 503, never re-sent after reconnect', async () => {
    const a = await user();
    const v = await variant();
    await put(a, v, 1).expect(200);
    const h = await hw(a);
    await admin.client('PAUSE', 5000, 'WRITE');
    let pending;
    try {
      pending = await pendingPut(a, v, 5);
      pending.fault();
      await admin.client('KILL', 'TYPE', 'normal', 'SKIPME', 'yes');
      const res = await pending.response;
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('CART_STORE_UNAVAILABLE');
    } finally {
      await admin.client('UNPAUSE');
    }
    expectFaultOrder(pending.timeline);
    await new Promise((resolve) => setTimeout(resolve, 2500)); // reconnect window
    expect(await hw(a)).toBe(h); // the killed command never executed and was not re-sent
    expect(await eventuallyVisible(a)).toEqual({ [v]: 1 });
  });

  it.skipIf(!process.env.REDIS_CART_E2E_CONTAINER)(
    'R15b: real Redis container restart while a sent write is held; AOF keeps prior data; no resend',
    async () => {
      const a = await user();
      const v = await variant();
      await put(a, v, 1).expect(200);
      const h = await hw(a);
      await new Promise((resolve) => setTimeout(resolve, 1500)); // > appendfsync everysec
      await admin.client('PAUSE', 10000, 'WRITE');
      const pending = await pendingPut(a, v, 3);
      pending.fault();
      const restart = execFileAsync('docker', ['restart', '-t', '0', process.env.REDIS_CART_E2E_CONTAINER!]);
      const res = await pending.response;
      await restart;
      expect(res.status).toBe(503);
      expectFaultOrder(pending.timeline);
      expect(await eventuallyVisible(a)).toEqual({ [v]: 1 }); // persisted across restart
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(await hw(a)).toBe(h); // not executed before restart, not re-sent after
      await put(a, v, 2).expect(200); // writes work again after reconnect
      expect(await visible(a)).toEqual({ [v]: 2 });
    },
    30_000,
  );

  it('R14: cancelling an order bought from the Redis cart restores stock exactly once', async () => {
    const a = await user();
    const v = await variant();
    await put(a, v, 2).expect(200);
    const order = (await checkout(a, 'redis_cancel_chk_000001', [{ variantId: v, quantity: 2 }]).expect(201))
      .body.orders[0];
    expect(await stock(v)).toBe(3);
    const cancel = (key: string, instance = app) =>
      http(instance)
        .post(`/orders/${order.id}/cancel`)
        .set('Authorization', a.token)
        .set('Idempotency-Key', key)
        .send({ reasonCode: 'CHANGED_MIND', reasonText: 'Không cần nữa' });
    const results = await Promise.all([
      cancel('redis_cancel_key_000001'),
      cancel('redis_cancel_key_000002', app2),
    ]);
    expect(results.some((r) => r.status === 200)).toBe(true);
    await cancel('redis_cancel_key_000001');
    expect(await stock(v)).toBe(5);
    expect(await visible(a)).toEqual({}); // cancellation does not resurrect the cart line
  });
});
