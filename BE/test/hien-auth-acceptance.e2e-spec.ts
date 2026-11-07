import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from './http-test-types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Hiền U01/U02 Auth acceptance (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const email = `hien-auth-${Date.now()}@example.com`;
  const password = 'StrongPass123!';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) await prisma.user.deleteMany({ where: { email } });
    if (app) await app.close();
  });

  it('U01: accepts valid credentials and denies wrong password or inactive account', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const valid = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    expect(valid.body.accessToken).toEqual(expect.any(String));
    expect(valid.body.user).not.toHaveProperty('passwordHash');

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'WrongPass123!' })
      .expect(401);

    await prisma.user.update({ where: { email }, data: { isActive: false } });
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${valid.body.accessToken as string}`)
      .expect(401);
  });

  it('U02: refuses public ADMIN role and denies USER access to Admin API', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `admin-${email}`, password, accountType: 'ADMIN' })
      .expect(400);

    await prisma.user.update({ where: { email }, data: { isActive: true } });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    await request(app.getHttpServer())
      .get('/admin/categories')
      .set('Authorization', `Bearer ${login.body.accessToken as string}`)
      .expect(403);
  });
});
