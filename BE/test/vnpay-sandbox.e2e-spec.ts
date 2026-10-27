import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { createHmac, randomUUID, randomInt } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { vnpayDate } from '../src/payment/vnpay-input.js';
import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';
describe('VNPay sandbox — real Checkout/HTTP/PostgreSQL; signed synthetic provider only', () => {
  let app: INestApplication, other: INestApplication, db: PrismaService;
  const old = { ...process.env },
    secret = 'SyntheticVnpayChecksumKeyAtLeast32Characters',
    http = (a = app) => request(a.getHttpServer());
  async function runtime() {
    const a = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication({ logger: false });
    configureApp(a);
    await a.init();
    return a;
  }
  beforeAll(async () => {
    assertRuntimeQaTarget(process.env.DATABASE_URL, process.env.GITHUB_ACTIONS);
    Object.assign(process.env, {
      VNPAY_SANDBOX_ENABLED: 'true',
      VNPAY_TMN_CODE: 'TEST0001',
      VNPAY_HASH_SECRET: secret,
      VNPAY_WEB_ORIGIN: 'http://localhost:5197',
      VNPAY_API_ORIGIN: 'http://localhost:3397',
    });
    app = await runtime();
    other = await runtime();
    db = app.get(PrismaService);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await other?.close();
    await app?.close();
    process.env = old;
  });
  async function actor(role: 'USER' | 'SELLER' = 'USER') {
    const u = await db.user.create({
        data: {
          email: 'vnpay-' + randomUUID() + '@example.invalid',
          passwordHash: 'NOT_A_LOGIN_FIXTURE',
          role,
          emailVerifiedAt: new Date(),
        },
      }),
      c = app.get(ConfigService),
      token = app.get(JwtService).sign(
        {
          sub: u.id,
          email: u.email,
          role,
          credentialVersion: 1,
          type: 'access',
        },
        {
          secret: c.getOrThrow('JWT_ACCESS_SECRET'),
          issuer: c.get('JWT_ISSUER', 'klcn-ecommerce-api'),
          audience: c.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
          expiresIn: '10m',
        },
      );
    return { ...u, token };
  }
  async function fixture() {
    const buyer = await actor(),
      seller = await actor('SELLER'),
      store = await db.store.create({
        data: {
          sellerId: seller.id,
          name: 'VNPay synthetic QA Store',
          status: 'ACTIVE',
        },
      }),
      category = await db.category.create({
        data: {
          name: 'VNPay QA ' + randomUUID(),
          slug: 'vnpay-qa-' + randomUUID(),
        },
      }),
      product = await db.product.create({
        data: {
          storeId: store.id,
          categoryId: category.id,
          name: 'VNPay QA product',
          sellerStatus: 'ACTIVE',
          moderationStatus: 'APPROVED',
          images: { create: { url: '/uploads/vnpay-qa.jpg', isPrimary: true } },
          shippingProfile: { create: { packageWeightGrams: 100 } },
        },
      }),
      variant = await db.productVariant.create({
        data: {
          productId: product.id,
          storeId: store.id,
          skuCode: 'QA-' + randomUUID(),
          price: '10000.00',
          stock: 5,
          optionSignature: 'fixture',
        },
      }),
      address = await db.userAddress.create({
        data: {
          userId: buyer.id,
          recipientName: 'Synthetic QA Buyer',
          phone: '0900000001',
          province: 'QA',
          ward: 'QA',
          addressLine: 'Synthetic QA address',
          isDefault: true,
        },
      }),
      cart = await db.cart.create({ data: { userId: buyer.id } });
    await db.cartItem.create({
      data: { cartId: cart.id, variantId: variant.id, quantity: 1 },
    });
    const body = {
        addressId: address.id,
        paymentProvider: 'VNPAY',
        items: [
          { variantId: variant.id, quantity: 1, expectedUnitPrice: '10000.00' },
        ],
      },
      key = randomUUID(),
      r = await http()
        .post('/checkouts')
        .auth(buyer.token, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
    return {
      buyer,
      seller,
      orderId: r.body.orders[0].id as number,
      variantId: variant.id,
      checkoutId: r.body.checkoutId as number,
      body,
      key,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const start = (f: Fixture, a = app) =>
    http(a)
      .post(`/payments/vnpay/orders/${f.orderId}/start`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send({ confirmed: true });
  const read = (f: Fixture, token = f.buyer.token) =>
    http()
      .get(`/payments/vnpay/orders/${f.orderId}`)
      .auth(token, { type: 'bearer' });
  const cancel = (f: Fixture) =>
    http()
      .post(`/orders/${f.orderId}/cancel`)
      .auth(f.buyer.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({
        reasonCode: 'CHANGED_MIND',
        reasonText: 'Synthetic cancellation',
      });
  async function fields(f: Fixture, patch: Record<string, string> = {}) {
    const row = await db.paymentTransaction.findFirstOrThrow({
      where: { payment: { orderId: f.orderId } },
    });
    return {
      vnp_Amount: '1000000',
      vnp_TxnRef: row.reference,
      vnp_TmnCode: 'TEST0001',
      vnp_TransactionNo: String(randomInt(100000000, 999999999)),
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_PayDate: vnpayDate(new Date()),
      vnp_OrderInfo: 'BCKL sandbox ' + row.reference,
      vnp_BankCode: 'NCB',
      vnp_CardType: 'ATM',
      ...patch,
    };
  }
  function signed(q: Record<string, string>) {
    const p = new URLSearchParams(Object.entries(q));
    p.sort();
    p.set(
      'vnp_SecureHash',
      createHmac('sha512', secret).update(p.toString()).digest('hex'),
    );
    return p.toString();
  }
  const ipn = (q: Record<string, string>, a = app) =>
    http(a).get('/payments/vnpay/ipn?' + signed(q));
  it('selected runtime has no superuser/role creation and app role has no CREATEDB', async () => {
    if (process.env.GITHUB_ACTIONS === 'true') return;
    const [r] = await db.$queryRaw<
      { rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean }[]
    >`SELECT rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user`;
    expect(r?.rolsuper).toBe(false);
    expect(r?.rolcreaterole).toBe(false);
    if (new URL(process.env.DATABASE_URL!).username === 'bckl_qa_app_20261021')
      expect(r?.rolcreatedb).toBe(false);
  });
  it('creates online checkout v2 while reserving stock once and keeps receipt immutable after payment', async () => {
    const f = await fixture(),
      row = await db.checkout.findUniqueOrThrow({
        where: { id: f.checkoutId },
      });
    expect(row.hashVersion).toBe(2);
    expect(row.receiptVersion).toBe(2);
    expect(
      (
        await db.productVariant.findUniqueOrThrow({
          where: { id: f.variantId },
        })
      ).stock,
    ).toBe(4);
    await start(f).expect(200);
    expect((await ipn(await fields(f)).expect(200)).body.RspCode).toBe('00');
    const replay = await http()
      .get('/checkouts/by-key')
      .auth(f.buyer.token, { type: 'bearer' })
      .set('Idempotency-Key', f.key)
      .expect(200);
    expect(replay.body.orders[0].payment).toMatchObject({
      provider: 'VNPAY',
      status: 'UNPAID',
    });
    expect(
      (await db.checkout.findUniqueOrThrow({ where: { id: f.checkoutId } }))
        .receiptJson,
    ).toEqual(row.receiptJson);
  });
  it('two starts across applications return one reference and one persisted attempt', async () => {
    const f = await fixture(),
      [a, b] = await Promise.all([start(f), start(f, other)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.transaction.reference).toBe(b.body.transaction.reference);
    expect(
      await db.paymentTransaction.count({
        where: { payment: { orderId: f.orderId } },
      }),
    ).toBe(1);
    const u = new URL(a.body.transaction.paymentUrl);
    expect(u.origin).toBe('https://sandbox.vnpayment.vn');
    expect(u.searchParams.get('vnp_Amount')).toBe('1000000');
  });
  it('read and reload never create a payment attempt', async () => {
    const f = await fixture();
    expect((await read(f).expect(200)).body.transaction).toBeNull();
    expect(
      await db.paymentTransaction.count({
        where: { payment: { orderId: f.orderId } },
      }),
    ).toBe(0);
  });
  it('duplicate/concurrent IPN settles money once and never changes Order or stock', async () => {
    const f = await fixture();
    await start(f);
    const q = await fields(f),
      before = await db.order.findUniqueOrThrow({ where: { id: f.orderId } }),
      r = await Promise.all([ipn(q), ipn(q, other)]);
    expect(r.map((x) => x.body.RspCode).sort()).toEqual(['00', '02']);
    expect(
      await db.paymentNotification.count({
        where: { transaction: { payment: { orderId: f.orderId } } },
      }),
    ).toBe(1);
    expect(
      (await db.payment.findUniqueOrThrow({ where: { orderId: f.orderId } }))
        .status,
    ).toBe('PAID');
    expect(
      await db.order.findUniqueOrThrow({ where: { id: f.orderId } }),
    ).toEqual(before);
    expect(
      (
        await db.productVariant.findUniqueOrThrow({
          where: { id: f.variantId },
        })
      ).stock,
    ).toBe(4);
  });
  it('return redirect is read-only and cannot mark a pending payment PAID', async () => {
    const f = await fixture();
    await start(f);
    const q = await fields(f),
      before = await db.payment.findUniqueOrThrow({
        where: { orderId: f.orderId },
      });
    await http()
      .get('/payments/vnpay/return?' + signed(q))
      .expect(303)
      .expect(
        'Location',
        `http://localhost:5197/account/orders/${f.orderId}?paymentReturn=received`,
      )
      .expect('Cache-Control', 'no-store');
    expect(
      await db.payment.findUniqueOrThrow({ where: { orderId: f.orderId } }),
    ).toEqual(before);
    expect(
      await db.paymentNotification.count({
        where: { transaction: { payment: { orderId: f.orderId } } },
      }),
    ).toBe(0);
  });
  it('invalid signature, merchant, amount and duplicate query never mutate financial state', async () => {
    const f = await fixture();
    await start(f);
    const q = await fields(f);
    expect(
      (
        await http().get(
          '/payments/vnpay/ipn?' + signed(q) + '&vnp_Amount=1000000',
        )
      ).body.RspCode,
    ).toBe('97');
    expect(
      (
        await http().get(
          '/payments/vnpay/ipn?' +
            signed(q).replace(/vnp_SecureHash=./, 'vnp_SecureHash=z'),
        )
      ).body.RspCode,
    ).toBe('97');
    expect((await ipn({ ...q, vnp_TmnCode: 'OTHER001' })).body.RspCode).toBe(
      '97',
    );
    expect((await ipn({ ...q, vnp_Amount: '1000100' })).body.RspCode).toBe(
      '04',
    );
    expect(
      (await db.payment.findUniqueOrThrow({ where: { orderId: f.orderId } }))
        .status,
    ).toBe('PENDING');
    expect(
      await db.paymentNotification.count({
        where: { transaction: { payment: { orderId: f.orderId } } },
      }),
    ).toBe(0);
  });
  it('a 00 response with non-00 transaction status requires review and cannot fulfill', async () => {
    const f = await fixture();
    await start(f);
    expect(
      (await ipn(await fields(f, { vnp_TransactionStatus: '07' }))).body
        .RspCode,
    ).toBe('00');
    expect(
      (await db.payment.findUniqueOrThrow({ where: { orderId: f.orderId } }))
        .status,
    ).toBe('REVIEW_REQUIRED');
    await cancel(f).expect(409);
  });
  it.each(['24', '51'])(
    'provider failure %s keeps Order open until explicit cancellation restores stock once',
    async (code) => {
      const f = await fixture();
      await start(f);
      await ipn(
        await fields(f, {
          vnp_ResponseCode: code,
          vnp_TransactionStatus: '02',
          vnp_TransactionNo: '0',
        }),
      );
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: f.orderId } })).status,
      ).toBe('PENDING_CONFIRMATION');
      expect(
        (
          await db.productVariant.findUniqueOrThrow({
            where: { id: f.variantId },
          })
        ).stock,
      ).toBe(4);
      await cancel(f).expect(200);
      expect(
        (
          await db.productVariant.findUniqueOrThrow({
            where: { id: f.variantId },
          })
        ).stock,
      ).toBe(5);
      await cancel(f).expect(409);
    },
  );
  it('cancel first then valid success flags review without resurrecting Order or reducing stock', async () => {
    const f = await fixture();
    await start(f);
    const q = await fields(f);
    await cancel(f).expect(200);
    await ipn(q).expect(200);
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: f.orderId } })).status,
    ).toBe('CANCELLED');
    expect(
      (await db.payment.findUniqueOrThrow({ where: { orderId: f.orderId } }))
        .status,
    ).toBe('REVIEW_REQUIRED');
    expect((await read(f).expect(200)).body.transaction.paymentUrl).toBeNull();
    expect(
      (
        await db.productVariant.findUniqueOrThrow({
          where: { id: f.variantId },
        })
      ).stock,
    ).toBe(5);
  });
  it('valid success first blocks cancellation and a conflicting later callback blocks future fulfillment', async () => {
    const f = await fixture();
    await start(f);
    const q = await fields(f);
    await ipn(q);
    await cancel(f).expect(409);
    await ipn({ ...q, vnp_ResponseCode: '07', vnp_TransactionStatus: '07' });
    const p = await db.payment.findUniqueOrThrow({
      where: { orderId: f.orderId },
    });
    expect(p.status).toBe('REVIEW_REQUIRED');
    expect(p.paidAt).not.toBeNull();
  });
  it('same provider transaction number cannot pay two Orders', async () => {
    const a = await fixture(),
      b = await fixture();
    await start(a);
    await start(b);
    const qa = await fields(a),
      qb = await fields(b, { vnp_TransactionNo: qa.vnp_TransactionNo });
    await ipn(qa);
    await ipn(qb);
    expect(
      (await db.payment.findUniqueOrThrow({ where: { orderId: b.orderId } }))
        .status,
    ).toBe('REVIEW_REQUIRED');
  });
  it('stop-new rollout preserves v2 checkout replay, current own reads and valid IPN', async () => {
    const f = await fixture();
    await start(f);
    const q = await fields(f);
    process.env.VNPAY_SANDBOX_ENABLED = 'false';
    try {
      await start(f).expect(503);
      await read(f).expect(200);
      const replay = await http()
        .post('/checkouts')
        .auth(f.buyer.token, { type: 'bearer' })
        .set('Idempotency-Key', f.key)
        .send(f.body)
        .expect(200);
      expect(replay.body.replayed).toBe(true);
      expect((await ipn(q)).body.RspCode).toBe('00');
    } finally {
      process.env.VNPAY_SANDBOX_ENABLED = 'true';
    }
  });
  it('ownership/CV/disabled actor and body/query guards prevent new starts', async () => {
    const f = await fixture(),
      outsider = await actor();
    await read(f, outsider.token).expect(404);
    await http()
      .get(`/payments/vnpay/orders/${f.orderId}`)
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await http()
      .post(`/payments/vnpay/orders/${f.orderId}/start?amount=1`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send({ confirmed: true })
      .expect(400);
    await http()
      .post(`/payments/vnpay/orders/${f.orderId}/start`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send({ confirmed: true, amount: 1 })
      .expect(400);
    await db.user.update({
      where: { id: f.buyer.id },
      data: { credentialVersion: 2 },
    });
    await start(f).expect(401);
    expect(
      await db.paymentTransaction.count({
        where: { payment: { orderId: f.orderId } },
      }),
    ).toBe(0);
  });
  it('SQL protects attempt identity, terminal reopening and append-only notifications', async () => {
    const f = await fixture();
    await start(f);
    const row = await db.paymentTransaction.findFirstOrThrow({
      where: { payment: { orderId: f.orderId } },
    });
    await expect(
      db.$executeRaw`UPDATE payment_transactions SET amount=1 WHERE id=${row.id}::uuid`,
    ).rejects.toThrow();
    await ipn(await fields(f));
    await expect(
      db.$executeRaw`UPDATE payment_transactions SET status='PENDING' WHERE id=${row.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`DELETE FROM payment_notifications WHERE "transactionId"=${row.id}::uuid`,
    ).rejects.toThrow();
  });
  it('cancel/IPN racing across applications ends either paid+reserved or cancelled+review+restored', async () => {
    const f = await fixture();
    await start(f);
    const q = await fields(f);
    const [c, p] = await Promise.all([cancel(f), ipn(q, other)]);
    expect([200, 409]).toContain(c.status);
    expect(p.body.RspCode).toBe('00');
    const order = await db.order.findUniqueOrThrow({
        where: { id: f.orderId },
        include: { payment: true },
      }),
      stock = (
        await db.productVariant.findUniqueOrThrow({
          where: { id: f.variantId },
        })
      ).stock;
    expect(
      order.status === 'CANCELLED'
        ? [order.payment!.status, stock]
        : [order.payment!.status, stock],
    ).toEqual(
      order.status === 'CANCELLED' ? ['REVIEW_REQUIRED', 5] : ['PAID', 4],
    );
  });
  it('expired session stays the same identity and late payment outside its window needs review', async () => {
    const f = await fixture(),
      p = await db.payment.findUniqueOrThrow({ where: { orderId: f.orderId } }),
      now = (
        await db.$queryRaw<
          { now: Date }[]
        >`SELECT clock_timestamp()::timestamp(3) now`
      )[0]!.now;
    await db.$transaction(async (tx) => {
      await tx.paymentTransaction.create({
        data: {
          id: randomUUID(),
          paymentId: p.id,
          reference: randomUUID().replaceAll('-', ''),
          tmnCode: 'TEST0001',
          amount: p.amount,
          createdAt: new Date(now.getTime() - 1200000),
          expiresAt: new Date(now.getTime() - 300000),
          ipAddress: '127.0.0.1',
          returnUrl: 'http://localhost:3397/payments/vnpay/return',
        },
      });
      await tx.payment.update({
        where: { id: p.id },
        data: { status: 'PENDING' },
      });
    });
    const r = await read(f).expect(200);
    expect(r.body.transaction.expired).toBe(true);
    expect(r.body.transaction.paymentUrl).toBeNull();
    const repeated = await start(f).expect(200);
    expect(repeated.body.transaction.reference).toBe(
      r.body.transaction.reference,
    );
    expect(repeated.body.transaction.paymentUrl).toBeNull();
    await ipn(await fields(f));
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status,
    ).toBe('REVIEW_REQUIRED');
  });
  it('late-but-timely payment survives callback delay and succeeds while Order remains open', async () => {
    const f = await fixture(),
      p = await db.payment.findUniqueOrThrow({ where: { orderId: f.orderId } }),
      now = (
        await db.$queryRaw<
          { now: Date }[]
        >`SELECT clock_timestamp()::timestamp(3) now`
      )[0]!.now;
    await db.$transaction(async (tx) => {
      await tx.paymentTransaction.create({
        data: {
          id: randomUUID(),
          paymentId: p.id,
          reference: randomUUID().replaceAll('-', ''),
          tmnCode: 'TEST0001',
          amount: p.amount,
          createdAt: new Date(now.getTime() - 1200000),
          expiresAt: new Date(now.getTime() - 300000),
          ipAddress: '127.0.0.1',
          returnUrl: 'http://localhost:3397/payments/vnpay/return',
        },
      });
      await tx.payment.update({
        where: { id: p.id },
        data: { status: 'PENDING' },
      });
    });
    await ipn(
      await fields(f, {
        vnp_PayDate: vnpayDate(new Date(now.getTime() - 600000)),
      }),
    );
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status,
    ).toBe('PAID');
  });
  it('DB failure rolls back notification and paid state together, allowing provider retry', async () => {
    const f = await fixture();
    await start(f);
    const q = await fields(f),
      original = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation(((
      callback: unknown,
      options: unknown,
    ) =>
      original(async (tx: Prisma.TransactionClient) => {
        const proxy = new Proxy(tx, {
          get(t, k) {
            if (k === 'payment')
              return new Proxy(t.payment, {
                get(d, p) {
                  if (p === 'update')
                    return async (args: { data: { status?: string } }) => {
                      if (args.data.status === 'PAID')
                        throw Error('Controlled payment failure');
                      return (d.update as Function)(args);
                    };
                  const v = Reflect.get(d, p);
                  return typeof v === 'function' ? v.bind(d) : v;
                },
              });
            const v = Reflect.get(t, k);
            return typeof v === 'function' ? v.bind(t) : v;
          },
        });
        return (callback as (t: Prisma.TransactionClient) => unknown)(proxy);
      }, options as never)) as never);
    expect((await ipn(q)).body.RspCode).toBe('99');
    expect(
      (await db.payment.findUniqueOrThrow({ where: { orderId: f.orderId } }))
        .status,
    ).toBe('PENDING');
    expect(
      await db.paymentNotification.count({
        where: { transaction: { payment: { orderId: f.orderId } } },
      }),
    ).toBe(0);
    vi.restoreAllMocks();
    expect((await ipn(q)).body.RspCode).toBe('00');
  });
});
