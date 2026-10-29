import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma.service.js';
import { digest, input } from '../src/review/review-input.js';
const marker = () => `review-${randomUUID()}`;
const command = <T extends object>(extra: T) => ({
  commandId: randomUUID(),
  confirmed: true as const,
  ...extra,
});
const create = () =>
  command({ rating: 5, body: 'Sản phẩm đúng mô tả, giao hàng đầy đủ.' });
describe('Product Review real HTTP/PostgreSQL, ownership, audit and recovery', () => {
  let app: INestApplication,
    db: PrismaService,
    auth: AuthService,
    passwordHash: string;
  const password = 'Synthetic-review-only-2026';
  const flags = {
    reviews: process.env.PRODUCT_REVIEWS_ENABLED,
    buyer: process.env.ACCOUNT_BUYER_ACCESS_ENABLED,
    window: process.env.REVIEW_WINDOW_DAYS,
  };
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    const u = new URL(process.env.DATABASE_URL ?? '');
    const local =
      u.hostname === '127.0.0.1' &&
      u.port === '5549' &&
      ['/bckl_order_resolution_test_attributes_20261019_v955','/bckl_order_resolution_test_attributes_20261019_v957', '/bckl_order_resolution_test_attributes_20261019_v959', '/bckl_order_resolution_test_attributes_20261019_v961', '/bckl_order_resolution_test_attributes_20261019_v965', '/bckl_order_resolution_test_attributes_20261019_v967', '/bckl_order_resolution_test_attributes_20261019_v971', '/bckl_order_resolution_test_attributes_20261019_v973', '/bckl_order_resolution_test_attributes_20261019_v975', '/bckl_order_resolution_test_hardening_20261029'].includes(u.pathname);
    const ci =
      process.env.GITHUB_ACTIONS === 'true' &&
      ['localhost', '127.0.0.1'].includes(u.hostname) &&
      u.port === '5549' &&
      u.pathname === '/bckl_order_resolution_test_attributes_20261019';
    if (!local && !ci) throw Error('Exact isolated Review QA required');
    process.env.PRODUCT_REVIEWS_ENABLED = 'true';
    process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'true';
    process.env.REVIEW_WINDOW_DAYS = '30';
    passwordHash = await hash(password, 4);
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    auth = app.get(AuthService);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    for (const [k, v] of [
      ['PRODUCT_REVIEWS_ENABLED', flags.reviews],
      ['ACCOUNT_BUYER_ACCESS_ENABLED', flags.buyer],
      ['REVIEW_WINDOW_DAYS', flags.window],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  async function actor(role: Role = 'USER') {
    const user = await db.user.create({
      data: { email: marker() + '@example.invalid', passwordHash, role },
    });
    const session = await auth.login({ email: user.email, password });
    return { ...user, token: session.accessToken };
  }
  async function fixture(age = 1, role: Role = 'USER') {
    const buyer = await actor(role),
      seller = await actor('SELLER'),
      admin = await actor('ADMIN');
    const store = await db.store.create({
      data: { sellerId: seller.id, name: marker(), status: 'ACTIVE' },
    });
    const category = await db.category.create({
      data: { name: marker(), slug: marker() },
    });
    const product = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: marker(),
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        images: {
          create: { url: '/uploads/synthetic-review.jpg', isPrimary: true },
        },
        shippingProfile: { create: { packageWeightGrams: 500 } },
      },
    });
    const variant = await db.productVariant.create({
      data: {
        storeId: store.id,
        productId: product.id,
        skuCode: marker(),
        optionSignature: '[]',
        price: '50000.00',
        stock: 5,
      },
    });
    const checkout = await db.checkout.create({
      data: {
        buyerId: buyer.id,
        idempotencyKey: marker(),
        requestHash: 'controlled-review-fixture',
      },
    });
    const completedAt = new Date(Date.now() - age * 86400000);
    const order = await db.order.create({
      data: {
        checkoutId: checkout.id,
        buyerId: buyer.id,
        storeId: store.id,
        orderNumber: marker(),
        status: 'COMPLETED',
        deliveredAt: completedAt,
        completedAt,
        recipientNameSnapshot: 'Private synthetic recipient',
        phoneSnapshot: '0000000000',
        provinceSnapshot: 'QA',
        wardSnapshot: 'QA',
        addressLineSnapshot: 'Private synthetic address',
        subtotal: '100000.00',
        shippingFee: '20000.00',
        total: '120000.00',
        payment: {
          create: {
            provider: 'COD',
            status: 'PAID',
            amount: '120000.00',
            paidAt: completedAt,
          },
        },
        items: {
          create: {
            productId: product.id,
            variantId: variant.id,
            quantity: 2,
            unitPrice: '50000.00',
            lineTotal: '100000.00',
            productNameSnapshot: 'Original synthetic item',
            skuSnapshot: variant.skuCode,
            optionSnapshot: [],
          },
        },
      },
      include: { items: true, payment: true },
    });
    return {
      buyer,
      seller,
      admin,
      store,
      product,
      variant,
      order,
      item: order.items[0]!,
    };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  const post = (path: string, token: string, body: object) =>
    http().post(path).auth(token, { type: 'bearer' }).send(body);
  const write = (
    f: F,
    body: object,
    action = 'create',
    token = f.buyer.token,
  ) => post(`/account/order-items/${f.item.id}/review/${action}`, token, body);
  async function created(f: F, body = create()) {
    const r = await write(f, body)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    return { body, receipt: r.body.receipt };
  }
  const reconcile = (f: F, b: ReturnType<typeof create>) =>
    post(
      `/review-commands/BUYER/create/${f.item.id}/reconcile`,
      f.buyer.token,
      {
        commandId: b.commandId,
        confirmed: true,
        requestHash: digest(
          'BUYER',
          'create',
          f.item.id,
          input('BUYER', 'create', b),
        ),
      },
    );
  const publicRead = (f: F) => http().get(`/products/${f.product.id}/reviews`);
  it('runs app-role without superuser/CREATEDB/CREATEROLE in dedicated QA', async () => {
    if (
      process.env.GITHUB_ACTIONS === 'true' ||
      process.env.QA_REVIEW_REQUIRE_APP_ROLE !== 'true'
    )
      return;
    const [r] = await db.$queryRaw<
      {
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        name: string;
      }[]
    >`SELECT current_user AS name,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
    expect(r).toMatchObject({
      name: 'bckl_qa_app_20261021',
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });
  it('creates one verified Review, safe public allowlist/aggregate and immutable Order snapshot', async () => {
    const f = await fixture(),
      before = await db.order.findUnique({
        where: { id: f.order.id },
        include: { items: true, payment: true },
      });
    const r = await created(f);
    expect(r.receipt).toMatchObject({
      orderItemId: f.item.id,
      revision: 1,
      rating: 5,
      hidden: false,
      action: 'create',
    });
    const p = await publicRead(f)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(p.body).toMatchObject({ count: 1, average: 5, counts: { '5': 1 } });
    expect(Object.keys(p.body.items[0]).sort()).toEqual(
      [
        'id',
        'rating',
        'body',
        'author',
        'createdAt',
        'updatedAt',
        'reply',
        'isRefunded',
      ].sort(),
    );
    expect(p.body.items[0].author).toBe('Người mua đã xác minh');
    expect(
      await db.order.findUnique({
        where: { id: f.order.id },
        include: { items: true, payment: true },
      }),
    ).toEqual(before);
    expect(
      (
        await db.productVariant.findUniqueOrThrow({
          where: { id: f.variant.id },
        })
      ).stock,
    ).toBe(5);
  });
  it('rejects guest, non-Buyer role, other Buyer and foreign Store Seller', async () => {
    const f = await fixture(),
      other = await actor(),
      seller = await actor('SELLER');
    await http()
      .post(`/account/order-items/${f.item.id}/review/create`)
      .send(create())
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await write(f, create(), 'create', f.admin.token).expect(403);
    await write(f, create(), 'create', other.token).expect(404);
    await created(f);
    await post(
      `/seller/reviews/${f.item.id}/reply`,
      seller.token,
      command({ body: 'Fake Store', expectedRevision: 1 }),
    ).expect(404);
  });
  it('same key replay/reconcile returns historical receipt, different body/key cannot duplicate', async () => {
    const f = await fixture(),
      r = await created(f);
    expect((await write(f, r.body).expect(200)).body.receipt).toEqual(
      r.receipt,
    );
    expect((await reconcile(f, r.body).expect(200)).body.receipt).toEqual(
      r.receipt,
    );
    await write(f, { ...r.body, rating: 4 }).expect(409);
    await write(f, create()).expect(409);
    expect(
      await db.productReview.count({ where: { orderItemId: f.item.id } }),
    ).toBe(1);
    expect(
      await db.productReviewAudit.count({
        where: { reviewId: r.receipt.reviewId },
      }),
    ).toBe(1);
  });
  it('closing unused key never creates Review and fences delayed original execution', async () => {
    const f = await fixture(),
      b = create();
    expect((await reconcile(f, b).expect(200)).body).toMatchObject({
      outcome: 'CLOSED',
      receipt: null,
    });
    await write(f, b).expect(409);
    expect(
      await db.productReview.count({ where: { orderItemId: f.item.id } }),
    ).toBe(0);
  });
  it('two concurrent create commands have one winner and one Review/audit', async () => {
    const f = await fixture();
    const r = await Promise.all([write(f, create()), write(f, create())]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(
      await db.productReview.count({ where: { orderItemId: f.item.id } }),
    ).toBe(1);
  });
  it('rejects old window, incomplete or missing completion timestamp; invalid config fails closed', async () => {
    const old = await fixture(31);
    await write(old, create()).expect(409);
    const f = await fixture();
    await db.order.update({
      where: { id: f.order.id },
      data: { status: 'DELIVERED', completedAt: null },
    });
    await write(f, create()).expect(409);
    process.env.REVIEW_WINDOW_DAYS = 'NaN';
    try {
      await write(old, create()).expect(503);
    } finally {
      process.env.REVIEW_WINDOW_DAYS = '30';
    }
  });
  it('allows SELLER Buyer at another Store but feature-disabled new writes fail; old receipt still recovers', async () => {
    const f = await fixture(1, 'SELLER'),
      r = await created(f);
    process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'false';
    try {
      expect((await reconcile(f, r.body).expect(200)).body.receipt).toEqual(
        r.receipt,
      );
      await write(
        f,
        command({ rating: 3, body: 'Edited review', expectedRevision: 1 }),
        'edit',
      ).expect(403);
    } finally {
      process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'true';
    }
  });
  it('Buyer edits increment revision and stale or concurrent edits cannot overwrite', async () => {
    const f = await fixture();
    await created(f);
    const b = command({
      rating: 4,
      body: 'Sửa nhận xét sau sử dụng',
      expectedRevision: 1,
    });
    const rs = await Promise.all([
      write(f, b, 'edit'),
      write(f, { ...b, commandId: randomUUID(), rating: 2 }, 'edit'),
    ]);
    expect(rs.map((x) => x.status).sort()).toEqual([200, 409]);
    const r = await db.productReview.findUniqueOrThrow({
      where: { orderItemId: f.item.id },
    });
    expect(r.revision).toBe(2);
    expect(
      await db.productReviewAudit.count({ where: { reviewId: r.id } }),
    ).toBe(2);
  });
  it('Seller replies once, increments common revision, cannot change Buyer score', async () => {
    const f = await fixture();
    await created(f);
    const b = command({ body: 'Cảm ơn bạn đã ủng hộ.', expectedRevision: 1 });
    const r = await post(
      `/seller/reviews/${f.item.id}/reply`,
      f.seller.token,
      b,
    ).expect(200);
    expect(r.body.receipt).toMatchObject({
      revision: 2,
      rating: 5,
      action: 'reply',
    });
    await post(`/seller/reviews/${f.item.id}/reply`, f.seller.token, {
      ...b,
      commandId: randomUUID(),
      expectedRevision: 2,
    }).expect(409);
    await write(
      f,
      command({ rating: 4, body: 'Draft old revision', expectedRevision: 1 }),
      'edit',
    ).expect(409);
    expect((await publicRead(f).expect(200)).body.items[0].reply.body).toBe(
      b.body,
    );
  });
  it('Admin hide atomically removes aggregate and reply; Buyer edit never resurrects hidden Review', async () => {
    const f = await fixture();
    await created(f);
    await post(
      `/seller/reviews/${f.item.id}/reply`,
      f.seller.token,
      command({ body: 'Cảm ơn khách hàng', expectedRevision: 1 }),
    ).expect(200);
    await post(
      `/admin/reviews/${f.item.id}/hide`,
      f.admin.token,
      command({
        expectedRevision: 2,
        reason: 'Nội dung vi phạm quy tắc cộng đồng',
      }),
    ).expect(200);
    const p = await publicRead(f).expect(200);
    expect(p.body).toMatchObject({ count: 0, average: null, items: [] });
    await write(
      f,
      command({ rating: 4, body: 'Đã sửa nội dung', expectedRevision: 3 }),
      'edit',
    ).expect(200);
    expect((await publicRead(f).expect(200)).body.count).toBe(0);
    await post(
      `/admin/reviews/${f.item.id}/hide`,
      f.admin.token,
      command({ expectedRevision: 4, reason: 'Ẩn thêm lần hai không hợp lệ' }),
    ).expect(409);
    const mine = await http()
      .get(`/account/order-items/${f.item.id}/review`)
      .auth(f.buyer.token, { type: 'bearer' })
      .expect(200);
    expect(mine.body.history).toHaveLength(4);
    expect(mine.body.review.hidden).toBe(true);
    expect(mine.body.history.every((a: object) => !('reason' in a))).toBe(true);
    const detail = await http()
      .get(`/admin/reviews/${f.item.id}`)
      .auth(f.admin.token, { type: 'bearer' })
      .expect(200);
    expect(
      detail.body.history.find((a: { action: string }) => a.action === 'hide')
        .reason,
    ).toBe('Nội dung vi phạm quy tắc cộng đồng');
    await http()
      .get(`/admin/reviews/${f.item.id}`)
      .auth(f.buyer.token, { type: 'bearer' })
      .expect(403);
  });
  it('Seller reply and Admin hide at same revision serialize with one winner', async () => {
    const f = await fixture();
    await created(f);
    const rs = await Promise.all([
      post(
        `/seller/reviews/${f.item.id}/reply`,
        f.seller.token,
        command({
          expectedRevision: 1,
          body: 'Seller reply during moderation',
        }),
      ),
      post(
        `/admin/reviews/${f.item.id}/hide`,
        f.admin.token,
        command({
          expectedRevision: 1,
          reason: 'Admin moderation during Seller reply',
        }),
      ),
    ]);
    expect(rs.map((x) => x.status).sort()).toEqual([200, 409]);
  });
  it('SUSPENDED Store can answer historical transaction; CLOSED blocks fresh reply but preserves receipt', async () => {
    const f = await fixture();
    await created(f);
    await db.store.update({
      where: { id: f.store.id },
      data: { status: 'SUSPENDED' },
    });
    const b = command({
      expectedRevision: 1,
      body: 'Hỗ trợ giao dịch đã hoàn tất',
    });
    const r = await post(
      `/seller/reviews/${f.item.id}/reply`,
      f.seller.token,
      b,
    ).expect(200);
    await db.store.update({
      where: { id: f.store.id },
      data: { status: 'CLOSED' },
    });
    expect(
      (
        await post(
          `/seller/reviews/${f.item.id}/reply`,
          f.seller.token,
          b,
        ).expect(200)
      ).body.receipt,
    ).toEqual(r.body.receipt);
    const other = await fixture();
    await created(other);
    await db.store.update({
      where: { id: other.store.id },
      data: { status: 'CLOSED' },
    });
    await post(
      `/seller/reviews/${other.item.id}/reply`,
      other.seller.token,
      command({ expectedRevision: 1, body: 'New response after closure' }),
    ).expect(403);
  });
  it('late receipt recovery remains valid after window expiration, fresh edit is rejected', async () => {
    const f = await fixture(),
      r = await created(f);
    await db.order.update({
      where: { id: f.order.id },
      data: {
        completedAt: new Date(Date.now() - 31 * 86400000),
        deliveredAt: new Date(Date.now() - 32 * 86400000),
      },
    });
    expect((await reconcile(f, r.body).expect(200)).body.receipt).toEqual(
      r.receipt,
    );
    await write(
      f,
      command({ rating: 4, body: 'Too late edit', expectedRevision: 1 }),
      'edit',
    ).expect(409);
  });
  it('public Product visibility also protects review list/aggregate and private inbox scopes', async () => {
    const f = await fixture();
    await created(f);
    const stranger = await actor('SELLER');
    expect(
      (
        await http()
          .get('/seller/reviews')
          .auth(stranger.token, { type: 'bearer' })
          .expect(200)
      ).body.items,
    ).toEqual([]);
    await http()
      .get('/admin/reviews')
      .auth(f.buyer.token, { type: 'bearer' })
      .expect(403);
    await db.store.update({
      where: { id: f.store.id },
      data: { status: 'SUSPENDED' },
    });
    await publicRead(f).expect(404).expect('Cache-Control', 'no-store');
  });
  it('canonical actor deactivation or credential change blocks stale-token reads and writes', async () => {
    const f = await fixture();
    await db.user.update({
      where: { id: f.buyer.id },
      data: { isActive: false },
    });
    await write(f, create()).expect(401);
    const g = await fixture();
    await db.user.update({
      where: { id: g.buyer.id },
      data: { credentialVersion: { increment: 1 } },
    });
    await http()
      .get(`/account/order-items/${g.item.id}/review`)
      .auth(g.buyer.token, { type: 'bearer' })
      .expect(401);
  });
  it('strict query/body errors create no command and remain no-store', async () => {
    const f = await fixture();
    for (const suffix of ['?limit=01', '?limit=1&limit=2', '?q=x'])
      await http()
        .get(`/products/${f.product.id}/reviews${suffix}`)
        .expect(400)
        .expect('Cache-Control', 'no-store');
    await post(
      `/account/order-items/${f.item.id}/review/create?x=1`,
      f.buyer.token,
      create(),
    ).expect(400);
    await write(f, { ...create(), actorId: f.seller.id }).expect(400);
    expect(
      await db.productReviewCommand.count({
        where: { orderItemId: f.item.id },
      }),
    ).toBe(0);
  });
  it('refund through the real Aftersales API preserves Review and exposes only a boolean badge', async () => {
    const f = await fixture();
    const r = await created(f);
    const a = await post(
      `/aftersales/items/${f.item.id}/requests`,
      f.buyer.token,
      {
        commandId: randomUUID(),
        kind: 'REFUND_ONLY',
        reasonCode: 'DAMAGED',
        description: 'Synthetic delivered item arrived damaged',
      },
    ).expect(200);
    await post(
      `/seller/aftersales/requests/${a.body.receipt.request.id}/approve`,
      f.seller.token,
      {
        commandId: randomUUID(),
        expectedRevision: 1,
        reason: 'Seller approves simulated refund after inspection',
      },
    ).expect(200);
    expect((await publicRead(f).expect(200)).body.items[0]).toMatchObject({
      id: r.receipt.reviewId,
      rating: 5,
      isRefunded: true,
    });
    await write(
      f,
      command({
        expectedRevision: 1,
        rating: 4,
        body: 'Đã được hỗ trợ hoàn tiền mô phỏng.',
      }),
      'edit',
    ).expect(200);
    expect(
      await db.productReview.count({ where: { orderItemId: f.item.id } }),
    ).toBe(1);
  });
  it('a historical self-purchase cannot create a self-review', async () => {
    const f = await fixture(1, 'SELLER');
    await db.store.update({
      where: { id: f.store.id },
      data: { sellerId: f.buyer.id },
    });
    await write(f, create()).expect(403);
    expect(
      await db.productReview.count({ where: { orderItemId: f.item.id } }),
    ).toBe(0);
  });
  it('audit failure rolls back Review, reply and command receipt rather than leaving a partial write', async () => {
    const f = await fixture();
    const original = db.$transaction.bind(db);
    const spy = vi.spyOn(db, '$transaction').mockImplementation(((
      fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: object,
    ) =>
      original(
        (tx) =>
          fn(
            new Proxy(tx, {
              get(target, key) {
                if (key === 'productReviewAudit')
                  return new Proxy(target.productReviewAudit, {
                    get(delegate, method) {
                      if (method === 'create')
                        return () => {
                          throw Error('Controlled Review audit failure');
                        };
                      return Reflect.get(delegate, method);
                    },
                  });
                return Reflect.get(target, key);
              },
            }),
          ),
        options,
      )) as typeof db.$transaction);
    try {
      await write(f, create()).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      await db.productReview.count({ where: { orderItemId: f.item.id } }),
    ).toBe(0);
    expect(
      await db.productReviewCommand.count({
        where: { orderItemId: f.item.id },
      }),
    ).toBe(0);
  });
  it('corrupted valid-shaped receipt cannot clear recovery or mutate an existing Review', async () => {
    const f = await fixture(),
      b = create();
    await db.$transaction(async (tx) => {
      const r = await tx.productReview.create({
        data: {
          orderItemId: f.item.id,
          rating: 5,
          body: 'Synthetic historic review',
        },
      });
      const a = await tx.productReviewAudit.create({
        data: {
          reviewId: r.id,
          actorId: f.buyer.id,
          revision: 1,
          action: 'create',
          rating: 5,
          body: r.body,
          hidden: false,
        },
      });
      await tx.productReviewCommand.create({
        data: {
          actorId: f.buyer.id,
          commandId: b.commandId,
          scope: 'BUYER',
          action: 'create',
          orderItemId: f.item.id,
          requestHash: digest(
            'BUYER',
            'create',
            f.item.id,
            input('BUYER', 'create', b),
          ),
          outcome: 'APPLIED',
          auditId: a.id,
          receipt: {
            orderItemId: f.item.id,
            reviewId: r.id,
            revision: 1,
            rating: 4,
            hidden: false,
            action: 'create',
            auditId: a.id.toString(),
          },
        },
      });
    });
    const before = await db.productReview.findUnique({
      where: { orderItemId: f.item.id },
    });
    await reconcile(f, b).expect(503);
    expect(
      await db.productReview.findUnique({ where: { orderItemId: f.item.id } }),
    ).toEqual(before);
  });
  it('DB rejects evidence mutation, invalid rating, hidden resurrection and unaudited revision', async () => {
    const f = await fixture(),
      r = await created(f);
    await expect(
      db.productReviewAudit.update({
        where: { id: BigInt(r.receipt.auditId) },
        data: { body: 'tampered' },
      }),
    ).rejects.toThrow();
    await expect(
      db.productReviewCommand.deleteMany({ where: { orderItemId: f.item.id } }),
    ).rejects.toThrow();
    await expect(
      db.productReview.update({
        where: { id: r.receipt.reviewId },
        data: { revision: { increment: 1 }, rating: 6 },
      }),
    ).rejects.toThrow();
    await expect(
      db.productReview.update({
        where: { id: r.receipt.reviewId },
        data: { revision: { increment: 1 }, body: 'Unaudited mutation' },
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.productReview.findUniqueOrThrow({
          where: { id: r.receipt.reviewId },
        })
      ).revision,
    ).toBe(1);
  });
});
