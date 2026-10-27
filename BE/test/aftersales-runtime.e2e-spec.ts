import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { SearchOutboxService } from '../src/search/search-outbox.service.js';
import { OrderCompletionService } from '../src/order/order-completion.service.js';
import { AftersalesService } from '../src/aftersales/aftersales-service.js';
import {
  commandHash,
  commandInput,
} from '../src/aftersales/aftersales-input.js';

describe('Aftersales HTTP/PostgreSQL runtime and command fences', () => {
  let app: INestApplication,
    db: PrismaService,
    auth: AuthService,
    passwordHash: string;
  const password = 'Synthetic-aftersales-QA-only-2026';
  const previousWindow = process.env.AFTERSALE_REQUEST_WINDOW_DAYS;
  const marker = () => 'aftersale-' + randomUUID();
  const http = () => request(app.getHttpServer());
  const createBody = (kind = 'REFUND_ONLY') => ({
    commandId: randomUUID(),
    kind,
    reasonCode: 'DAMAGED',
    description: 'QA delivered item arrived damaged',
  });
  const changeBody = (expectedRevision: number, restockable?: boolean) => ({
    commandId: randomUUID(),
    expectedRevision,
    reason: 'QA explicit aftersale decision reason',
    ...(restockable === undefined ? {} : { restockable }),
  });
  beforeAll(async () => {
    process.env.AFTERSALE_REQUEST_WINDOW_DAYS = '7';
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !(
        url.hostname === '127.0.0.1' &&
        url.port === '5549' &&
        [
          '/bckl_order_resolution_test_attributes_20261019_v950',
          '/bckl_order_resolution_test_attributes_20261019_v951',
          '/bckl_order_resolution_test_attributes_20261019_v952',
          '/bckl_order_resolution_test_attributes_20261019_v953', '/bckl_order_resolution_test_attributes_20261019_v955', '/bckl_order_resolution_test_attributes_20261019_v957', '/bckl_order_resolution_test_attributes_20261019_v959', '/bckl_order_resolution_test_attributes_20261019_v961', '/bckl_order_resolution_test_attributes_20261019_v965', '/bckl_order_resolution_test_attributes_20261019_v967',
        ].includes(url.pathname)
      ) &&
      !(
        process.env.GITHUB_ACTIONS === 'true' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname) &&
        ((url.pathname === '/klcn_ecommerce' &&
          ['', '5432'].includes(url.port)) ||
          (url.pathname === '/bckl_order_resolution_test_attributes_20261019' &&
            url.port === '5549'))
      )
    )
      throw Error('Exact isolated QA required');
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
    if (previousWindow === undefined)
      delete process.env.AFTERSALE_REQUEST_WINDOW_DAYS;
    else process.env.AFTERSALE_REQUEST_WINDOW_DAYS = previousWindow;
  });
  async function actor(role: Role = 'USER') {
    const user = await db.user.create({
      data: { email: marker() + '@example.invalid', passwordHash, role },
    });
    const session = await auth.login({ email: user.email, password });
    return { ...user, token: session.accessToken };
  }
  async function fixture(completed = false) {
    const buyer = await actor(),
      seller = await actor('SELLER'),
      admin = await actor('ADMIN');
    const store = await db.store.create({
      data: { sellerId: seller.id, name: marker(), status: 'SUSPENDED' },
    });
    const category = await db.category.create({
      data: { name: marker(), slug: marker() },
    });
    const product = await db.product.create({
      data: { storeId: store.id, categoryId: category.id, name: marker() },
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
        requestHash: 'controlled-aftersales-fixture',
      },
    });
    const deliveredAt = new Date(Date.now() - 86400000);
    const order = await db.order.create({
      data: {
        checkoutId: checkout.id,
        buyerId: buyer.id,
        storeId: store.id,
        orderNumber: marker(),
        status: completed ? 'COMPLETED' : 'DELIVERED',
        deliveredAt,
        completedAt: completed ? deliveredAt : null,
        recipientNameSnapshot: 'Private QA recipient',
        phoneSnapshot: '0000000000',
        provinceSnapshot: 'QA',
        wardSnapshot: 'QA',
        addressLineSnapshot: 'Private QA address',
        subtotal: '100000.00',
        shippingFee: '20000.00',
        total: '120000.00',
        payment: {
          create: {
            provider: 'COD',
            status: 'PAID',
            amount: '120000.00',
            paidAt: deliveredAt,
          },
        },
        items: {
          create: {
            productId: product.id,
            variantId: variant.id,
            quantity: 2,
            unitPrice: '50000.00',
            lineTotal: '100000.00',
            productNameSnapshot: 'Original QA item',
            skuSnapshot: variant.skuCode,
            optionSnapshot: [],
          },
        },
      },
      include: { items: true, payment: true },
    });
    const item = order.items[0]!;
    await db.stockMovement.create({
      data: {
        variantId: variant.id,
        orderItemId: item.id,
        type: 'CHECKOUT_DECREMENT',
        quantityDelta: -2,
        balanceAfter: 5,
        idempotencyKey: marker(),
      },
    });
    return { buyer, seller, admin, store, product, variant, order, item };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  it('keeps Aftersales QA snapshots readable by the canonical Buyer Order API', async () => {
    const f = await fixture();
    const result = await http()
      .get(`/orders/${f.order.id}`)
      .auth(f.buyer.token, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0].options).toEqual([]);
    expect(result.body.items[0].id).toBe(f.item.id);
  });
  const post = (path: string, token: string, body: unknown) =>
    http()
      .post(path)
      .auth(token, { type: 'bearer' })
      .send(body as object);
  async function opened(f: Fixture, body = createBody()) {
    const result = await post(
      `/aftersales/items/${f.item.id}/requests`,
      f.buyer.token,
      body,
    )
      .expect(200)
      .expect('Cache-Control', 'no-store');
    return {
      id: result.body.receipt.request.id as number,
      body,
      result: result.body,
    };
  }
  const decision = (
    id: number,
    token: string,
    action: string,
    body: unknown,
    scope = 'seller',
  ) => post(`/${scope}/aftersales/requests/${id}/${action}`, token, body);
  async function snapshot(f: Fixture) {
    return {
      order: await db.order.findUnique({ where: { id: f.order.id } }),
      payment: await db.payment.findUnique({ where: { orderId: f.order.id } }),
      variant: await db.productVariant.findUnique({
        where: { id: f.variant.id },
      }),
      product: await db.product.findUnique({ where: { id: f.product.id } }),
      requests: await db.aftersaleRequest.findMany({
        where: { orderItemId: f.item.id },
        orderBy: { id: 'asc' },
      }),
      history: await db.aftersaleHistory.findMany({
        where: { request: { orderItemId: f.item.id } },
        orderBy: { id: 'asc' },
      }),
      refunds: await db.refundRecord.findMany({
        where: { orderItemId: f.item.id },
      }),
      adjustments: await db.revenueAdjustment.findMany({
        where: { refund: { orderItemId: f.item.id } },
      }),
      stock: await db.stockMovement.findMany({
        where: { orderItemId: f.item.id },
      }),
      outbox: await db.searchOutbox.findMany({
        where: { productId: f.product.id },
      }),
    };
  }
  it('creates/read history with ownership allowlists and rejects amount/unknown input', async () => {
    const f = await fixture(),
      other = await actor();
    await post(`/aftersales/items/${f.item.id}/requests`, f.buyer.token, {
      ...createBody(),
      amount: '1.00',
    }).expect(400);
    const a = await opened(f);
    const before = await snapshot(f);
    const read = await http()
      .get(`/aftersales/requests/${a.id}`)
      .auth(f.buyer.token, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(read.body.history).toHaveLength(1);
    expect(read.body.context).toEqual({
      orderId: f.order.id,
      storeId: f.store.id,
      buyerId: f.buyer.id,
      storeName: f.store.name,
      productName: 'Original QA item',
      quantity: 2,
      lineTotal: '100000.00',
    });
    expect(JSON.stringify(read.body)).not.toMatch(
      /phoneSnapshot|addressLine|credentialVersion|passwordHash|requestHash/,
    );
    await http()
      .get(`/aftersales/requests/${a.id}`)
      .auth(other.token, { type: 'bearer' })
      .expect(404);
    await http()
      .get(`/seller/aftersales/requests/${a.id}`)
      .auth(other.token, { type: 'bearer' })
      .expect(403);
    await http()
      .get(`/admin/aftersales/requests/${a.id}`)
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await http()
      .get('/aftersales?limit=1&limit=2')
      .auth(f.buyer.token, { type: 'bearer' })
      .expect(400);
    expect(await snapshot(f)).toEqual(before);
  });
  it('two creation keys for one item cannot both reserve it', async () => {
    const f = await fixture();
    const results = await Promise.all(
      [createBody(), createBody()].map((body) =>
        post(`/aftersales/items/${f.item.id}/requests`, f.buyer.token, body),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await db.aftersaleRequest.count({ where: { orderItemId: f.item.id } }),
    ).toBe(1);
  });
  it('rejected request releases budget; new request blocks dispute of old request', async () => {
    const f = await fixture(),
      a = await opened(f);
    await decision(a.id, f.seller.token, 'reject', changeBody(1)).expect(200);
    await opened(f);
    await post(
      `/aftersales/requests/${a.id}/dispute`,
      f.buyer.token,
      changeBody(2),
    ).expect(409);
    expect(
      await db.refundRecord.count({ where: { orderItemId: f.item.id } }),
    ).toBe(0);
  });
  it('cancelled request allows a new request within the original window', async () => {
    const f = await fixture(),
      a = await opened(f);
    await post(
      `/aftersales/requests/${a.id}/cancel`,
      f.buyer.token,
      changeBody(1),
    ).expect(200);
    await opened(f);
    expect(
      await db.aftersaleRequest.count({ where: { orderItemId: f.item.id } }),
    ).toBe(2);
  });
  it('REFUND_ONLY commits one simulated refund/adjustment, no stock/Order/Payment mutation and replays receipt', async () => {
    const f = await fixture(),
      a = await opened(f),
      body = changeBody(1),
      before = await snapshot(f);
    const response = await decision(
      a.id,
      f.seller.token,
      'approve',
      body,
    ).expect(200);
    expect(response.body.receipt.refund).toMatchObject({
      amount: '100000.00',
      mode: 'SIMULATED',
    });
    const after = await snapshot(f);
    expect(after.order).toEqual(before.order);
    expect(after.payment).toEqual(before.payment);
    expect(after.stock).toEqual(before.stock);
    expect(after.refunds).toHaveLength(1);
    expect(after.adjustments[0]!.effectiveAt).toBeNull();
    const replay = await decision(a.id, f.seller.token, 'approve', body).expect(
      200,
    );
    expect(replay.body.receipt).toEqual(response.body.receipt);
    expect(await snapshot(f)).toEqual(after);
    await post(
      `/aftersales/items/${f.item.id}/requests`,
      f.buyer.token,
      createBody(),
    ).expect(409);
  });
  it('competing decisions at one revision produce one refund and one audit step', async () => {
    const f = await fixture(),
      a = await opened(f);
    const results = await Promise.all(
      [changeBody(1), changeBody(1)].map((body) =>
        decision(a.id, f.seller.token, 'approve', body),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await db.refundRecord.count({ where: { orderItemId: f.item.id } }),
    ).toBe(1);
    expect(
      await db.aftersaleHistory.count({ where: { requestId: a.id } }),
    ).toBe(2);
  });
  it.each([true, false])(
    'receive restockable=%s refunds once and restores only sellable goods',
    async (restockable) => {
      const f = await fixture(),
        a = await opened(f, createBody('RETURN_AND_REFUND'));
      await decision(a.id, f.seller.token, 'approve', changeBody(1)).expect(
        200,
      );
      expect(
        await db.refundRecord.count({ where: { orderItemId: f.item.id } }),
      ).toBe(0);
      const body = changeBody(2, restockable);
      await decision(a.id, f.seller.token, 'receive', body).expect(200);
      const after = await snapshot(f);
      expect(after.variant!.stock).toBe(restockable ? 7 : 5);
      expect(
        after.stock.filter((m) => m.type === 'RETURN_RESTORE'),
      ).toHaveLength(restockable ? 1 : 0);
      expect(after.outbox).toHaveLength(restockable ? 1 : 0);
      await decision(a.id, f.seller.token, 'receive', body).expect(200);
      expect(await snapshot(f)).toEqual(after);
    },
  );
  it('Admin decides a disputed request, Seller cannot decide that state', async () => {
    const f = await fixture(),
      a = await opened(f);
    await decision(
      a.id,
      f.admin.token,
      'approve',
      changeBody(1),
      'admin',
    ).expect(409);
    await decision(a.id, f.seller.token, 'reject', changeBody(1)).expect(200);
    await post(
      `/aftersales/requests/${a.id}/dispute`,
      f.buyer.token,
      changeBody(2),
    ).expect(200);
    await decision(a.id, f.seller.token, 'approve', changeBody(3)).expect(409);
    await decision(
      a.id,
      f.admin.token,
      'approve',
      changeBody(3),
      'admin',
    ).expect(200);
  });
  it('unknown response reconciles exact receipt and mismatched body/key cannot replay', async () => {
    const f = await fixture(),
      a = await opened(f),
      body = changeBody(1);
    const applied = await decision(
      a.id,
      f.seller.token,
      'approve',
      body,
    ).expect(200);
    const before = await snapshot(f),
      requestHash = commandHash(
        'SELLER',
        'approve',
        a.id,
        commandInput('approve', body),
      );
    const resolved = await post(
      `/seller/aftersales/commands/approve/${a.id}/reconcile`,
      f.seller.token,
      { commandId: body.commandId, requestHash },
    ).expect(200);
    expect(resolved.body.receipt).toEqual(applied.body.receipt);
    expect(await snapshot(f)).toEqual(before);
    await decision(a.id, f.seller.token, 'approve', {
      ...body,
      reason: 'Changed body must never replay',
    }).expect(409);
  });
  it('close-before-create is metadata only; late command cannot create request', async () => {
    const f = await fixture(),
      body = createBody(),
      before = await snapshot(f);
    const requestHash = commandHash(
      'BUYER',
      'create',
      f.item.id,
      commandInput('create', body),
    );
    const path = `/aftersales/commands/create/${f.item.id}/reconcile`;
    const result = await post(path, f.buyer.token, {
      commandId: body.commandId,
      requestHash,
    }).expect(200);
    expect(result.body.outcome).toBe('CLOSED');
    expect(await snapshot(f)).toEqual(before);
    await post(
      `/aftersales/items/${f.item.id}/requests`,
      f.buyer.token,
      body,
    ).expect(409);
    expect(await snapshot(f)).toEqual(before);
  });
  it('create/close concurrently ends in one consistent fence or receipt', async () => {
    const f = await fixture(),
      body = createBody(),
      requestHash = commandHash(
        'BUYER',
        'create',
        f.item.id,
        commandInput('create', body),
      );
    const [write, resolved] = await Promise.all([
      post(`/aftersales/items/${f.item.id}/requests`, f.buyer.token, body),
      post(
        `/aftersales/commands/create/${f.item.id}/reconcile`,
        f.buyer.token,
        { commandId: body.commandId, requestHash },
      ),
    ]);
    expect(resolved.status).toBe(200);
    expect(write.status).toBe(resolved.body.outcome === 'CLOSED' ? 409 : 200);
    expect(
      await db.aftersaleCommand.count({
        where: { actorId: f.buyer.id, commandId: body.commandId },
      }),
    ).toBe(1);
  });
  it('refund before Buyer completion activates adjustment with gross, replay never reactivates', async () => {
    const f = await fixture(),
      a = await opened(f);
    await decision(a.id, f.seller.token, 'approve', changeBody(1)).expect(200);
    const key = randomUUID();
    await http()
      .post(`/orders/${f.order.id}/complete`)
      .auth(f.buyer.token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({})
      .expect(200);
    const after = await snapshot(f);
    expect(after.order!.status).toBe('COMPLETED');
    expect(after.adjustments[0]!.effectiveAt).toEqual(after.order!.completedAt);
    await http()
      .post(`/orders/${f.order.id}/complete`)
      .auth(f.buyer.token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({})
      .expect(200);
    expect(await snapshot(f)).toEqual(after);
  });
  it('system completion activates pre-existing refund adjustment in the same commit', async () => {
    const f = await fixture(),
      a = await opened(f);
    await decision(a.id, f.seller.token, 'approve', changeBody(1)).expect(200);
    const token = randomUUID();
    const job = await db.orderCompletionJob.create({
      data: {
        orderId: f.order.id,
        deliveredAt: f.order.deliveredAt!,
        dueAt: new Date(f.order.deliveredAt!.getTime() + 1000),
        status: 'RUNNING',
        attemptCount: 1,
        leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + 60000),
      },
    });
    await app.get(OrderCompletionService).completeJob(job.id, token);
    const after = await snapshot(f);
    expect(after.order!.status).toBe('COMPLETED');
    expect(after.adjustments[0]!.effectiveAt).toEqual(after.order!.completedAt);
    expect(
      (await db.orderCompletionJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe('SUCCEEDED');
  });
  it('completion/refund concurrency cannot strand adjustment or duplicate it', async () => {
    const f = await fixture(),
      a = await opened(f);
    const [refund, complete] = await Promise.all([
      decision(a.id, f.seller.token, 'approve', changeBody(1)),
      http()
        .post(`/orders/${f.order.id}/complete`)
        .auth(f.buyer.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({}),
    ]);
    expect(refund.status).toBe(200);
    expect(complete.status).toBe(200);
    const after = await snapshot(f);
    expect(after.adjustments).toHaveLength(1);
    expect(after.adjustments[0]!.effectiveAt).not.toBeNull();
    expect(after.adjustments[0]!.effectiveAt!.getTime()).toBe(
      Math.max(
        after.refunds[0]!.succeededAt.getTime(),
        after.order!.completedAt!.getTime(),
      ),
    );
  });
  it('rollback on outbox failure leaves no refund, adjustment, restock, new audit or command', async () => {
    const f = await fixture(),
      a = await opened(f, createBody('RETURN_AND_REFUND'));
    await decision(a.id, f.seller.token, 'approve', changeBody(1)).expect(200);
    const before = await snapshot(f),
      body = changeBody(2, true);
    const spy = vi
      .spyOn(app.get(SearchOutboxService), 'writeOutboxEvent')
      .mockRejectedValueOnce(new Error('injected-outbox-failure'));
    try {
      await decision(a.id, f.seller.token, 'receive', body).expect(503);
    } finally {
      spy.mockRestore();
    }
    expect(await snapshot(f)).toEqual(before);
    expect(
      await db.aftersaleCommand.count({
        where: { actorId: f.seller.id, commandId: body.commandId },
      }),
    ).toBe(0);
  });
  it('invalid snapshot fails before request/reservation; stale credential cannot decide', async () => {
    const f = await fixture();
    await db.order.update({
      where: { id: f.order.id },
      data: { discountTotal: '1.00', total: '119999.00' },
    });
    await post(
      `/aftersales/items/${f.item.id}/requests`,
      f.buyer.token,
      createBody(),
    ).expect(422);
    expect(
      await db.aftersaleRequest.count({ where: { orderItemId: f.item.id } }),
    ).toBe(0);
    await db.order.update({
      where: { id: f.order.id },
      data: { discountTotal: '0.00', total: '120000.00' },
    });
    const a = await opened(f);
    await db.user.update({
      where: { id: f.seller.id },
      data: { credentialVersion: { increment: 1 } },
    });
    await decision(a.id, f.seller.token, 'approve', changeBody(1)).expect(401);
    expect(
      await db.refundRecord.count({ where: { orderItemId: f.item.id } }),
    ).toBe(0);
  });
  it('paid completed refund is effective immediately; commands/refunds/audits cannot be edited', async () => {
    const f = await fixture(true),
      a = await opened(f);
    await decision(a.id, f.seller.token, 'approve', changeBody(1)).expect(200);
    const result = await snapshot(f),
      refund = result.refunds[0]!;
    expect(result.adjustments[0]!.effectiveAt).toEqual(refund.succeededAt);
    await expect(
      db.refundRecord.update({
        where: { id: refund.id },
        data: { mode: 'SIMULATED' },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.aftersaleHistory.update({
        where: { id: result.history[0]!.id },
        data: { reason: 'Changed audit must be rejected' },
      }),
    ).rejects.toBeDefined();
    const command = await db.aftersaleCommand.findFirstOrThrow({
      where: { actorId: f.buyer.id, commandId: a.body.commandId },
    });
    await expect(
      db.aftersaleCommand.update({
        where: { id: command.id },
        data: { outcome: 'CLOSED' },
      }),
    ).rejects.toBeDefined();
    expect(await snapshot(f)).toEqual(result);
  });
  it('another Store cannot decide and Seller acting as Buyer can request on own purchase', async () => {
    const f = await fixture(),
      a = await opened(f),
      foreign = await actor('SELLER');
    await decision(a.id, foreign.token, 'approve', changeBody(1)).expect(404);
    await db.user.update({
      where: { id: f.buyer.id },
      data: { role: 'SELLER' },
    });
    const fresh = await auth.login({ email: f.buyer.email, password });
    const previous = process.env.ACCOUNT_BUYER_ACCESS_ENABLED;
    process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'false';
    try {
      await post(
        `/aftersales/requests/${a.id}/cancel`,
        fresh.accessToken,
        changeBody(1),
      ).expect(403);
      process.env.ACCOUNT_BUYER_ACCESS_ENABLED = 'true';
      await post(
        `/aftersales/requests/${a.id}/cancel`,
        fresh.accessToken,
        changeBody(1),
      ).expect(200);
      await post(
        `/aftersales/items/${f.item.id}/requests`,
        fresh.accessToken,
        createBody(),
      ).expect(200);
    } finally {
      if (previous === undefined)
        delete process.env.ACCOUNT_BUYER_ACCESS_ENABLED;
      else process.env.ACCOUNT_BUYER_ACCESS_ENABLED = previous;
    }
  });
  it('canonical actor is rechecked when old session waits behind User lock', async () => {
    const f = await fixture(),
      a = await opened(f),
      body = changeBody(1);
    let held!: () => void, release!: () => void;
    const acquired = new Promise<void>((resolve) => {
      held = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id=${f.seller.id} FOR UPDATE`;
        held();
        await released;
        await tx.user.update({
          where: { id: f.seller.id },
          data: { credentialVersion: { increment: 1 } },
        });
      },
      { timeout: 8000 },
    );
    await acquired;
    const pending = app
      .get(AftersalesService)
      .execute(
        {
          userId: f.seller.id,
          email: f.seller.email,
          role: f.seller.role,
          credentialVersion: f.seller.credentialVersion,
        },
        'SELLER',
        'approve',
        a.id,
        body,
      )
      .then(
        (value) => ({ value }),
        (cause) => ({ cause }),
      );
    try {
      let waiting = false;
      for (let i = 0; i < 30 && !waiting; i++) {
        const rows = await db.$queryRaw<
          { n: number }[]
        >`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM users WHERE id=%'`;
        waiting = rows[0]!.n > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
    }
    await holding;
    expect(await pending).toMatchObject({ cause: { status: 401 } });
    expect(
      await db.refundRecord.count({ where: { orderItemId: f.item.id } }),
    ).toBe(0);
  });
  it('two UUIDs cannot claim the same history; valid-shaped future audit receipt fails closed', async () => {
    const f = await fixture(),
      a = await opened(f);
    const original = await db.aftersaleCommand.findUniqueOrThrow({
      where: {
        actorId_commandId: { actorId: f.buyer.id, commandId: a.body.commandId },
      },
    });
    await expect(
      db.aftersaleCommand.create({
        data: {
          actorId: f.buyer.id,
          commandId: randomUUID(),
          action: 'create',
          targetId: f.item.id,
          requestHash: original.requestHash,
          outcome: 'APPLIED',
          receipt: original.receipt!,
        },
      }),
    ).rejects.toBeDefined();
    // Corruption probe: orphan future audit is not a real cancellation.
    const body = changeBody(1),
      requestHash = commandHash(
        'BUYER',
        'cancel',
        a.id,
        commandInput('cancel', body),
      );
    const history = await db.aftersaleHistory.create({
      data: {
        requestId: a.id,
        actorId: f.buyer.id,
        fromState: 'PENDING',
        toState: 'CANCELLED',
        fromRevision: 1,
        toRevision: 2,
        reason: body.reason,
      },
    });
    await db.aftersaleCommand.create({
      data: {
        actorId: f.buyer.id,
        commandId: body.commandId,
        action: 'cancel',
        targetId: a.id,
        requestHash,
        outcome: 'APPLIED',
        receipt: {
          request: {
            id: a.id,
            orderItemId: f.item.id,
            kind: 'REFUND_ONLY',
            state: 'CANCELLED',
            revision: 2,
          },
          historyId: history.id.toString(),
          refund: null,
        },
      },
    });
    const before = await snapshot(f);
    await post(`/aftersales/commands/cancel/${a.id}/reconcile`, f.buyer.token, {
      commandId: body.commandId,
      requestHash,
    }).expect(503);
    expect(await snapshot(f)).toEqual(before);
  });
  it('expired delivery window never creates a request or consumes a command', async () => {
    const f = await fixture(),
      body = createBody();
    await db.order.update({
      where: { id: f.order.id },
      data: { deliveredAt: new Date(Date.now() - 8 * 86400000) },
    });
    const before = await snapshot(f);
    await post(
      `/aftersales/items/${f.item.id}/requests`,
      f.buyer.token,
      body,
    ).expect(409);
    expect(await snapshot(f)).toEqual(before);
    expect(
      await db.aftersaleCommand.count({
        where: { actorId: f.buyer.id, commandId: body.commandId },
      }),
    ).toBe(0);
  });
  it('a valid-shaped receipt cannot label a cancelled effect as Seller approval', async () => {
    const f = await fixture(),
      a = await opened(f),
      body = changeBody(1);
    await db.aftersaleRequest.update({
      where: { id: a.id },
      data: { state: 'CANCELLED', revision: 2 },
    });
    const history = await db.aftersaleHistory.create({
      data: {
        requestId: a.id,
        actorId: f.seller.id,
        fromState: 'PENDING',
        toState: 'CANCELLED',
        fromRevision: 1,
        toRevision: 2,
        reason: body.reason,
      },
    });
    const requestHash = commandHash(
      'SELLER',
      'approve',
      a.id,
      commandInput('approve', body),
    );
    await db.aftersaleCommand.create({
      data: {
        actorId: f.seller.id,
        commandId: body.commandId,
        action: 'approve',
        targetId: a.id,
        requestHash,
        outcome: 'APPLIED',
        receipt: {
          request: {
            id: a.id,
            orderItemId: f.item.id,
            kind: 'REFUND_ONLY',
            state: 'CANCELLED',
            revision: 2,
          },
          historyId: history.id.toString(),
          refund: null,
        },
      },
    });
    const before = await snapshot(f);
    await post(
      `/seller/aftersales/commands/approve/${a.id}/reconcile`,
      f.seller.token,
      { commandId: body.commandId, requestHash },
    ).expect(503);
    expect(await snapshot(f)).toEqual(before);
  });
  it('stock overflow rolls back receive/refund/audit/adjustment atomically', async () => {
    const f = await fixture(),
      a = await opened(f, createBody('RETURN_AND_REFUND'));
    await decision(a.id, f.seller.token, 'approve', changeBody(1)).expect(200);
    await db.productVariant.update({
      where: { id: f.variant.id },
      data: { stock: 2147483646 },
    });
    const before = await snapshot(f);
    await decision(a.id, f.seller.token, 'receive', changeBody(2, true)).expect(
      409,
    );
    expect(await snapshot(f)).toEqual(before);
  });
  it('closing an undelivered receive never refunds or restocks and blocks late request', async () => {
    const f = await fixture(),
      a = await opened(f, createBody('RETURN_AND_REFUND'));
    await decision(a.id, f.seller.token, 'approve', changeBody(1)).expect(200);
    const body = changeBody(2, true),
      before = await snapshot(f);
    const requestHash = commandHash(
      'SELLER',
      'receive',
      a.id,
      commandInput('receive', body),
    );
    const result = await post(
      `/seller/aftersales/commands/receive/${a.id}/reconcile`,
      f.seller.token,
      { commandId: body.commandId, requestHash },
    ).expect(200);
    expect(result.body.outcome).toBe('CLOSED');
    expect(await snapshot(f)).toEqual(before);
    await decision(a.id, f.seller.token, 'receive', body).expect(409);
    expect(await snapshot(f)).toEqual(before);
  });
  it('audit pagination uses exclusive revisions, reads no private Order snapshot and mutates nothing', async () => {
    const f = await fixture(),
      a = await opened(f);
    await decision(a.id, f.seller.token, 'reject', changeBody(1)).expect(200);
    await post(
      `/aftersales/requests/${a.id}/dispute`,
      f.buyer.token,
      changeBody(2),
    ).expect(200);
    await decision(
      a.id,
      f.admin.token,
      'reject',
      changeBody(3),
      'admin',
    ).expect(200);
    const before = await snapshot(f);
    const first = await http()
      .get(`/admin/aftersales/requests/${a.id}?limit=2`)
      .auth(f.admin.token, { type: 'bearer' })
      .expect(200);
    expect(
      first.body.history.map((h: { toRevision: number }) => h.toRevision),
    ).toEqual([4, 3]);
    expect(first.body.nextBeforeRevision).toBe(3);
    const second = await http()
      .get(`/admin/aftersales/requests/${a.id}?limit=2&beforeRevision=3`)
      .auth(f.admin.token, { type: 'bearer' })
      .expect(200);
    expect(
      second.body.history.map((h: { toRevision: number }) => h.toRevision),
    ).toEqual([2, 1]);
    expect(second.body.nextBeforeRevision).toBeNull();
    expect(JSON.stringify(first.body)).not.toMatch(
      /addressLineSnapshot|phoneSnapshot|credentialVersion|requestHash/,
    );
    expect(await snapshot(f)).toEqual(before);
  });
});
