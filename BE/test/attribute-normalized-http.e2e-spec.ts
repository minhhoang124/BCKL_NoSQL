import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import type { App } from './http-test-types.js';
import { assertAttributeReadQaTarget } from './helpers/attribute-read-qa-target.js';

describe('Existing Attribute HTTP writes with normalized DB uniqueness', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let categoryId: number;
  let adminId: number;
  let token: string;
  let firstId: number;
  let secondId: number;
  const marker = `attribute-normalized-${Date.now()}`;
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
    const actor = await prisma.user.create({
      data: {
        email: `${marker}@example.com`,
        passwordHash: await hash('QA-fixture-only-password', 4),
        role: 'ADMIN',
      },
    });
    adminId = actor.id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: actor.email, password: 'QA-fixture-only-password' })
      .expect(200);
    token = login.body.accessToken;
    categoryId = (
      await prisma.category.create({ data: { name: marker, slug: marker } })
    ).id;
    firstId = (
      await prisma.categoryAttributeDefinition.create({
        data: {
          categoryId,
          name: 'Kết nối',
          slug: 'connectivity',
          dataType: 'TEXT',
          isActive: false,
        },
      })
    ).id;
    secondId = (
      await prisma.categoryAttributeDefinition.create({
        data: { categoryId, name: 'Màu sắc', slug: 'color', dataType: 'TEXT' },
      })
    ).id;
  });
  afterAll(async () => {
    if (prisma) {
      if (categoryId)
        await prisma.category.delete({ where: { id: categoryId } });
      if (adminId) {
        await prisma.refreshToken.deleteMany({ where: { userId: adminId } });
        await prisma.user.delete({ where: { id: adminId } });
      }
    }
    await app?.close();
  });
  async function snapshot() {
    return {
      definitions: await prisma.categoryAttributeDefinition.findMany({
        where: { categoryId },
        orderBy: { id: 'asc' },
      }),
      audits: await prisma.categoryAttributeAudit.count({
        where: { categoryId },
      }),
      jobs: await prisma.searchReconciliationJob.count({
        where: { scope: 'CATEGORY', scopeId: categoryId },
      }),
    };
  }
  it('returns 409 for an inactive-name alias with a different slug, not raw DB failure/500', async () => {
    const before = await snapshot();
    const result = await request(app.getHttpServer())
      .post(base())
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '  KẾT   NỐI  ', slug: 'different-slug', dataType: 'TEXT' })
      .expect(409);
    expect(result.body.code).toBe('ATTRIBUTE_NAME_CONFLICT');
    expect(await snapshot()).toEqual(before);
  });
  it('rejects a conflicting PATCH atomically before any durable Search job can escape', async () => {
    const before = await snapshot();
    const result = await request(app.getHttpServer())
      .patch(`${base()}/${secondId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedRevision: 1, name: 'Kết nối' })
      .expect(409);
    expect(result.body.code).toBe('ATTRIBUTE_NAME_CONFLICT');
    expect(await snapshot()).toEqual(before);
  });
  it('retains existing slug uniqueness with an explicit safe 409 code', async () => {
    const result = await request(app.getHttpServer())
      .post(base())
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Other meaning', slug: 'connectivity', dataType: 'TEXT' })
      .expect(409);
    expect(result.body.code).toBe('SLUG_CONFLICT');
    expect(
      await prisma.categoryAttributeDefinition.count({ where: { categoryId } }),
    ).toBe(2);
    expect(
      (
        await prisma.categoryAttributeDefinition.findUniqueOrThrow({
          where: { id: firstId },
        })
      ).revision,
    ).toBe(1);
  });
});
