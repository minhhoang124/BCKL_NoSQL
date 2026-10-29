import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { SearchAnalyticsService } from '../src/search/search-analytics.service.js';
import { analyticsHash } from '../src/search/search-analytics-policy.js';
import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';

describe('Store Search analytics — real HTTP/PostgreSQL, synthetic AI retrieval', () => {
  let app: INestApplication,
    db: PrismaService,
    auth: AuthService,
    analytics: SearchAnalyticsService;
  const password = 'Synthetic-search-QA-2026',
    ua = 'Mozilla/5.0 Search QA',
    origin = 'http://localhost:5173';
  const http = () => request(app.getHttpServer());
  const day = new Date().toISOString().slice(0, 10),
    tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const range = `?from=${day}T00:00:00.000Z&to=${tomorrow}T00:00:00.000Z`;
  beforeAll(async () => {
    assertRuntimeQaTarget(process.env.DATABASE_URL, process.env.GITHUB_ACTIONS);
    vi.stubEnv('SEARCH_ANALYTICS_ENABLED', 'true');
    vi.stubEnv('SEARCH_ANALYTICS_START_AT', '2026-01-01T00:00:00.000Z');
    vi.stubEnv('SEARCH_ANALYTICS_RETENTION_ENABLED', 'false');
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    auth = app.get(AuthService);
    analytics = app.get(SearchAnalyticsService);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });
  async function actor(role: 'SELLER' | 'USER' | 'ADMIN' = 'SELLER') {
    const user = await db.user.create({
      data: {
        email: `analytics-${randomUUID()}@example.invalid`,
        passwordHash: await hash(password, 4),
        role,
      },
    });
    return {
      ...user,
      token: (await auth.login({ email: user.email, password })).accessToken,
    };
  }
  async function fixture() {
    const seller = await actor(),
      store = await db.store.create({
        data: {
          sellerId: seller.id,
          name: 'Analytics QA Store',
          status: 'ACTIVE',
        },
      }),
      category = await db.category.create({
        data: { name: 'Analytics category', slug: randomUUID() },
      });
    const product = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: 'Analytics QA Product',
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        images: { create: { url: '/uploads/synthetic.png', isPrimary: true } },
        shippingProfile: { create: { packageWeightGrams: 100 } },
        variants: {
          create: {
            skuCode: randomUUID(),
            optionSignature: '[]',
            price: '10000.00',
            stock: 5,
          },
        },
      },
    });
    return { seller, store, product };
  }
  async function search(ids: number[], agent = ua, cookie?: string) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          query: { type: 'hybrid_text', text: 'not logged private query' },
          items: ids.map((productId, i) => ({
            productId,
            rank: i + 1,
            score: 1,
          })),
          responseTimeMs: 1,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );
    let call = http()
      .post('/search/hybrid')
      .set('User-Agent', agent)
      .set('Origin', origin);
    if (cookie) call = call.set('Cookie', cookie);
    const r = await call
      .send({ query: 'not logged private query', topK: 20 })
      .expect(200);
    const cookies = r.headers['set-cookie'];
    return {
      r,
      token: r.body.analytics?.token as string,
      cookie:
        cookie ??
        (Array.isArray(cookies) ? cookies.join(';') : (cookies ?? '')),
    };
  }
  const event = (
    s: { token: string; cookie: string },
    productId: number,
    kind = 'CLICK',
  ) =>
    http()
      .post('/search/events')
      .set('Origin', origin)
      .set('User-Agent', ua)
      .set('Cookie', s.cookie)
      .send({ token: s.token, productId, event: kind });
  const report = (seller: { token: string }) =>
    http()
      .get('/seller/search-analytics' + range)
      .auth(seller.token, { type: 'bearer' });
  it('hydrates canonical public results, acknowledges viewport and click once with no raw query or Buyer fields', async () => {
    const f = await fixture(),
      s = await search([f.product.id]);
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.r.headers['cache-control']).toBe('no-store');
    expect((await report(f.seller)).body.totals).toEqual({
      impressions: 0,
      clicks: 0,
    });
    await event(s, f.product.id, 'IMPRESSION').expect(200);
    await event(s, f.product.id).expect(200);
    expect((await report(f.seller)).body.totals).toEqual({
      impressions: 1,
      clicks: 1,
    });
    const log = await db.searchLog.findUniqueOrThrow({
      where: { tokenHash: analyticsHash(s.token) },
      include: { results: true },
    });
    expect(log.strategy).toBe('HYBRID_TEXT');
    expect(log.results[0]).toMatchObject({
      productId: f.product.id,
      storeId: f.store.id,
      rank: 1,
    });
    expect(JSON.stringify(log)).not.toContain('private query');
    expect(JSON.stringify(log)).not.toContain(s.token);
    expect(Object.keys(log).sort()).toEqual(
      [
        'id',
        'tokenHash',
        'visitorHash',
        'strategy',
        'createdAt',
        'expiresAt',
        'results',
      ].sort(),
    );
  });
  it('serializes ten concurrent duplicate click/render deliveries into exactly one impression/click', async () => {
    const f = await fixture(),
      s = await search([f.product.id]);
    const replies = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        event(s, f.product.id, i % 2 ? 'CLICK' : 'IMPRESSION'),
      ),
    );
    expect(replies.every((r) => r.status === 200)).toBe(true);
    expect((await report(f.seller)).body.totals).toEqual({
      impressions: 1,
      clicks: 1,
    });
  });
  it('rejects cross-cookie capability replay, unknown product, bad token and cross-Origin without writes', async () => {
    const f = await fixture(),
      s = await search([f.product.id]);
    const b = await db.clickLog.count();
    await event(
      { ...s, cookie: 'bckl_search_session=' + 'z'.repeat(43) },
      f.product.id,
    ).expect(400);
    await event(s, 2147483647).expect(400);
    await event({ ...s, token: 'z'.repeat(43) }, f.product.id).expect(400);
    await http()
      .post('/search/events')
      .set('Origin', 'https://evil.invalid')
      .set('User-Agent', ua)
      .set('Cookie', s.cookie)
      .send({ token: s.token, productId: f.product.id, event: 'CLICK' })
      .expect(403);
    expect(await db.clickLog.count()).toBe(b);
  });
  it('does not record zero results, frozen products or known bots', async () => {
    const f = await fixture();
    expect((await search([])).token).toBeUndefined();
    await db.product.update({
      where: { id: f.product.id },
      data: { moderationStatus: 'FROZEN' },
    });
    expect((await search([f.product.id])).token).toBeUndefined();
    await db.product.update({
      where: { id: f.product.id },
      data: { moderationStatus: 'APPROVED' },
    });
    expect((await search([f.product.id], 'Googlebot')).token).toBeUndefined();
  });
  it('fences expiry using DB time and does not accept old tokens', async () => {
    const f = await fixture(),
      s = await search([f.product.id]);
    await db.$executeRaw`UPDATE search_logs SET "createdAt"=CURRENT_TIMESTAMP-interval '16 minutes',"expiresAt"=CURRENT_TIMESTAMP-interval '1 minute' WHERE "tokenHash"=${analyticsHash(s.token)}`;
    await event(s, f.product.id).expect(400);
    expect((await report(f.seller)).body.totals.clicks).toBe(0);
  });
  it('Seller cannot select another Store, Buyer is forbidden, guest no-store and stale active/role/session are denied', async () => {
    const f = await fixture(),
      other = await fixture(),
      buyer = await actor('USER');
    const s = await search([other.product.id]);
    await event(s, other.product.id).expect(200);
    expect((await report(f.seller)).body.totals).toEqual({
      impressions: 0,
      clicks: 0,
    });
    await http()
      .get('/seller/search-analytics' + range + '&storeId=' + other.store.id)
      .auth(f.seller.token, { type: 'bearer' })
      .expect(400);
    await report(buyer).expect(403);
    const guest = await http()
      .get('/seller/search-analytics' + range)
      .expect(401);
    expect(guest.headers['cache-control']).toBe('no-store');
    await db.user.update({
      where: { id: f.seller.id },
      data: { isActive: false },
    });
    await report(f.seller).expect(401);
    await db.user.update({
      where: { id: f.seller.id },
      data: { isActive: true, role: 'USER' },
    });
    await report(f.seller).expect(403);
    await db.user.update({
      where: { id: f.seller.id },
      data: { role: 'SELLER', credentialVersion: { increment: 1 } },
    });
    await report(f.seller).expect(401);
  });
  it('Admin can aggregate by Store and cannot reveal capability or visitor proof', async () => {
    const f = await fixture(),
      admin = await actor('ADMIN'),
      s = await search([f.product.id]);
    await event(s, f.product.id).expect(200);
    const r = await http()
      .get('/admin/search-analytics' + range + '&storeId=' + f.store.id)
      .auth(admin.token, { type: 'bearer' })
      .expect(200);
    expect(r.body.totals).toEqual({ impressions: 1, clicks: 1 });
    expect(JSON.stringify(r.body)).not.toMatch(
      /tokenHash|visitorHash|example.invalid|private query/,
    );
  });
  it('disabled collection returns unknown totals, not fake zero', async () => {
    const f = await fixture();
    vi.stubEnv('SEARCH_ANALYTICS_ENABLED', 'false');
    try {
      const r = await report(f.seller).expect(200);
      expect(r.body.status).toBe('DISABLED');
      expect(r.body.totals).toBeNull();
      expect((await search([f.product.id])).token).toBeUndefined();
    } finally {
      vi.stubEnv('SEARCH_ANALYTICS_ENABLED', 'true');
    }
  });
  it('rejects duplicate query, GET body and unknown event authority; preflight stays available', async () => {
    const f = await fixture();
    await http()
      .get('/seller/search-analytics' + range + '&from=x')
      .auth(f.seller.token, { type: 'bearer' })
      .expect(400);
    await http()
      .get('/seller/search-analytics' + range)
      .auth(f.seller.token, { type: 'bearer' })
      .send({ storeId: 1 })
      .expect(400);
    const s = await search([f.product.id]);
    await http()
      .post('/search/events')
      .set('Origin', origin)
      .set('User-Agent', ua)
      .set('Cookie', s.cookie)
      .send({
        token: s.token,
        productId: f.product.id,
        event: 'CLICK',
        rank: 1,
      })
      .expect(400);
    await http()
      .options('/search/events')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
  });
  it('DB capture outage does not fail successful Search or silently fake report zero', async () => {
    const f = await fixture(),
      original = db.$transaction.bind(db);
    const spy = vi
      .spyOn(db, '$transaction')
      .mockImplementationOnce(original)
      .mockRejectedValue(new Error('synthetic'));
    try {
      expect((await search([f.product.id])).token).toBeUndefined();
      await report(f.seller).expect(503);
    } finally {
      spy.mockRestore();
    }
  });
  it('retention cascades only expired telemetry independently of collection; business rows do not change', async () => {
    const f = await fixture(),
      s = await search([f.product.id]);
    await event(s, f.product.id).expect(200);
    const before = await db.product.findUnique({ where: { id: f.product.id } }),
      counts = [
        await db.order.count(),
        await db.stockMovement.count(),
        await db.searchOutbox.count(),
      ];
    await db.$executeRaw`UPDATE search_logs SET "createdAt"=CURRENT_TIMESTAMP-interval '31 days',"expiresAt"=CURRENT_TIMESTAMP-interval '31 days'+interval '15 minutes' WHERE "tokenHash"=${analyticsHash(s.token)}`;
    vi.stubEnv('SEARCH_ANALYTICS_ENABLED', 'false');
    vi.stubEnv('SEARCH_ANALYTICS_RETENTION_ENABLED', 'true');
    try {
      await analytics.cleanup();
      expect(
        await db.searchLog.findUnique({
          where: { tokenHash: analyticsHash(s.token) },
        }),
      ).toBeNull();
    } finally {
      vi.stubEnv('SEARCH_ANALYTICS_ENABLED', 'true');
      vi.stubEnv('SEARCH_ANALYTICS_RETENTION_ENABLED', 'false');
    }
    expect(
      await db.product.findUnique({ where: { id: f.product.id } }),
    ).toEqual(before);
    expect([
      await db.order.count(),
      await db.stockMovement.count(),
      await db.searchOutbox.count(),
    ]).toEqual(counts);
  });
  it('normalizes a non-UTC database session and ignores Node clock skew for cohort/expiry', async () => {
    const f = await fixture(),
      original = db.$transaction.bind(db);
    const spy = vi
      .spyOn(db, '$transaction')
      .mockImplementation(async (callback) =>
        original(async (tx) => {
          await tx.$executeRaw`SET LOCAL timezone='Asia/Ho_Chi_Minh'`;
          return (
            callback as (client: Prisma.TransactionClient) => Promise<unknown>
          )(tx);
        }),
      );
    vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      const s = await search([f.product.id]);
      await event(s, f.product.id).expect(200);
      const r = await report(f.seller).expect(200);
      expect(r.body.totals).toEqual({ impressions: 1, clicks: 1 });
      expect(
        Math.abs(new Date(r.body.asOf).getTime() - new Date().getTime()),
      ).toBeLessThan(5000);
    } finally {
      spy.mockRestore();
      vi.restoreAllMocks();
    }
  });
  it('two search proofs in one cookie cannot be joined by a stable visitor hash', async () => {
    const f = await fixture(),
      a = await search([f.product.id]),
      b = await search([f.product.id], ua, a.cookie);
    const rows = await db.searchLog.findMany({
      where: {
        tokenHash: { in: [analyticsHash(a.token), analyticsHash(b.token)] },
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.visitorHash).not.toBe(rows[1]!.visitorHash);
  });
});
