import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import type { Role } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { PrismaService } from '../../src/prisma.service.js';
import { assertOrderResolutionQaTarget } from './order-resolution-qa-target.js';

// Explicit QA config only: never collected by default BE/FE suites. Fixtures
// stay on the dedicated database; immutable receipts/audits are not deleted.
describe('Buyer client live host — real Nest HTTP + PostgreSQL', () => {
  let app: INestApplication, p: PrismaService;
  const marker = `buyer_live_${randomUUID()}`;
  let sequence = 0;
  const key = () => `${marker}_${sequence++}`;
  type Actor = { id: number; token: string };
  const fixtures: Record<
    string,
    {
      orderId: number;
      productId: number;
      buyer: Actor;
      before: Awaited<ReturnType<typeof snapshot>>;
    }
  > = {};
  let seller: Actor, admin: Actor, other: Actor;
  async function actor(role: Role): Promise<Actor> {
    const u = await p.user.create({
      data: {
        email: `${marker}_${sequence++}@example.test`,
        role,
        passwordHash: 'qa-fixture-not-a-login',
      },
    });
    const config = app.get(ConfigService);
    return {
      id: u.id,
      token: app.get(JwtService).sign(
        { sub: u.id, role, email: u.email, type: 'access' },
        {
          secret: config.getOrThrow('JWT_ACCESS_SECRET'),
          issuer: config.get('JWT_ISSUER', 'klcn-ecommerce-api'),
          audience: config.get('JWT_AUDIENCE', 'klcn-ecommerce-web'),
          expiresIn: '10m',
        },
      ),
    };
  }
  const post = (url: string, who: Actor, body: object = {}) =>
    request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${who.token}`)
      .set('Idempotency-Key', key())
      .send(body);
  async function snapshot(orderId: number, productId: number) {
    const order = await p.order.findUniqueOrThrow({ where: { id: orderId } });
    const product = await p.product.findUniqueOrThrow({
      where: { id: productId },
    });
    const payment = await p.payment.findUniqueOrThrow({ where: { orderId } });
    return {
      status: order.status,
      paymentStatus: payment.status,
      amount: payment.amount.toFixed(2),
      stock: (
        await p.productVariant.findMany({
          where: { productId },
          orderBy: { id: 'asc' },
        })
      ).map((v) => v.stock),
      version: product.version,
      history: await p.orderStatusHistory.count({ where: { orderId } }),
      outbox: await p.searchOutbox.count({ where: { productId } }),
      restores: await p.stockMovement.count({
        where: { type: 'CANCELLATION_RESTORE', orderItem: { orderId } },
      }),
      commands: await p.orderCommand.count({
        where: { orderId, actorType: 'BUYER' },
      }),
      fences: await p.orderCommandResolution.count({
        where: { orderId, actorType: 'BUYER' },
      }),
    };
  }
  beforeAll(async () => {
    assertOrderResolutionQaTarget(process.env.DATABASE_URL);
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    p = app.get(PrismaService);
    seller = await actor('SELLER');
    admin = await actor('ADMIN');
    other = await actor('USER');
    const store = await p.store.create({
      data: { sellerId: seller.id, name: marker, status: 'ACTIVE' },
    });
    const category = await p.category.create({
      data: { name: marker, slug: key() },
    });
    for (const name of [
      'cancel_lost_execute',
      'complete_lost_execute',
      'cancel_lost_resolve',
      'complete_closed',
      'cancel_session_switch',
      'cancel_get_fail',
      'cancel_timeout',
      'cancel_doubleclick',
      'cancel_runtime_success',
      'complete_runtime_success',
      'cancel_runtime_lost',
      'cancel_runtime_double',
      'cancel_runtime_getfail',
      'cancel_runtime_switch',
      'cancel_runtime_timeout',
    ]) {
      const buyer = await actor('USER');
      const product = await p.product.create({
        data: {
          storeId: store.id,
          categoryId: category.id,
          name: marker,
          sellerStatus: 'ACTIVE',
          moderationStatus: 'APPROVED',
          images: {
            create: { url: '/uploads/buyer-live-qa.jpg', isPrimary: true },
          },
          shippingProfile: { create: { packageWeightGrams: 100 } },
        },
      });
      const variants = [];
      for (let i = 0; i < 2; i++)
        variants.push(
          await p.productVariant.create({
            data: {
              storeId: store.id,
              productId: product.id,
              skuCode: key(),
              optionSignature: `qa-${i}`,
              price: '10000',
              stock: 2,
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
          addressLine: 'QA isolated fixture',
        },
      });
      const cart = await p.cart.create({ data: { userId: buyer.id } });
      for (const v of variants)
        await p.cartItem.create({
          data: { cartId: cart.id, variantId: v.id, quantity: 2 },
        });
      const checkout = await post('/checkouts', buyer, {
        addressId: address.id,
        paymentProvider: 'COD',
        items: variants.map((v) => ({
          variantId: v.id,
          quantity: 2,
          expectedUnitPrice: '10000',
        })),
      }).expect(201);
      const orderId = checkout.body.orders[0].id as number;
      if (
        ['complete_lost_execute', 'complete_runtime_success'].includes(name)
      ) {
        for (const command of ['confirm', 'start-packing', 'ready-to-ship'])
          await post(`/seller/orders/${orderId}/${command}`, seller).expect(
            200,
          );
        await post(`/admin/orders/${orderId}/ship`, admin, {
          trackingReference: 'QA-LIVE-TRACK',
        }).expect(200);
        await post(`/admin/orders/${orderId}/mark-delivered`, admin, {
          trackingReference: 'QA-LIVE-TRACK',
          deliveryAttempt: 1,
        }).expect(200);
      }
      fixtures[name] = {
        orderId,
        productId: product.id,
        buyer,
        before: await snapshot(orderId, product.id),
      };
    }
  });
  afterAll(async () => {
    await app?.close();
  });
  it('runs the real FE journal/coordinator/adapter in a separate process then checks business invariants', async () => {
    const frontend = path.resolve(process.cwd(), '../FE');
    const child = spawn(
      process.execPath,
      [
        path.join(frontend, 'node_modules/vitest/vitest.mjs'),
        'run',
        '--config',
        'vitest.buyer-live.config.ts',
        '--maxWorkers=1',
      ],
      {
        cwd: frontend,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          BCKL_BUYER_LIVE_QA: JSON.stringify({
            origin: await app.getUrl(),
            fixtures,
            other,
          }),
        },
      },
    );
    let output = '';
    child.stdout.on('data', (bytes) => {
      output += String(bytes);
    });
    child.stderr.on('data', (bytes) => {
      output += String(bytes);
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      const deadline = setTimeout(() => {
        child.kill();
        reject(new Error('FE live QA process deadline exceeded'));
      }, 75000);
      child.once('error', (e) => {
        clearTimeout(deadline);
        reject(e);
      });
      child.once('exit', (n) => {
        clearTimeout(deadline);
        resolve(n);
      });
    });
    const secrets = [
      process.env.DATABASE_URL,
      ...Object.values(fixtures).map((f) => f.buyer.token),
      seller.token,
      admin.token,
      other.token,
    ];
    for (const value of secrets)
      if (value) output = output.split(value).join('[QA_SECRET]');
    console.log(output);
    expect(code, 'FE live QA subprocess exit').toBe(0);
    expect(output, 'all fifteen real-HTTP FE scenarios ran').toMatch(
      /Tests\s+15 passed/,
    );
    for (const [name, f] of Object.entries(fixtures)) {
      const after = await snapshot(f.orderId, f.productId);
      if (
        [
          'cancel_lost_execute',
          'cancel_get_fail',
          'cancel_runtime_success',
          'cancel_runtime_lost',
          'cancel_runtime_double',
          'cancel_runtime_getfail',
          'cancel_runtime_switch',
          'cancel_runtime_timeout',
        ].includes(name)
      ) {
        expect(after, name).toEqual({
          ...f.before,
          status: 'CANCELLED',
          paymentStatus: 'CANCELLED',
          stock: [2, 2],
          version: f.before.version + 1,
          history: f.before.history + 1,
          outbox: f.before.outbox + 1,
          restores: 2,
          commands: 1,
        });
      } else if (
        ['complete_lost_execute', 'complete_runtime_success'].includes(name)
      ) {
        expect(after, name).toEqual({
          ...f.before,
          status: 'COMPLETED',
          history: f.before.history + 1,
          commands: 1,
        });
      } else expect(after, name).toEqual({ ...f.before, fences: 1 });
    }
  });
});
