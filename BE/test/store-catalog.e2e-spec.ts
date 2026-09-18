import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Store and catalog (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userToken: string;
  let sellerToken: string;
  let secondSellerToken: string;
  let resubmitSellerToken: string;
  let adminToken: string;
  let sellerStoreId: number;

  const marker = `store-catalog-${Date.now()}`;
  const password = 'StrongPass123!';
  const emails = {
    user: `${marker}-user@example.com`,
    seller: `${marker}-seller@example.com`,
    secondSeller: `${marker}-seller-2@example.com`,
    resubmitSeller: `${marker}-seller-resubmit@example.com`,
    admin: `${marker}-admin@example.com`,
  };
  const rootSlug = `${marker}-electronics`;
  const childSlug = `${marker}-audio`;
  const brandSlug = `${marker}-brand`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    userToken = await registerAndGetToken(emails.user, 'USER');
    sellerToken = await registerAndGetToken(emails.seller, 'SELLER');
    secondSellerToken = await registerAndGetToken(
      emails.secondSeller,
      'SELLER',
    );
    resubmitSellerToken = await registerAndGetToken(
      emails.resubmitSeller,
      'SELLER',
    );

    await prisma.user.create({
      data: {
        email: emails.admin,
        passwordHash: await hash(password, 12),
        role: Role.ADMIN,
      },
    });
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emails.admin, password })
      .expect(200);
    adminToken = adminLogin.body.accessToken as string;
  });

  afterAll(async () => {
    if (prisma) {
      const categories = await prisma.category.findMany({
        where: { slug: { in: [rootSlug, childSlug] } },
        select: { id: true, parentId: true },
      });
      const categoryIds = categories.map(({ id }) => id);
      if (categoryIds.length) {
        await prisma.categoryAttributeDefinition.deleteMany({
          where: { categoryId: { in: categoryIds } },
        });
        await prisma.category.deleteMany({
          where: {
            id: {
              in: categories
                .filter(({ parentId }) => parentId)
                .map(({ id }) => id),
            },
          },
        });
        await prisma.category.deleteMany({
          where: {
            id: {
              in: categories
                .filter(({ parentId }) => !parentId)
                .map(({ id }) => id),
            },
          },
        });
      }
      await prisma.brand.deleteMany({ where: { slug: brandSlug } });
      await prisma.store.deleteMany({
        where: { seller: { email: { in: Object.values(emails) } } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: Object.values(emails) } },
      });
    }
    if (app) await app.close();
  });

  async function registerAndGetToken(
    email: string,
    accountType: 'USER' | 'SELLER',
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, accountType })
      .expect(201);
    return response.body.accessToken as string;
  }

  it('enforces authentication, SELLER role and DTO ownership boundaries', async () => {
    await request(app.getHttpServer()).get('/seller/store').expect(401);
    await request(app.getHttpServer())
      .post('/seller/store')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'User Store' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/seller/store')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Seller Store', sellerId: 999_999 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/seller/store')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: '     ' })
      .expect(400);
  });

  it('enforces the reviewed Store lifecycle and keeps its history', async () => {
    const created = await request(app.getHttpServer())
      .post('/seller/store')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: '  Seller Store  ', description: '  Demo store  ' })
      .expect(201);

    expect(created.body).toMatchObject({
      name: 'Seller Store',
      description: 'Demo store',
      status: 'PENDING',
    });
    sellerStoreId = created.body.id as number;

    await request(app.getHttpServer())
      .post('/seller/store')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Duplicate Store' })
      .expect(409);

    await request(app.getHttpServer())
      .get('/seller/store')
      .set('Authorization', `Bearer ${secondSellerToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch('/seller/store')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: null })
      .expect(200)
      .expect(({ body }) => {
        expect(body.description).toBeNull();
      });

    await request(app.getHttpServer())
      .post('/seller/store/resubmit')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/admin/stores/${sellerStoreId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/admin/stores/${sellerStoreId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED', reason: 'Thiếu thông tin liên hệ' })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/seller/store')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: 'Đã bổ sung hồ sơ' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/seller/store/resubmit')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('PENDING'));

    await request(app.getHttpServer())
      .patch(`/admin/stores/${sellerStoreId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE', reason: 'Hồ sơ hợp lệ' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/admin/stores/${sellerStoreId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'SUSPENDED', reason: 'Tạm khóa để kiểm tra' })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/seller/store')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Không được tự sửa khi khóa' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/admin/stores/${sellerStoreId}/status`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ status: 'ACTIVE', reason: 'Seller tự mở khóa' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/admin/stores/${sellerStoreId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE', reason: 'Admin khôi phục' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/seller/store')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ACTIVE');
        expect(body.statusHistory).toHaveLength(6);
        expect(body.statusHistory[1]).toMatchObject({
          fromStatus: 'PENDING',
          toStatus: 'REJECTED',
          reason: 'Thiếu thông tin liên hệ',
        });
      });
  });

  it('uses conditional writes when Store status requests race', async () => {
    const reviewRaceStore = await request(app.getHttpServer())
      .post('/seller/store')
      .set('Authorization', `Bearer ${secondSellerToken}`)
      .send({ name: 'Concurrent review Store' })
      .expect(201);

    const reviewResponses = await Promise.all([
      request(app.getHttpServer())
        .patch(`/admin/stores/${reviewRaceStore.body.id as number}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE', reason: 'Concurrent approval' }),
      request(app.getHttpServer())
        .patch(`/admin/stores/${reviewRaceStore.body.id as number}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'REJECTED', reason: 'Concurrent rejection' }),
    ]);
    expect(reviewResponses.map(({ status }) => status).sort()).toEqual([
      200, 409,
    ]);

    const reviewHistory = await prisma.storeStatusHistory.findMany({
      where: {
        storeId: reviewRaceStore.body.id as number,
        fromStatus: 'PENDING',
      },
    });
    expect(reviewHistory).toHaveLength(1);

    const resubmitRaceStore = await request(app.getHttpServer())
      .post('/seller/store')
      .set('Authorization', `Bearer ${resubmitSellerToken}`)
      .send({ name: 'Concurrent resubmit Store' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/admin/stores/${resubmitRaceStore.body.id as number}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED', reason: 'Needs correction' })
      .expect(200);

    const resubmitResponses = await Promise.all([
      request(app.getHttpServer())
        .post('/seller/store/resubmit')
        .set('Authorization', `Bearer ${resubmitSellerToken}`),
      request(app.getHttpServer())
        .post('/seller/store/resubmit')
        .set('Authorization', `Bearer ${resubmitSellerToken}`),
    ]);
    expect(resubmitResponses.map(({ status }) => status).sort()).toEqual([
      200, 409,
    ]);

    const resubmitHistory = await prisma.storeStatusHistory.count({
      where: {
        storeId: resubmitRaceStore.body.id as number,
        fromStatus: 'REJECTED',
        toStatus: 'PENDING',
      },
    });
    expect(resubmitHistory).toBe(1);
  });

  it('restricts catalog writes to ADMIN and exposes active public catalog data', async () => {
    await request(app.getHttpServer())
      .post('/admin/categories')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Electronics', slug: rootSlug })
      .expect(403);

    const root = await request(app.getHttpServer())
      .post('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Electronics', slug: rootSlug })
      .expect(201);

    const child = await request(app.getHttpServer())
      .post('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Audio', slug: childSlug, parentId: root.body.id })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/admin/categories/${root.body.id as number}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    await request(app.getHttpServer())
      .get('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: child.body.id, isActive: true }),
          ]),
        );
      });

    await request(app.getHttpServer())
      .post('/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Duplicate Audio', slug: childSlug })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/admin/categories/${root.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ parentId: child.body.id })
      .expect(400);

    const definition = await prisma.categoryAttributeDefinition.create({
      data: {
        categoryId: child.body.id as number,
        name: 'Color',
        slug: `${marker}-color`,
        dataType: 'SINGLE_SELECT',
        options: {
          create: { value: 'Black', slug: `${marker}-black` },
        },
      },
    });

    await request(app.getHttpServer())
      .get('/categories')
      .expect(200)
      .expect(({ body }) => {
        const rootNode = (
          body as Array<{ slug: string; children: unknown[] }>
        ).find(({ slug }) => slug === rootSlug);
        expect(rootNode?.children).toHaveLength(1);
      });

    await request(app.getHttpServer())
      .get(`/categories/${child.body.id as number}/attributes`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.attributeDefinitions[0]).toMatchObject({
          id: definition.id,
          slug: `${marker}-color`,
          options: [{ value: 'Black', slug: `${marker}-black`, sortOrder: 0 }],
        });
      });

    // Legacy/inconsistent rows must not expose a child through the public
    // attributes endpoint when an ancestor is inactive.
    await prisma.category.update({
      where: { id: root.body.id as number },
      data: { isActive: false },
    });
    await request(app.getHttpServer())
      .get(`/categories/${child.body.id as number}/attributes`)
      .expect(404);
    await prisma.category.update({
      where: { id: root.body.id as number },
      data: { isActive: true },
    });

    const brand = await request(app.getHttpServer())
      .post('/admin/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test Brand', slug: brandSlug })
      .expect(201);

    await request(app.getHttpServer())
      .get('/brands')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: brand.body.id, slug: brandSlug }),
          ]),
        );
      });

    await request(app.getHttpServer())
      .delete(`/admin/brands/${brand.body.id as number}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/admin/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: brand.body.id, isActive: false }),
          ]),
        );
      });

    await request(app.getHttpServer())
      .get('/brands')
      .expect(200)
      .expect(({ body }) => {
        expect(body).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ slug: brandSlug }),
          ]),
        );
      });

    const product = await prisma.product.create({
      data: {
        storeId: sellerStoreId,
        categoryId: child.body.id as number,
        name: 'Category deactivation guard product',
      },
    });

    await request(app.getHttpServer())
      .delete(`/admin/categories/${child.body.id as number}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    await prisma.product.delete({ where: { id: product.id } });

    await request(app.getHttpServer())
      .delete(`/admin/categories/${child.body.id as number}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/admin/categories/${root.body.id as number}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});
