import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from './http-test-types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Auth and RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const marker = `e2e-${Date.now()}`;
  const userEmail = `${marker}-user@example.com`;
  const sellerEmail = `${marker}-seller@example.com`;
  const password = 'StrongPass123!';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma)
      await prisma.user.deleteMany({
        where: { email: { in: [userEmail, sellerEmail] } },
      });
    if (app) await app.close();
  });

  it('rejects public ADMIN registration', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `${marker}-admin@example.com`,
        password,
        accountType: 'ADMIN',
      })
      .expect(400);
  });

  it('registers a USER, returns no password hash and sets refresh cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: userEmail, password, fullName: 'E2E User' })
      .expect(201);

    expect(response.body.user).toMatchObject({
      email: userEmail,
      role: 'USER',
    });
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('rejects duplicate email and incorrect password', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: userEmail, password })
      .expect(409);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail, password: 'WrongPass123!' })
      .expect(401);
  });

  it('authorizes /me, denies USER seller access and rotates refresh token', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/auth/login')
      .send({ email: userEmail, password })
      .expect(200);
    const accessToken = login.body.accessToken as string;

    await agent
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ email: userEmail, role: 'USER' });
      });
    await agent
      .get('/seller/test')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    const refreshed = await agent.post('/auth/refresh').expect(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    await agent.post('/auth/logout').expect(204);
    await agent.post('/auth/refresh').expect(401);
  });

  it('allows SELLER to access seller route', async () => {
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: sellerEmail, password, accountType: 'SELLER' })
      .expect(201);
    await request(app.getHttpServer())
      .get('/seller/test')
      .set('Authorization', `Bearer ${register.body.accessToken as string}`)
      .expect(200);
  });
});
