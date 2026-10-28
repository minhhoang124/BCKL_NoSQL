import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hash, compare } from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { AuthEmailRecoveryService } from '../src/auth/email-recovery.service.js';
import { AuthEmailDelivery } from '../src/auth/email-delivery.js';
import { AuthEmailRateGuard } from '../src/auth/email-recovery.controller.js';
import {
  emailTokenHash,
  type EmailPurpose,
} from '../src/auth/email-recovery.input.js';
describe('Auth email/reset real PostgreSQL', () => {
  let app: INestApplication,
    db: PrismaService,
    auth: AuthService,
    recovery: AuthEmailRecoveryService,
    passwordHash: string;
  const password = 'Synthetic-old-password-2026',
    nextPassword = 'Synthetic-next-password-2026';
  const mail: {
    email: string;
    token: string;
    purpose: EmailPurpose;
    id: string;
  }[] = [];
  const old = {
    enabled: process.env.AUTH_EMAIL_ENABLED,
    hmac: process.env.AUTH_EMAIL_HMAC_SECRET,
  };
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    const u = new URL(process.env.DATABASE_URL ?? '');
    if (
      !(
        u.hostname === '127.0.0.1' &&
        u.port === '5549' &&
        ['/bckl_order_resolution_test_attributes_20261019_v959','/bckl_order_resolution_test_attributes_20261019_v961', '/bckl_order_resolution_test_attributes_20261019_v965', '/bckl_order_resolution_test_attributes_20261019_v967', '/bckl_order_resolution_test_attributes_20261019_v971'].includes(u.pathname)
      ) &&
      !(
        process.env.GITHUB_ACTIONS === 'true' &&
        ['127.0.0.1', 'localhost'].includes(u.hostname) &&
        u.port === '5549' &&
        u.pathname === '/bckl_order_resolution_test_attributes_20261019'
      )
    )
      throw Error('Exact Auth email QA database required');
    process.env.AUTH_EMAIL_ENABLED = 'true';
    process.env.AUTH_EMAIL_HMAC_SECRET =
      'synthetic-email-throttle-only-secret-2026';
    passwordHash = await hash(password, 4);
    app = (
      await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(AuthEmailDelivery)
        .useValue({
          configured: () => ({}),
          enqueue: (
            email: string,
            token: string,
            purpose: EmailPurpose,
            id: string,
          ) => mail.push({ email, token, purpose, id }),
        })
        .overrideGuard(AuthEmailRateGuard)
        .useValue({ canActivate: () => true })
        .compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    auth = app.get(AuthService);
    recovery = app.get(AuthEmailRecoveryService);
  });
  afterAll(async () => {
    await app?.close();
    for (const [k, v] of [
      ['AUTH_EMAIL_ENABLED', old.enabled],
      ['AUTH_EMAIL_HMAC_SECRET', old.hmac],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  async function actor() {
    const u = await db.user.create({
      data: { email: `email-${randomUUID()}@example.invalid`, passwordHash },
    });
    const login = await auth.login({ email: u.email, password });
    return { ...u, token: login.accessToken, refresh: login.refreshToken };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  async function issue(u: Actor, purpose: EmailPurpose = 'RESET_PASSWORD') {
    await recovery.request(
      purpose,
      purpose === 'RESET_PASSWORD' ? u.email : null,
      'synthetic-ip-' + randomUUID(),
      purpose === 'VERIFY_EMAIL'
        ? { userId: u.id, email:u.email, role: 'USER', credentialVersion: u.credentialVersion }
        : undefined,
    );
    const m = mail
      .filter((m) => m.email === u.email && m.purpose === purpose)
      .at(-1);
    if (!m) throw Error('Expected memory-only QA delivery');
    return m;
  }
  const confirm = (token: string, purpose: EmailPurpose = 'RESET_PASSWORD') =>
    http()
      .post(
        '/auth/' +
          (purpose === 'RESET_PASSWORD' ? 'password-reset' : 'email') +
          '/confirm',
      )
      .send(
        purpose === 'RESET_PASSWORD'
          ? { token, newPassword: nextPassword, confirmed: true }
          : { token, confirmed: true },
      );
  it('selected QA runtime role has no privileged DDL roles', async () => {
    if (process.env.GITHUB_ACTIONS === 'true' || process.env.QA_AUTH_EMAIL_REQUIRE_APP_ROLE !== 'true') return;
    const [r] = await db.$queryRaw<
      { rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }[]
    >`SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
    expect(r).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });
  it('generic public request gives no account/token facts for existing, unknown or inactive', async () => {
    const u = await actor();
    const active = await http()
      .post('/auth/password-reset/request')
      .send({ email: u.email })
      .expect(202);
    const missing = await http()
      .post('/auth/password-reset/request')
      .send({ email: `missing-${randomUUID()}@example.invalid` })
      .expect(202);
    await db.user.update({ where: { id: u.id }, data: { isActive: false } });
    const inactive = await http()
      .post('/auth/password-reset/request')
      .send({ email: u.email })
      .expect(202);
    expect(active.body).toEqual(missing.body);
    expect(active.body).toEqual(inactive.body);
    expect(Object.keys(active.body).sort()).toEqual(['message', 'status']);
    expect(active.headers['cache-control']).toBe('no-store');
    expect(mail.filter((m) => m.email === u.email)).toHaveLength(1);
  });
  it('verifies only token owner email, without changing role, password or session version', async () => {
    const u = await actor(),
      m = await issue(u, 'VERIFY_EMAIL');
    await confirm(m.token, 'VERIFY_EMAIL').expect(200);
    const stored = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stored.emailVerifiedAt).not.toBeNull();
    expect(stored.passwordHash).toBe(passwordHash);
    expect(stored.credentialVersion).toBe(1);
    expect(stored.role).toBe('USER');
    await confirm(m.token, 'VERIFY_EMAIL').expect(400);
    const status = await http()
      .get('/auth/email/status')
      .auth(u.token, { type: 'bearer' })
      .expect(200);
    expect(status.body.email).toBe(u.email);
    expect(status.body.verifiedAt).not.toBeNull();
  });
  it('requires JWT and explicit consent for owner verification request', async () => {
    const u = await actor();
    await http()
      .post('/auth/email/request')
      .send({ confirmed: true })
      .expect(401);
    await http()
      .post('/auth/email/request')
      .auth(u.token, { type: 'bearer' })
      .send({ confirmed: false })
      .expect(400);
    await http()
      .post('/auth/email/request')
      .auth(u.token, { type: 'bearer' })
      .send({ confirmed: true })
      .expect(202);
    expect(
      mail.filter((m) => m.email === u.email && m.purpose === 'VERIFY_EMAIL'),
    ).toHaveLength(1);
  });
  it('atomically resets hash, consumes token, revokes refresh/access and records one immutable audit', async () => {
    const u = await actor(),
      m = await issue(u);
    await confirm(m.token).expect(200);
    const stored = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await compare(nextPassword, stored.passwordHash)).toBe(true);
    expect(stored.credentialVersion).toBe(2);
    expect(
      await db.refreshToken.count({ where: { userId: u.id, revokedAt: null } }),
    ).toBe(0);
    await http().get('/auth/me').auth(u.token, { type: 'bearer' }).expect(401);
    await expect(auth.login({ email: u.email, password })).rejects.toThrow();
    expect(
      (await auth.login({ email: u.email, password: nextPassword })).user.id,
    ).toBe(u.id);
    await confirm(m.token).expect(400);
    expect(
      await db.accountSecurityEvent.count({
        where: { userId: u.id, event: 'PASSWORD_RESET' },
      }),
    ).toBe(1);
  });
  it('two concurrent consumes yield one success and one audit, no duplicate password mutation', async () => {
    const u = await actor(),
      m = await issue(u);
    const results = await Promise.all([confirm(m.token), confirm(m.token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(
      await db.accountSecurityEvent.count({ where: { userId: u.id } }),
    ).toBe(1);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: u.id } }))
        .credentialVersion,
    ).toBe(2);
  });
  it('a new anonymous request preserves older valid link; successful reset closes sibling links', async () => {
    const u = await actor(),
      first = await issue(u),
      second = await issue(u);
    expect(second.token).not.toBe(first.token);
    await confirm(first.token).expect(200);
    await confirm(second.token).expect(400);
    expect(
      (await db.authEmailToken.findUniqueOrThrow({ where: { id: second.id } }))
        .revokedAt,
    ).not.toBeNull();
  });
  it('rejects purpose swap, unknown token, stale credential version and disabled user', async () => {
    const u = await actor(),
      m = await issue(u, 'VERIFY_EMAIL');
    await confirm(m.token).expect(400);
    await confirm(randomBytes(32).toString('base64url')).expect(400);
    await db.user.update({
      where: { id: u.id },
      data: { credentialVersion: { increment: 1 } },
    });
    await confirm(m.token, 'VERIFY_EMAIL').expect(400);
    const v = await actor(),
      n = await issue(v);
    await db.user.update({ where: { id: v.id }, data: { isActive: false } });
    await confirm(n.token).expect(400);
  });
  it('rejects expired token using database clock', async () => {
    const u = await actor(),
      token = randomBytes(32).toString('base64url');
    await db.authEmailToken.create({
      data: {
        userId: u.id,
        purpose: 'RESET_PASSWORD',
        tokenHash: emailTokenHash(token),
        email: u.email,
        credentialVersion: 1,
        createdAt: new Date(Date.now() - 1200000),
        expiresAt: new Date(Date.now() - 300000),
      },
    });
    await confirm(token).expect(400);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: u.id } }))
        .credentialVersion,
    ).toBe(1);
  });
  it('quota bounds recipient without invalidating prior tokens or locking the account', async () => {
    const u = await actor();
    for (let i = 0; i < 5; i++)
      await recovery.request(
        'RESET_PASSWORD',
        u.email,
        'unique-' + randomUUID(),
      );
    expect(mail.filter((m) => m.email === u.email)).toHaveLength(3);
    expect((await auth.login({ email: u.email, password })).user.id).toBe(u.id);
  });
  it('rolls back token consumption when credential version cannot advance', async () => {
    const u = await actor();
    await db.user.update({
      where: { id: u.id },
      data: { credentialVersion: 2147483647 },
    });
    const m = await issue(u);
    await confirm(m.token).expect(503);
    expect(
      (await db.authEmailToken.findUniqueOrThrow({ where: { id: m.id } }))
        .usedAt,
    ).toBeNull();
    const stored = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stored.passwordHash).toBe(passwordHash);
    expect(
      await db.accountSecurityEvent.count({ where: { userId: u.id } }),
    ).toBe(0);
  });
  it('enforces HTTP no-store/body/query and exact fields', async () => {
    await http()
      .post('/auth/password-reset/request?email=x')
      .send({ email: 'x@example.invalid' })
      .expect(400);
    await http()
      .post('/auth/password-reset/request')
      .send({ email: 'x@example.invalid', role: 'ADMIN' })
      .expect(400);
    await http()
      .post('/auth/password-reset/confirm')
      .send({
        token: 'A'.repeat(43),
        newPassword: nextPassword,
        confirmed: false,
      })
      .expect(400);
    const r = await http().get('/auth/email/status?unknown=1').expect(400);
    expect(r.headers['cache-control']).toBe('no-store');
  });
  it('stores only token digest and prevents rewriting token identity or reopening it', async () => {
    const u = await actor(),
      m = await issue(u),
      row = await db.authEmailToken.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.tokenHash).toBe(emailTokenHash(m.token));
    expect(JSON.stringify(row)).not.toContain(m.token);
    await expect(
      db.authEmailToken.update({
        where: { id: m.id },
        data: { email: 'hijack@example.invalid' },
      }),
    ).rejects.toThrow();
    await confirm(m.token).expect(200);
    await expect(
      db.authEmailToken.update({ where: { id: m.id }, data: { usedAt: null } }),
    ).rejects.toThrow();
  });
});
