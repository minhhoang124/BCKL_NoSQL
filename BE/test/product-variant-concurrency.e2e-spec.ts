import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Concurrent variant creation — real HTTP/PostgreSQL', () => {
  let app: INestApplication,
    db: PrismaService,
    token: string,
    storeId: number,
    categoryId: number;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    const password = 'QA-' + randomUUID() + '!';
    const seller = await db.user.create({
      data: {
        email: 'variant-race-' + randomUUID() + '@example.test',
        passwordHash: await hash(password, 4),
        role: 'SELLER',
      },
    });
    storeId = (
      await db.store.create({
        data: {
          sellerId: seller.id,
          name: 'QA variant race',
          status: 'ACTIVE',
        },
      })
    ).id;
    categoryId = (
      await db.category.create({
        data: { name: 'QA variant race', slug: randomUUID() },
      })
    ).id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: seller.email, password })
      .expect(200);
    token = login.body.accessToken as string;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('cannot add a new option axis after the first SKU or invalidate its existing combination', async () => {
    const product = await db.product.create({
      data: { storeId, categoryId, name: 'QA fixed axes' },
    });
    await request(app.getHttpServer())
      .post(`/seller/products/${product.id}/variants`)
      .set('Authorization', 'Bearer ' + token)
      .send({ price: '25000', stock: 7, optionValueIds: [] })
      .expect(201);
    const before = await db.product.findUniqueOrThrow({
      where: { id: product.id },
      include: { variants: true, optionGroups: true },
    });
    await request(app.getHttpServer())
      .post(`/seller/products/${product.id}/option-groups`)
      .set('Authorization', 'Bearer ' + token)
      .send({ name: 'Late axis' })
      .expect(409);
    expect(
      await db.product.findUniqueOrThrow({
        where: { id: product.id },
        include: { variants: true, optionGroups: true },
      }),
    ).toEqual(before);
  });

  it.each(['combination', 'store-sku'] as const)(
    'returns201/409 for the same %s after both prechecks pass; loser cannot change stock/price',
    async (kind) => {
      const first = await db.product.create({
        data: { storeId, categoryId, name: 'QA first' },
      });
      const second =
        kind === 'combination'
          ? first
          : await db.product.create({
              data: { storeId, categoryId, name: 'QA second' },
            });
      const sku = kind === 'store-sku' ? randomUUID() : null;
      const bodies = [
        { price: '25000', stock: 7, sellerSku: sku, optionValueIds: [] },
        { price: '31000', stock: 9, sellerSku: sku, optionValueIds: [] },
      ];
      const lock = new Client({ connectionString: process.env.DATABASE_URL });
      await lock.connect();
      await lock.query('BEGIN');
      // Block FK KEY SHARE at INSERT so BOTH HTTP requests have finished their
      // normal duplicate prechecks before either can insert. No business mocks.
      await lock.query(
        'SELECT id FROM products WHERE id=ANY($1::int[]) FOR UPDATE',
        [[first.id, second.id]],
      );
      const calls = [first, second].map((p, i) =>
        request(app.getHttpServer())
          .post(`/seller/products/${p.id}/variants`)
          .set('Authorization', 'Bearer ' + token)
          .send(bodies[i]),
      );
      const pending = Promise.all(calls);
      let blocked = 0;
      try {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const [row] = await db.$queryRaw<
            { n: number }[]
          >`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND wait_event_type='Lock' AND query ILIKE '%product_variants%' AND pid<>pg_backend_pid()`;
          blocked = row.n;
          if (blocked >= 2) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      } finally {
        await lock.query('ROLLBACK');
        await lock.end();
      }
      const responses = await pending;
      expect(blocked).toBeGreaterThanOrEqual(2);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      const rows = await db.productVariant.findMany({
        where: { productId: { in: [first.id, second.id] } },
      });
      expect(rows).toHaveLength(1);
      const winner = responses.findIndex((r) => r.status === 201);
      expect(rows[0].price.toString()).toBe(bodies[winner].price);
      expect(rows[0].stock).toBe(bodies[winner].stock);
      const loser = responses.find((r) => r.status === 409)!;
      expect(JSON.stringify(loser.body)).not.toMatch(
        /P2002|prisma|constraint|password|postgresql/i,
      );
    },
  );
});
