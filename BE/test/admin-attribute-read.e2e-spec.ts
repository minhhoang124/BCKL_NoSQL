import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import request from 'supertest';
import type { App } from './http-test-types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { assertAttributeReadQaTarget } from './helpers/attribute-read-qa-target.js';

describe('Admin attribute reads on PostgreSQL', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminToken: string;
  let buyerToken: string;
  let categoryId: number;
  let definitionId: number;
  let secondId: number;
  let optionId: number;
  let storeId: number;
  const marker = `attribute-read-${Date.now()}`;
  const password = 'StrongPass123!';
  const emails = [`${marker}-admin@example.com`, `${marker}-buyer@example.com`];
  const base = () => `/admin/categories/${categoryId}/attributes`;

  beforeAll(async () => {
    assertAttributeReadQaTarget(process.env.DATABASE_URL);
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    for (const [index, role] of [Role.ADMIN, Role.USER].entries()) {
      await prisma.user.create({
        data: {
          email: emails[index],
          passwordHash: await hash(password, 4),
          role,
        },
      });
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: emails[index], password })
        .expect(200);
      if (index === 0) adminToken = login.body.accessToken;
      else buyerToken = login.body.accessToken;
    }
    const category = await prisma.category.create({
      data: { name: marker, slug: marker, isActive: false },
    });
    categoryId = category.id;
    const first = await prisma.categoryAttributeDefinition.create({
      data: {
        categoryId,
        name: 'Connection',
        slug: 'connection',
        dataType: 'SINGLE_SELECT',
        isActive: false,
      },
    });
    definitionId = first.id;
    const second = await prisma.categoryAttributeDefinition.create({
      data: { categoryId, name: 'Weight', slug: 'weight', dataType: 'NUMBER' },
    });
    secondId = second.id;
    const option = await prisma.categoryAttributeOption.create({
      data: {
        attributeDefinitionId: definitionId,
        value: 'USB',
        slug: 'usb',
        isActive: false,
      },
    });
    optionId = option.id;
    const seller = await prisma.user.create({
      data: {
        email: `${marker}-seller@example.com`,
        passwordHash: await hash(password, 4),
        role: Role.SELLER,
      },
    });
    const store = await prisma.store.create({
      data: { sellerId: seller.id, name: marker },
    });
    storeId = store.id;
    for (let i = 0; i < 2; i++) {
      const product = await prisma.product.create({
        data: { storeId, categoryId, name: `${marker}-${i}` },
      });
      await prisma.productAttributeValue.create({
        data: {
          productId: product.id,
          attributeDefinitionId: definitionId,
          optionId,
        },
      });
    }
  });

  afterAll(async () => {
    if (prisma) {
      if (storeId) {
        await prisma.product.deleteMany({ where: { storeId } });
        await prisma.store.delete({ where: { id: storeId } });
      }
      if (categoryId)
        await prisma.category.delete({ where: { id: categoryId } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      await prisma.user.deleteMany({
        where: { email: `${marker}-seller@example.com` },
      });
    }
    if (app) await app.close();
  });

  it('enforces guest and Buyer boundaries', async () => {
    await request(app.getHttpServer())
      .get(base())
      .expect('Cache-Control', 'no-store')
      .expect(401);
    await request(app.getHttpServer())
      .get(base())
      .auth(buyerToken, { type: 'bearer' })
      .expect(403);
  });

  it.each([
    ['get', 'lowercase'],
    ['head', 'lowercase'],
    ['get', 'uppercase'],
    ['head', 'uppercase'],
    ['get', 'mixed'],
    ['head', 'mixed'],
  ] as const)(
    'sets no-store on %s %s route successes and guard/validation errors',
    async (method, casing) => {
      const paths = [
        base(),
        `${base()}/${definitionId}`,
        `${base()}/${definitionId}/options`,
      ];
      const variant = (path: string) =>
        casing === 'uppercase'
          ? path.toUpperCase()
          : casing === 'mixed'
            ? path
                .replace('/admin/', '/AdMiN/')
                .replace('/attributes', '/AtTrIbUtEs')
            : path;
      for (const path of paths.map(variant)) {
        await request(app.getHttpServer())
          [method](path)
          .expect('Cache-Control', 'no-store')
          .expect(401);
        await request(app.getHttpServer())
          [method](path)
          .auth(buyerToken, { type: 'bearer' })
          .expect('Cache-Control', 'no-store')
          .expect(403);
        await request(app.getHttpServer())
          [method](path)
          .auth(adminToken, { type: 'bearer' })
          .expect('Cache-Control', 'no-store')
          .expect(200);
        await request(app.getHttpServer())
          [method](`${path}?unknown=1`)
          .auth(adminToken, { type: 'bearer' })
          .expect('Cache-Control', 'no-store')
          .expect(400);
      }
      await request(app.getHttpServer())
        [method](
          variant(`/admin/categories/2147483647/attributes/${definitionId}`),
        )
        .auth(adminToken, { type: 'bearer' })
        .expect('Cache-Control', 'no-store')
        .expect(404);
    },
  );

  it('reads inactive definitions/category and paginates without hidden filtering', async () => {
    const first = await request(app.getHttpServer())
      .get(`${base()}?limit=1`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.items).toHaveLength(1);
    expect(first.body.items[0]).toMatchObject({
      id: definitionId,
      isActive: false,
      revision: 2,
      usage: { referencedProductCount: 2 },
    });
    expect(first.body.nextCursor).toBe(definitionId);
    const second = await request(app.getHttpServer())
      .get(`${base()}?afterId=${definitionId}&limit=1`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(second.body.items[0].id).toBe(secondId);
    expect(second.body.nextCursor).toBeNull();
    const inactive = await request(app.getHttpServer())
      .get(`${base()}?isActive=false`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(inactive.body.items.map((row: { id: number }) => row.id)).toEqual([
      definitionId,
    ]);
  });

  it('reads full inactive option metadata with the parent revision', async () => {
    const result = await request(app.getHttpServer())
      .get(`${base()}/${definitionId}/options`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    expect(result.body).toEqual({
      definitionRevision: 2,
      nextCursor: null,
      items: [
        {
          id: optionId,
          attributeDefinitionId: definitionId,
          value: 'USB',
          slug: 'usb',
          sortOrder: 0,
          isActive: false,
          referencedProductCount: 2,
        },
      ],
    });
  });

  it('rejects wrong nesting and malformed or repeated query keys', async () => {
    await request(app.getHttpServer())
      .get(`/admin/categories/2147483647/attributes/${definitionId}`)
      .auth(adminToken, { type: 'bearer' })
      .expect(404);
    for (const query of [
      'limit=1&limit=2',
      'isActive=1',
      'limit=101',
      'actorId=1',
      'afterId=1.5',
    ]) {
      await request(app.getHttpServer())
        .get(`${base()}?${query}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(400);
    }
  });

  it('does not mutate configuration revision, audit or search jobs on repeated reads', async () => {
    const before = await prisma.categoryAttributeDefinition.findUniqueOrThrow({
      where: { id: definitionId },
    });
    const jobs = await prisma.searchReconciliationJob.count();
    const audits = await prisma.categoryAttributeAudit.count();
    for (let i = 0; i < 2; i++)
      await request(app.getHttpServer())
        .get(`${base()}/${definitionId}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(200);
    expect(
      await prisma.categoryAttributeDefinition.findUniqueOrThrow({
        where: { id: definitionId },
      }),
    ).toEqual(before);
    expect(await prisma.searchReconciliationJob.count()).toBe(jobs);
    expect(await prisma.categoryAttributeAudit.count()).toBe(audits);
  });

  it('rejects a previously issued token once the Admin is disabled', async () => {
    await prisma.user.update({
      where: { email: emails[0] },
      data: { isActive: false },
    });
    try {
      await request(app.getHttpServer())
        .get(base())
        .auth(adminToken, { type: 'bearer' })
        .expect(401);
    } finally {
      await prisma.user.update({
        where: { email: emails[0] },
        data: { isActive: true },
      });
    }
  });
});
