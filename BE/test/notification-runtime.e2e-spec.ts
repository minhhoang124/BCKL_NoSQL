import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma.service.js';
import {
  NotificationProjector,
  NOTIFICATION_LOCK_NAMESPACE,
} from '../src/notification/notification-projector.js';
import { notificationSources } from '../src/notification/notification-sources.js';
const marker = () => `notify-${randomUUID()}`;
describe('Notification HTTP/PostgreSQL committed-event delivery and permissions', () => {
  let app: INestApplication,
    db: PrismaService,
    auth: AuthService,
    projector: NotificationProjector,
    passwordHash: string;
  const password = 'Synthetic-notification-only-2026',
    old = {
      enabled: process.env.NOTIFICATIONS_ENABLED,
      worker: process.env.NOTIFICATIONS_WORKER_ENABLED,
      buyer: process.env.ACCOUNT_BUYER_ACCESS_ENABLED,
    };
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    const u = new URL(process.env.DATABASE_URL ?? '');
    const local =
      u.hostname === '127.0.0.1' &&
      u.port === '5549' &&
      ['/bckl_order_resolution_test_attributes_20261019_v957','/bckl_order_resolution_test_attributes_20261019_v959', '/bckl_order_resolution_test_attributes_20261019_v961'].includes(u.pathname);
    const ci =
      process.env.GITHUB_ACTIONS === 'true' &&
      ['127.0.0.1', 'localhost'].includes(u.hostname) &&
      u.port === '5549' &&
      u.pathname === '/bckl_order_resolution_test_attributes_20261019';
    if (!local && !ci) throw Error('Exact isolated Notification QA required');
    process.env.NOTIFICATIONS_ENABLED = 'true';
    process.env.NOTIFICATIONS_WORKER_ENABLED = 'false';
    process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'true';
    passwordHash = await hash(password, 4);
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    auth = app.get(AuthService);
    projector = app.get(NotificationProjector);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    for (const [k, v] of [
      ['NOTIFICATIONS_ENABLED', old.enabled],
      ['NOTIFICATIONS_WORKER_ENABLED', old.worker],
      ['ACCOUNT_BUYER_ACCESS_ENABLED', old.buyer],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  async function actor(role: Role = 'USER') {
    const u = await db.user.create({
        data: { email: marker() + '@example.invalid', passwordHash, role },
      }),
      session = await auth.login({ email: u.email, password });
    return { ...u, token: session.accessToken };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  const get = (u: Actor, query = '') =>
    http()
      .get('/account/notifications' + query)
      .auth(u.token, { type: 'bearer' });
  const post = (u: Actor, path: string, body: object = { confirmed: true }) =>
    http()
      .post('/account/notifications/' + path)
      .auth(u.token, { type: 'bearer' })
      .send(body);
  async function fixture(completed = false) {
    const buyer = await actor(),
      seller = await actor('SELLER'),
      admin = await actor('ADMIN');
    const store = await db.store.create({
        data: { sellerId: seller.id, name: marker(), status: 'ACTIVE' },
      }),
      category = await db.category.create({
        data: { name: marker(), slug: marker() },
      }),
      product = await db.product.create({
        data: { storeId: store.id, categoryId: category.id, name: marker() },
      }),
      variant = await db.productVariant.create({
        data: {
          storeId: store.id,
          productId: product.id,
          skuCode: marker(),
          optionSignature: '[]',
          price: '50000.00',
          stock: 5,
        },
      }),
      checkout = await db.checkout.create({
        data: {
          buyerId: buyer.id,
          idempotencyKey: marker(),
          requestHash: 'synthetic-notification-fixture',
        },
      });
    const order = await db.order.create({
      data: {
        checkoutId: checkout.id,
        buyerId: buyer.id,
        storeId: store.id,
        orderNumber: marker(),
        status: completed ? 'COMPLETED' : 'PENDING_CONFIRMATION',
        ...(completed
          ? {
              deliveredAt: new Date(Date.now() - 86400000),
              completedAt: new Date(Date.now() - 86400000),
            }
          : {}),
        recipientNameSnapshot: 'Private synthetic Buyer',
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
            status: completed ? 'PAID' : 'UNPAID',
            amount: '120000.00',
            ...(completed ? { paidAt: new Date(Date.now() - 86400000) } : {}),
          },
        },
        items: {
          create: {
            productId: product.id,
            variantId: variant.id,
            quantity: 2,
            unitPrice: '50000.00',
            lineTotal: '100000.00',
            productNameSnapshot: 'Synthetic item',
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
  const event = (f: F, who: 'buyer' | 'seller' = 'seller') =>
    db.orderStatusHistory.create({
      data: {
        orderId: f.order.id,
        fromStatus: 'PENDING_CONFIRMATION',
        toStatus: 'CONFIRMED',
        actorId: f[who].id,
        actorType: null, // Compatible legacy audit shape; no invented durable command receipt.
        reason: 'INTERNAL_PRIVATE_REASON',
      },
    });
  it('dedicated QA role has no superuser/database/role creation privileges', async () => {
    if (
      process.env.GITHUB_ACTIONS === 'true' ||
      process.env.QA_NOTIFICATION_REQUIRE_APP_ROLE !== 'true'
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
  it('all six allowlisted source queries compile against real PostgreSQL', async () => {
    expect(notificationSources).toHaveLength(6);
    for (const s of notificationSources)
      await expect(db.$queryRaw(s.query)).resolves.toBeInstanceOf(Array);
  });
  it('real Store application rejection notifies the unpromoted USER and its guarded destination remains readable', async () => {
    const previous = process.env.SELLER_ONBOARDING_ENABLED;
    process.env.SELLER_ONBOARDING_ENABLED = 'true';
    try {
      const owner = await actor(),
        admin = await actor('ADMIN');
      const submitted = await http()
        .post('/account/store-application')
        .auth(owner.token, { type: 'bearer' })
        .send({
          commandId: randomUUID(),
          confirmed: true,
          reason: 'Synthetic application for notification QA',
          name: marker(),
          description: '',
          contactName: 'Synthetic Owner',
          contactPhone: '+84901234567',
          pickupAddress: 'Synthetic pickup address 01',
          returnAddress: 'Synthetic return address 01',
        })
        .expect(200);
      const id = submitted.body.receipt.storeId;
      await http()
        .post(`/admin/store-applications/${id}/review`)
        .auth(admin.token, { type: 'bearer' })
        .send({
          commandId: randomUUID(),
          confirmed: true,
          expectedRevision: 1,
          status: 'REJECTED',
          reason: 'PRIVATE_APPLICATION_REJECTION',
        })
        .expect(200);
      const p = (await get(owner).expect(200)).body;
      expect(p.items).toHaveLength(1);
      expect(p.items[0].link).toBe('/account/store-application');
      expect(JSON.stringify(p)).not.toContain('PRIVATE_APPLICATION_REJECTION');
      await http()
        .get(p.items[0].link)
        .auth(owner.token, { type: 'bearer' })
        .expect(200);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).role,
      ).toBe('USER');
    } finally {
      if (previous === undefined) delete process.env.SELLER_ONBOARDING_ENABLED;
      else process.env.SELLER_ONBOARDING_ENABLED = previous;
    }
  });
  it('Review create/edit/reply events use distinct audit IDs and never copy private content', async () => {
    const previous = process.env.PRODUCT_REVIEWS_ENABLED;
    process.env.PRODUCT_REVIEWS_ENABLED = 'true';
    try {
      const f = await fixture(true);
      const write = (
        scope: string,
        action: string,
        token: string,
        extra: object,
      ) =>
        http()
          .post(
            scope === 'BUYER'
              ? `/account/order-items/${f.item.id}/review/${action}`
              : `/seller/reviews/${f.item.id}/${action}`,
          )
          .auth(token, { type: 'bearer' })
          .send({ commandId: randomUUID(), confirmed: true, ...extra });
      await write('BUYER', 'create', f.buyer.token, {
        rating: 5,
        body: 'PRIVATE_REVIEW_BODY',
      }).expect(200);
      await write('BUYER', 'edit', f.buyer.token, {
        expectedRevision: 1,
        rating: 4,
        body: 'PRIVATE_EDITED_REVIEW_BODY',
      }).expect(200);
      const seller = (await get(f.seller).expect(200)).body;
      expect(seller.items).toHaveLength(2);
      expect(JSON.stringify(seller)).not.toContain('PRIVATE_EDITED');
      await write('SELLER', 'reply', f.seller.token, {
        expectedRevision: 2,
        body: 'PRIVATE_SELLER_REPLY_BODY',
      }).expect(200);
      const buyer = (await get(f.buyer).expect(200)).body;
      expect(buyer.items).toHaveLength(1);
      expect(buyer.items[0].link).toBe(`/account/reviews?itemId=${f.item.id}`);
      expect(JSON.stringify(buyer)).not.toContain('PRIVATE_SELLER_REPLY');
    } finally {
      if (previous === undefined) delete process.env.PRODUCT_REVIEWS_ENABLED;
      else process.env.PRODUCT_REVIEWS_ENABLED = previous;
    }
  });
  it('real Aftersales simulated-refund commit is delivered without rewriting Order or Payment', async () => {
    const f = await fixture(true),
      before = await db.order.findUnique({
        where: { id: f.order.id },
        include: { payment: true, items: true },
      });
    const opened = await http()
      .post(`/aftersales/items/${f.item.id}/requests`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send({
        commandId: randomUUID(),
        kind: 'REFUND_ONLY',
        reasonCode: 'DAMAGED',
        description: 'PRIVATE_AFTERSALE_DESCRIPTION',
      })
      .expect(200);
    await http()
      .post(
        `/seller/aftersales/requests/${opened.body.receipt.request.id}/approve`,
      )
      .auth(f.seller.token, { type: 'bearer' })
      .send({
        commandId: randomUUID(),
        expectedRevision: 1,
        reason: 'PRIVATE_AFTERSALE_APPROVAL',
      })
      .expect(200);
    const p = (await get(f.buyer).expect(200)).body;
    expect(p.items).toHaveLength(1);
    expect(p.items[0].text).toContain('mô phỏng');
    expect(JSON.stringify(p)).not.toContain('PRIVATE_AFTERSALE');
    expect(
      await db.order.findUnique({
        where: { id: f.order.id },
        include: { payment: true, items: true },
      }),
    ).toEqual(before);
    expect(
      await db.refundRecord.count({ where: { orderItemId: f.item.id } }),
    ).toBe(1);
  });
  it('recipient advisory lock prevents committing a later Notification ID ahead of an uncommitted lower ID', async () => {
    const f = await fixture(),
      first = await event(f),
      second = await event(f);
    let release!: () => void,
      allocated!: (id: bigint) => void,
      rejectAllocated!: (e: unknown) => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      created = new Promise<bigint>((r, j) => {
        allocated = r;
        rejectAllocated = j;
      });
    const slow = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${NOTIFICATION_LOCK_NAMESPACE}::integer,${f.buyer.id}::integer)`;
        const n = await tx.notification.create({
          data: {
            recipientId: f.buyer.id,
            audience: 'BUYER',
            sourceKind: 'ORDER',
            sourceId: BigInt(first.id),
            title: 'Synthetic delayed notification',
            text: 'Synthetic committed history reference',
            link: `/account/orders/${f.order.id}`,
            eventAt: first.createdAt,
          },
        });
        allocated(n.id);
        await gate;
      },
      { timeout: 10000 },
    );
    void slow.catch(rejectAllocated);
    try {
      const low = await created;
      const later = projector.project(f.buyer.id);
      let waiting = false;
      for (let i = 0; i < 40 && !waiting; i++) {
        const [r] = await db.$queryRaw<
          { n: number }[]
        >`SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND classid=${NOTIFICATION_LOCK_NAMESPACE}::oid AND objid=${f.buyer.id}::oid AND NOT granted`;
        waiting = r.n > 0;
        if (!waiting) await new Promise((r) => setTimeout(r, 10));
      }
      expect(waiting).toBe(true);
      expect(
        await db.notification.count({ where: { recipientId: f.buyer.id } }),
      ).toBe(0);
      release();
      await slow;
      await later;
      const high = await db.notification.findFirstOrThrow({
        where: {
          recipientId: f.buyer.id,
          sourceKind: 'ORDER',
          sourceId: BigInt(second.id),
        },
      });
      expect(high.id > low).toBe(true);
    } finally {
      release();
      await slow;
    }
  });
  it('materializes own committed Order history, not actor echo, and keeps payload private', async () => {
    const f = await fixture();
    await event(f);
    const r = await get(f.buyer)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(r.body.syncPending).toBe(false);
    expect(r.body.unreadCount).toBe(1);
    expect(r.body.items).toHaveLength(1);
    expect(Object.keys(r.body.items[0]).sort()).toEqual(
      ['id', 'title', 'text', 'link', 'eventAt', 'createdAt', 'readAt'].sort(),
    );
    expect(r.body.items[0].link).toBe(`/account/orders/${f.order.id}`);
    expect(JSON.stringify(r.body)).not.toMatch(
      /INTERNAL_PRIVATE_REASON|Private synthetic|0000000000|passwordHash|recipientId|sourceId/,
    );
    expect((await get(f.seller).expect(200)).body.items).toHaveLength(0);
  });
  it('repeated reads and concurrent projectors cannot duplicate event+recipient+channel', async () => {
    const f = await fixture();
    const h = await event(f);
    await Promise.all([
      projector.project(f.buyer.id),
      projector.project(),
      projector.project(f.buyer.id),
    ]);
    await get(f.buyer).expect(200);
    expect(
      await db.notification.count({
        where: {
          recipientId: f.buyer.id,
          sourceKind: 'ORDER',
          sourceId: BigInt(h.id),
        },
      }),
    ).toBe(1);
  });
  it('read acknowledgement is idempotent and does not alter payload/time a second time', async () => {
    const f = await fixture();
    await event(f);
    const p = (await get(f.buyer).expect(200)).body,
      r = await post(f.buyer, `${p.items[0].id}/read`).expect(200);
    expect(r.body.readAt).not.toBeNull();
    expect(
      (await post(f.buyer, `${p.items[0].id}/read`).expect(200)).body.readAt,
    ).toBe(r.body.readAt);
    expect((await get(f.buyer).expect(200)).body.unreadCount).toBe(0);
  });
  it('foreign user cannot read or mark another notification', async () => {
    const f = await fixture(),
      other = await actor();
    await event(f);
    const p = (await get(f.buyer).expect(200)).body;
    expect((await get(other).expect(200)).body.items).toEqual([]);
    await post(other, `${p.items[0].id}/read`).expect(404);
    await post(other, 'read-all', {
      confirmed: true,
      throughId: p.items[0].id,
    }).expect(404);
  });
  it('read-all is bounded by a visible own cursor so new arrivals remain unread', async () => {
    const f = await fixture();
    await event(f);
    const first = (await get(f.buyer).expect(200)).body;
    await event(f);
    await get(f.buyer).expect(200);
    await post(f.buyer, 'read-all', {
      confirmed: true,
      throughId: first.throughId,
    }).expect(200);
    const p = (await get(f.buyer).expect(200)).body;
    expect(p.unreadCount).toBe(1);
    expect(p.items[0].readAt).toBeNull();
    expect(p.items[1].readAt).not.toBeNull();
  });
  it('pagination and unread filters preserve canonical BigInt cursor and count', async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) await event(f);
    const a = (await get(f.buyer, '?limit=2').expect(200)).body;
    expect(a.items).toHaveLength(2);
    expect(a.nextBeforeId).toBe(a.items[1].id);
    const b = (
      await get(f.buyer, `?limit=2&beforeId=${a.nextBeforeId}`).expect(200)
    ).body;
    expect(b.items).toHaveLength(1);
    expect(b.unreadCount).toBe(3);
    await post(f.buyer, `${a.items[0].id}/read`).expect(200);
    expect(
      (await get(f.buyer, '?unread=false').expect(200)).body.items,
    ).toHaveLength(1);
  });
  it('delayed low-id source commit is not skipped after a higher-id event is delivered', async () => {
    const f = await fixture();
    let release!: () => void,
      allocated!: (n: number) => void,
      rejected!: (e: unknown) => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      lowId = new Promise<number>((r, reject) => {
        allocated = r;
        rejected = reject;
      });
    const slow = db.$transaction(
      async (tx) => {
        const h = await tx.orderStatusHistory.create({
          data: {
            orderId: f.order.id,
            toStatus: 'CONFIRMED',
            actorId: f.seller.id,
            actorType: null,
          },
        });
        allocated(h.id);
        await gate;
      },
      { timeout: 10000 },
    );
    void slow.catch(rejected);
    try {
      const low = await lowId,
        high = await event(f);
      expect(high.id).toBeGreaterThan(low);
      const first = (await get(f.buyer).expect(200)).body;
      expect(first.items).toHaveLength(1);
      release();
      await slow;
      const next = (await get(f.buyer).expect(200)).body;
      expect(next.items).toHaveLength(2);
      expect(
        await db.notification.count({
          where: {
            recipientId: f.buyer.id,
            sourceKind: 'ORDER',
            sourceId: BigInt(low),
          },
        }),
      ).toBe(1);
    } finally {
      release();
      await slow;
    }
  });
  it('rolled-back source transaction produces no notification', async () => {
    const f = await fixture();
    await expect(
      db.$transaction(async (tx) => {
        await tx.orderStatusHistory.create({
          data: {
            orderId: f.order.id,
            toStatus: 'CONFIRMED',
            actorId: f.seller.id,
            actorType: null,
          },
        });
        throw Error('Controlled business rollback');
      }),
    ).rejects.toThrow();
    expect((await get(f.buyer).expect(200)).body.items).toEqual([]);
  });
  it('projection failure returns prior inbox with syncPending, committed Order remains unchanged and retry catches up', async () => {
    const f = await fixture();
    await event(f);
    const snapshot = await db.order.findUnique({
      where: { id: f.order.id },
      include: { items: true, payment: true },
    });
    const spy = vi
      .spyOn(projector, 'project')
      .mockRejectedValueOnce(Error('Controlled projection failure'));
    try {
      const r = (await get(f.buyer).expect(200)).body;
      expect(r.syncPending).toBe(true);
      expect(r.items).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    expect(
      await db.order.findUnique({
        where: { id: f.order.id },
        include: { items: true, payment: true },
      }),
    ).toEqual(snapshot);
    expect((await get(f.buyer).expect(200)).body.items).toHaveLength(1);
  });
  it('more than one batch signals catch-up rather than claiming complete delivery', async () => {
    const f = await fixture();
    await db.orderStatusHistory.createMany({
      data: Array.from({ length: 101 }, () => ({
        orderId: f.order.id,
        toStatus: 'CONFIRMED' as const,
        actorId: f.seller.id,
        actorType: null,
      })),
    });
    expect((await get(f.buyer).expect(200)).body.syncPending).toBe(true);
    const r = (await get(f.buyer).expect(200)).body;
    expect(r.syncPending).toBe(false);
    expect(r.unreadCount).toBe(101);
  });
  it('Store rejection reaches USER before Seller grant; Admin pending notification omits reason', async () => {
    const owner = await actor(),
      admin = await actor('ADMIN'),
      store = await db.store.create({
        data: { sellerId: owner.id, name: marker(), status: 'PENDING' },
      });
    await db.storeStatusHistory.create({
      data: {
        storeId: store.id,
        fromStatus: null,
        toStatus: 'PENDING',
        actorId: owner.id,
        reason: 'PRIVATE_APPLICATION_DETAIL',
      },
    });
    const a = (await get(admin).expect(200)).body;
    expect(
      a.items.some((x: { link: string }) => x.link === '/admin/stores'),
    ).toBe(true);
    await db.store.update({
      where: { id: store.id },
      data: { status: 'REJECTED' },
    });
    await db.storeStatusHistory.create({
      data: {
        storeId: store.id,
        fromStatus: 'PENDING',
        toStatus: 'REJECTED',
        actorId: admin.id,
        reason: 'PRIVATE_REJECTION_REASON',
      },
    });
    const r = (await get(owner).expect(200)).body;
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toContain('cần bổ sung hồ sơ');
    expect(JSON.stringify(r)).not.toContain('PRIVATE_REJECTION_REASON');
  });
  it('role demotion hides prior Admin audience from count/list/mark read even with fresh login', async () => {
    const owner = await actor(),
      admin = await actor('ADMIN'),
      store = await db.store.create({
        data: { sellerId: owner.id, name: marker(), status: 'PENDING' },
      });
    await db.storeStatusHistory.create({
      data: { storeId: store.id, toStatus: 'PENDING', actorId: owner.id },
    });
    const p = (await get(admin).expect(200)).body;
    expect(p.items.length).toBeGreaterThan(0);
    await db.user.update({
      where: { id: admin.id },
      data: { role: 'USER', credentialVersion: { increment: 1 } },
    });
    const session = await auth.login({ email: admin.email, password }),
      changed = { ...admin, token: session.accessToken };
    const r = (await get(changed).expect(200)).body;
    expect(r.items).toEqual([]);
    expect(r.unreadCount).toBe(0);
    await post(changed, `${p.items[0].id}/read`).expect(404);
  });
  it('Chat notification never copies message content or context payload', async () => {
    const f = await fixture(),
      c = await db.chatConversation.create({
        data: { buyerId: f.buyer.id, storeId: f.store.id, lastSequence: 0 },
      });
    await db.chatMessage.create({
      data: {
        conversationId: c.id,
        sequence: 1,
        senderId: f.buyer.id,
        senderType: 'BUYER',
        clientMessageId: randomUUID(),
        content: 'PRIVATE_CHAT_BODY_000_PHONE',
        payloadHash: 'a'.repeat(64),
      },
    });
    const r = (await get(f.seller).expect(200)).body;
    expect(r.items).toHaveLength(1);
    expect(r.items[0].link).toBe(`/messages/${c.id}`);
    expect(JSON.stringify(r)).not.toContain('PRIVATE_CHAT_BODY');
  });
  it('canonical active state and credentialVersion stop old-session reads/writes', async () => {
    const f = await fixture();
    await event(f);
    const p = (await get(f.buyer).expect(200)).body;
    await db.user.update({
      where: { id: f.buyer.id },
      data: { isActive: false },
    });
    await get(f.buyer).expect(401).expect('Cache-Control', 'no-store');
    await post(f.buyer, `${p.items[0].id}/read`).expect(401);
  });
  it('strict query, BigInt, body, flag and no-store boundaries', async () => {
    const f = await fixture();
    await http()
      .get('/account/notifications')
      .expect(401)
      .expect('Cache-Control', 'no-store');
    for (const q of [
      '?limit=01',
      '?unread=1',
      '?beforeId=9223372036854775808',
      '?limit=1&limit=2',
      '?recipientId=2',
    ])
      await get(f.buyer, q).expect(400).expect('Cache-Control', 'no-store');
    await post(f.buyer, '1/read?x=1').expect(400);
    await post(f.buyer, '1/read', {
      confirmed: true,
      recipientId: f.buyer.id,
    }).expect(400);
    process.env.NOTIFICATIONS_ENABLED = 'false';
    try {
      await get(f.buyer).expect(503);
    } finally {
      process.env.NOTIFICATIONS_ENABLED = 'true';
    }
  });
  it('DB rejects payload/recipient edits and deletion, and readAt cannot be reverted', async () => {
    const f = await fixture();
    await event(f);
    const p = (await get(f.buyer).expect(200)).body,
      id = BigInt(p.items[0].id);
    await expect(
      db.notification.update({ where: { id }, data: { title: 'tampered' } }),
    ).rejects.toThrow();
    await expect(db.notification.delete({ where: { id } })).rejects.toThrow();
    await post(f.buyer, `${id}/read`).expect(200);
    await expect(
      db.notification.update({ where: { id }, data: { readAt: null } }),
    ).rejects.toThrow();
  });
});
