import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hash } from 'bcryptjs';
import { createHmac, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { AuthSessionRate } from '../src/auth/auth-session-rate.js';
import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';

describe('Auth session security HTTP/PostgreSQL regression', () => {
  let app: INestApplication,
    other: INestApplication,
    db: PrismaService,
    rate: AuthSessionRate;
  const origin = 'http://localhost:5173',
    password = 'Synthetic-auth-hardening-only-2026';
  const old = { ...process.env };
  const email = () => `auth-hardening-${randomUUID()}@example.invalid`;
  const actor = async () =>
    db.user.create({
      data: { email: email(), passwordHash: await hash(password, 4) },
    });
  const post = (url: string, body: unknown, instance = app) =>
    request(instance.getHttpServer())
      .post(url)
      .set('Origin', origin)
      .send(body as object);
  beforeAll(async () => {
    assertRuntimeQaTarget(process.env.DATABASE_URL, process.env.GITHUB_ACTIONS);
    Object.assign(process.env, {
      FRONTEND_URL: origin,
      AUTH_LOGIN_IP_PER_MINUTE: '10000',
      AUTH_REGISTER_IP_PER_MINUTE: '10000',
      AUTH_SESSION_IP_PER_MINUTE: '10000',
      AUTH_LOGIN_ACCOUNT_PER_MINUTE: '10',
    });
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    other = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApp(app);
    configureApp(other);
    await app.init();
    await other.init();
    db = app.get(PrismaService);
    rate = app.get(AuthSessionRate);
  });
  afterAll(async () => {
    await app?.close();
    await other?.close();
    for (const key of Object.keys(process.env))
      if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old);
  });
  // CI currently provisions a disposable postgres superuser service. It cannot
  // prove least privilege; this assertion is exercised with app-role locally.
  it.skipIf(process.env.GITHUB_ACTIONS === 'true')(
    'runtime database identity is isolated and has no superuser/CREATEDB/CREATEROLE',
    async () => {
      const [row] = await db.$queryRaw<
        { rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }[]
      >`SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
      expect(row).toEqual({
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
      });
    },
  );
  it.each([
    'https://attacker.invalid',
    'null',
    'http://localhost:5173.attacker.invalid',
    'http://localhost:5199',
  ])(
    'rejects foreign Origin %s before credential/session writes',
    async (bad) => {
      const who = await actor(),
        before = await db.refreshToken.count({ where: { userId: who.id } });
      const r = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', bad)
        .send({ email: who.email, password });
      expect(r.status).toBe(403);
      expect(r.headers['set-cookie']).toBeUndefined();
      expect(await db.refreshToken.count({ where: { userId: who.id } })).toBe(
        before,
      );
    },
  );
  it.each(['/auth/register', '/auth/login', '/auth/refresh', '/auth/logout'])(
    'rejects foreign form POST to %s',
    async (url) => {
      const r = await request(app.getHttpServer())
        .post(url)
        .set('Origin', 'https://attacker.invalid')
        .type('form')
        .send({ email: email(), password });
      expect(r.status).toBe(403);
      expect(r.headers['set-cookie']).toBeUndefined();
      expect(r.headers['cache-control']).toBe('no-store');
    },
  );
  it('rejects urlencoded credentials even without browser Origin', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .type('form')
      .send({ email: email(), password })
      .expect(400);
  });
  it('rejects browser metadata without Origin', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ email: email(), password })
      .expect(403);
  });
  it('allows explicit trusted Origin even if deployment is cross-site', async () => {
    const who = await actor();
    const r = await post('/auth/login', { email: who.email, password })
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(200);
    expect(r.headers['set-cookie'][0]).toContain('HttpOnly');
  });
  it('retains JSON native/server API login without browser headers', async () => {
    const who = await actor();
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: who.email, password })
      .expect(200);
  });
  it('rejects query, compressed credentials, malformed JSON and oversized bodies', async () => {
    await post('/auth/login?x=1', { email: email(), password }).expect(400);
    await post('/auth/login', { email: email(), password })
      .set('Content-Encoding', 'gzip')
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    await post('/auth/login', {
      email: email(),
      password: 'x'.repeat(9000),
    }).expect(413);
  });
  it('rejects Unicode truncation at registration and login, without creating a user', async () => {
    const id = email(),
      p = 'á'.repeat(40) + 'A1!';
    await post('/auth/register', { email: id, password: p }).expect(400);
    expect(await db.user.count({ where: { email: id } })).toBe(0);
    // A legacy >72-byte hash is not silently reinterpreted as a new password.
    const legacy = await db.user.create({
      data: { email: email(), passwordHash: await hash(p, 4) },
    });
    await post('/auth/login', {
      email: legacy.email,
      password: 'á'.repeat(40) + 'B2!',
    }).expect(400);
  });
  it('accepts exactly72 UTF8 bytes and rejects a changed password within the boundary', async () => {
    const id = email(),
      p = 'á'.repeat(36);
    await post('/auth/register', { email: id, password: p }).expect(201);
    await post('/auth/login', { email: id, password: p }).expect(200);
    await post('/auth/login', {
      email: id,
      password: 'á'.repeat(35) + 'à',
    }).expect(401);
  });
  it('rejects NUL at both credential endpoints', async () => {
    for (const url of ['/auth/register', '/auth/login'])
      await post(url, { email: email(), password: '12345678\0' }).expect(400);
  });
  it('foreign logout/refresh cannot revoke or rotate an existing session', async () => {
    const who = await actor(),
      login = await post('/auth/login', { email: who.email, password }).expect(
        200,
      );
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    for (const url of ['/auth/logout', '/auth/refresh']) {
      const r = await request(app.getHttpServer())
        .post(url)
        .set('Origin', 'https://attacker.invalid')
        .set('Cookie', cookie)
        .expect(403);
      expect(r.headers['set-cookie']).toBeUndefined();
    }
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .expect(401);
  });
  it('shares account quota across two app instances and normalizes email', async () => {
    process.env.AUTH_LOGIN_ACCOUNT_PER_MINUTE = '3';
    try {
      const who = await actor();
      for (let i = 0; i < 3; i++)
        await post(
          '/auth/login',
          { email: who.email.toUpperCase(), password: 'Incorrect123!' },
          i % 2 ? other : app,
        ).expect(401);
      const r = await post(
        '/auth/login',
        { email: who.email, password },
        other,
      ).expect(429);
      expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60);
      expect(r.headers['set-cookie']).toBeUndefined();
      expect(await db.refreshToken.count({ where: { userId: who.id } })).toBe(
        0,
      );
    } finally {
      process.env.AUTH_LOGIN_ACCOUNT_PER_MINUTE = '10';
    }
  });
  it('uses the default ten account attempts when no limit override is provided', async () => {
    delete process.env.AUTH_LOGIN_ACCOUNT_PER_MINUTE;
    try {
      const who = await actor();
      for (let i = 0; i < 10; i++)
        await post(
          '/auth/login',
          { email: who.email, password: 'Incorrect123!' },
          i % 2 ? other : app,
        ).expect(401);
      await post('/auth/login', { email: who.email, password }).expect(429);
    } finally {
      process.env.AUTH_LOGIN_ACCOUNT_PER_MINUTE = '10';
    }
  });
  it('unknown accounts consume the same normalized account quota', async () => {
    process.env.AUTH_LOGIN_ACCOUNT_PER_MINUTE = '2';
    try {
      const id = email();
      for (let i = 0; i < 2; i++)
        await post('/auth/login', { email: id, password }).expect(401);
      await post('/auth/login', { email: id, password }, other).expect(429);
    } finally {
      process.env.AUTH_LOGIN_ACCOUNT_PER_MINUTE = '10';
    }
  });
  it('concurrent per-IP requests cannot exceed quota and forged forwarding does not alter identity', async () => {
    process.env.AUTH_REGISTER_IP_PER_MINUTE = '3';
    try {
      const address = '198.51.100.' + (Math.floor(Math.random() * 150) + 10);
      const settled = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          (i % 2 ? other.get(AuthSessionRate) : rate).consume(
            'register',
            address,
          ),
        ),
      );
      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      for (const r of settled)
        if (r.status === 'rejected') expect(r.reason.getStatus()).toBe(429);
      // Real HTTP identity always uses socket, regardless of forwarding headers.
      process.env.AUTH_LOGIN_ACCOUNT_PER_MINUTE = '1';
      const who = await actor();
      await post('/auth/login', { email: who.email, password: 'Incorrect123!' })
        .set('X-Forwarded-For', '198.51.100.1')
        .expect(401);
      await post('/auth/login', { email: who.email, password })
        .set('X-Forwarded-For', '198.51.100.2')
        .expect(429);
    } finally {
      process.env.AUTH_REGISTER_IP_PER_MINUTE = '10000';
      process.env.AUTH_LOGIN_ACCOUNT_PER_MINUTE = '10';
    }
  });
  it('cannot rotate the HTTP IP quota using forged proxy headers and different accounts', async () => {
    const digest = createHmac('sha256', process.env.JWT_ACCESS_SECRET!)
      .update('auth-abuse:v1:login-ip\0' + '127.0.0.1')
      .digest('hex');
    // Only this isolated QA socket bucket; do not clear other accounts or data.
    await db.$executeRaw`DELETE FROM auth_rate_buckets WHERE scope='login-ip' AND "subjectHash"=${digest}`;
    process.env.AUTH_LOGIN_IP_PER_MINUTE = '2';
    try {
      for (let i = 0; i < 3; i++) {
        const who = await actor();
        const r = await post(
          '/auth/login',
          { email: who.email, password: 'Incorrect123!' },
          i % 2 ? other : app,
        )
          .set('X-Forwarded-For', `198.51.100.${i + 1}`)
          .set('X-Real-IP', `203.0.113.${i + 1}`)
          .set('Forwarded', `for=198.51.100.${i + 1};proto=https`);
        expect(r.status).toBe(i < 2 ? 401 : 429);
        expect(r.headers['set-cookie']).toBeUndefined();
        if (i === 2) expect(r.body.code).toBe('AUTH_RATE_LIMITED');
      }
    } finally {
      process.env.AUTH_LOGIN_IP_PER_MINUTE = '10000';
    }
  });
  it('commits IP quota when account quota denies and normalizes padded account keys', async () => {
    process.env.AUTH_LOGIN_IP_PER_MINUTE = '2';
    process.env.AUTH_LOGIN_ACCOUNT_PER_MINUTE = '1';
    try {
      const address = '2001:db8:' + randomUUID().slice(0, 4) + '::1',
        id = email();
      await rate.consume('login', address, id);
      await expect(
        other
          .get(AuthSessionRate)
          .consume('login', address, ' '.repeat(260) + id),
      ).rejects.toMatchObject({ status: 429 });
      await expect(
        rate.consume('login', address, email()),
      ).rejects.toMatchObject({ status: 429 });
      const digest = createHmac('sha256', process.env.JWT_ACCESS_SECRET!)
        .update('auth-abuse:v1:login-ip\0' + address)
        .digest('hex');
      const [row] = await db.$queryRaw<
        { count: number }[]
      >`SELECT count FROM auth_rate_buckets WHERE scope='login-ip' AND "subjectHash"=${digest}`;
      expect(row.count).toBe(2);
    } finally {
      process.env.AUTH_LOGIN_IP_PER_MINUTE = '10000';
      process.env.AUTH_LOGIN_ACCOUNT_PER_MINUTE = '10';
    }
  });
  it('skips an expired cleanup row locked by another connection', async () => {
    const address = '2001:db8:' + randomUUID().slice(0, 4) + '::2';
    const digest = createHmac('sha256', process.env.JWT_ACCESS_SECRET!)
      .update('auth-abuse:v1:register-ip\0' + address)
      .digest('hex');
    await rate.consume('register', address);
    await db.$executeRaw`UPDATE auth_rate_buckets SET "resetAt"=(clock_timestamp() AT TIME ZONE 'UTC') - interval '2 days' WHERE scope='register-ip' AND "subjectHash"=${digest}`;
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await blocker.connect();
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT 1 FROM auth_rate_buckets WHERE scope=$1 AND "subjectHash"=$2 FOR UPDATE',
        ['register-ip', digest],
      );
      await expect(
        other
          .get(AuthSessionRate)
          .consume('register', '2001:db8:' + randomUUID().slice(0, 4) + '::3'),
      ).resolves.toBeUndefined();
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      await blocker.end();
    }
  });
  it('rejects nonempty body without Content-Type on cookie endpoints', async () => {
    for (const url of ['/auth/refresh', '/auth/logout'])
      await request(app.getHttpServer())
        .post(url)
        .set('Origin', origin)
        .send('{}')
        .unset('Content-Type')
        .expect(400);
  });
  it.each([
    '/AUTH/LOGIN',
    '/auth/login/',
    '/auth/%6cogin',
    '/auth//login',
    '//auth/login',
  ])(
    'cannot bypass the browser boundary through path spelling %s',
    async (url) => {
      const who = await actor();
      const result = await request(app.getHttpServer())
        .post(url)
        .set('Origin', 'https://attacker.invalid')
        .type('form')
        .send({ email: who.email, password });
      expect([403, 404]).toContain(result.status);
      expect(result.headers['set-cookie']).toBeUndefined();
      expect(await db.refreshToken.count({ where: { userId: who.id } })).toBe(
        0,
      );
    },
  );
  it('logout still revokes a valid session when a shared-IP logout bucket is exhausted', async () => {
    const who = await actor(),
      login = await post('/auth/login', { email: who.email, password }).expect(
        200,
      );
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const digest = createHmac('sha256', process.env.JWT_ACCESS_SECRET!)
      .update('auth-abuse:v1:logout-ip\0' + '127.0.0.1')
      .digest('hex');
    await db.$executeRaw`INSERT INTO auth_rate_buckets(scope,"subjectHash",count,"resetAt") VALUES ('logout-ip',${digest},10000,(clock_timestamp() AT TIME ZONE 'UTC') + interval '1 minute') ON CONFLICT(scope,"subjectHash") DO UPDATE SET count=10000,"resetAt"=EXCLUDED."resetAt"`;
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .expect(401);
  });
  it('expires counters using DB clock and stores no raw email or IP', async () => {
    const address = '203.0.113.' + (Math.floor(Math.random() * 150) + 10),
      secret = process.env.JWT_ACCESS_SECRET!;
    const digest = createHmac('sha256', secret)
      .update('auth-abuse:v1:register-ip\0' + address)
      .digest('hex');
    await rate.consume('register', address);
    await db.$executeRaw`UPDATE auth_rate_buckets SET count=10000,"resetAt"=(clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE scope='register-ip' AND "subjectHash"=${digest}`;
    await other.get(AuthSessionRate).consume('register', address);
    const [row] = await db.$queryRaw<
      { count: number; subjectHash: string }[]
    >`SELECT count,"subjectHash" FROM auth_rate_buckets WHERE scope='register-ip' AND "subjectHash"=${digest}`;
    expect(row.count).toBe(1);
    expect(row.subjectHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(address);
  });
});
