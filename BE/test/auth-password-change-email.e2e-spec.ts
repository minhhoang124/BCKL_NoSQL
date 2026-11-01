import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { compare, hash } from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { AuthEmailDelivery } from '../src/auth/email-delivery.js';
import {
  emailTokenHash,
  type MailPurpose,
} from '../src/auth/email-recovery.input.js';
import { AccountSettingsGuard } from '../src/auth/account-settings.http.js';
import { bindingHash } from '../src/auth/password-change-email.input.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';

// Memory-only delivery: no email leaves the process.
describe('Email-confirmed password change — HTTP/PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let auth: AuthService;
  let passwordHash: string;
  const password = 'old password 1';
  const nextPassword = 'new password 2';
  const mail: { email: string; token: string; purpose: MailPurpose }[] = [];
  const keys = [
    'AUTH_EMAIL_ENABLED',
    'AUTH_EMAIL_HMAC_SECRET',
    'ACCOUNT_SETTINGS_WRITE_ENABLED',
    'AUTH_PASSWORD_CHANGE_MODE',
  ] as const;
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.AUTH_EMAIL_ENABLED = 'true';
    process.env.AUTH_EMAIL_HMAC_SECRET =
      'synthetic-password-change-throttle-secret-2026';
    process.env.ACCOUNT_SETTINGS_WRITE_ENABLED = 'true';
    process.env.AUTH_PASSWORD_CHANGE_MODE = 'EMAIL';
    passwordHash = await hash(password, 4);
    app = (
      await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(AuthEmailDelivery)
        .useValue({
          configured: () => ({}),
          enqueue: (email: string, token: string, purpose: MailPurpose) =>
            mail.push({ email, token, purpose }),
        })
        // Per-minute settings quota is not under test; DB rate limit is.
        .overrideGuard(AccountSettingsGuard)
        .useValue({ canActivate: () => true })
        .compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    auth = app.get(AuthService);
  });
  afterAll(async () => {
    await app?.close();
    for (const k of keys) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  });

  async function actor(verified = true) {
    const u = await db.user.create({
      data: {
        email: `pwchange-${randomUUID()}@example.invalid`,
        passwordHash,
        emailVerifiedAt: verified ? new Date() : null,
      },
    });
    const login = await auth.login({ email: u.email, password });
    return { ...u, token: 'Bearer ' + login.accessToken };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  const post = (path: string, who: Actor | string, body: object) =>
    http()
      .post('/auth/password-change/' + path)
      .set('Authorization', typeof who === 'string' ? who : who.token)
      .send(body);
  async function issue(u: Actor) {
    const res = await post('request', u, {
      currentPassword: password,
      confirmed: true,
    }).expect(200);
    const m = mail.filter((x) => x.email === u.email).at(-1);
    if (!m) throw new Error('expected memory delivery');
    expect(m.purpose).toBe('CHANGE_PASSWORD');
    return { token: m.token, binding: res.body.bindingSecret as string, res };
  }

  it('DIRECT mode keeps the email flow off; EMAIL mode blocks the direct bypass', async () => {
    const u = await actor();
    process.env.AUTH_PASSWORD_CHANGE_MODE = 'DIRECT';
    try {
      expect(
        (
          await post('request', u, {
            currentPassword: password,
            confirmed: true,
          }).expect(503)
        ).body.code,
      ).toBe('PASSWORD_CHANGE_EMAIL_DISABLED');
    } finally {
      process.env.AUTH_PASSWORD_CHANGE_MODE = 'EMAIL';
    }
    const direct = await http()
      .post('/auth/password')
      .set('Authorization', u.token)
      .send({ currentPassword: password, newPassword: nextPassword })
      .expect(409);
    expect(direct.body.code).toBe('PASSWORD_CHANGE_EMAIL_REQUIRED');
    expect(
      await compare(
        password,
        (await db.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash,
      ),
    ).toBe(true);
  });

  it('refuses unverified email and wrong current password without issuing a token', async () => {
    const unverified = await actor(false);
    expect(
      (
        await post('request', unverified, {
          currentPassword: password,
          confirmed: true,
        }).expect(409)
      ).body.code,
    ).toBe('EMAIL_NOT_VERIFIED');
    const u = await actor();
    expect(
      (
        await post('request', u, {
          currentPassword: 'wrong password',
          confirmed: true,
        }).expect(400)
      ).body.code,
    ).toBe('CURRENT_PASSWORD_INVALID');
    expect(
      await db.authEmailToken.count({
        where: { userId: { in: [unverified.id, u.id] } },
      }),
    ).toBe(0);
  });

  it('happy path: verify does not consume; other browser refused; confirm rotates credentials atomically', async () => {
    const u = await actor();
    const { token, binding, res } = await issue(u);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ status: 'CHANGE_EMAIL_SENT' });
    expect(res.body.email).toMatch(/^pw\*\*\*@example\.invalid$/);
    expect(JSON.stringify(res.body)).not.toContain(token);
    const stored = await db.authEmailToken.findFirstOrThrow({
      where: { userId: u.id },
    });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.bindingHash).not.toBe(binding);
    expect(stored.bindingHash).toMatch(/^[a-f0-9]{64}$/);

    for (let i = 0; i < 2; i++)
      expect(
        (await post('verify', u, { token, bindingSecret: binding }).expect(200))
          .body.status,
      ).toBe('VALID');
    const wrongBrowser = 'c'.repeat(42) + 'A';
    expect(
      (
        await post('verify', u, { token, bindingSecret: wrongBrowser }).expect(
          409,
        )
      ).body.code,
    ).toBe('PASSWORD_CHANGE_OTHER_BROWSER');
    expect(
      (
        await post('confirm', u, {
          token,
          bindingSecret: wrongBrowser,
          newPassword: nextPassword,
          confirmed: true,
        }).expect(409)
      ).body.code,
    ).toBe('PASSWORD_CHANGE_OTHER_BROWSER');
    // Same password is refused before any write.
    expect(
      (
        await post('confirm', u, {
          token,
          bindingSecret: binding,
          newPassword: password,
          confirmed: true,
        }).expect(400)
      ).body.code,
    ).toBe('PASSWORD_UNCHANGED');

    const before = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    const done = await post('confirm', u, {
      token,
      bindingSecret: binding,
      newPassword: nextPassword,
      confirmed: true,
    }).expect(200);
    expect(done.body).toEqual({
      status: 'PASSWORD_CHANGED',
      reauthenticationRequired: true,
    });
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.credentialVersion).toBe(before.credentialVersion + 1);
    expect(await compare(nextPassword, after.passwordHash)).toBe(true);
    expect(
      await db.refreshToken.count({ where: { userId: u.id, revokedAt: null } }),
    ).toBe(0);
    expect(
      await db.authEmailToken.count({
        where: { userId: u.id, usedAt: null, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await db.accountSecurityEvent.count({
        where: { userId: u.id, event: 'PASSWORD_CHANGED' },
      }),
    ).toBe(1);
    // Old access token no longer works; the link is single-use even after re-login.
    await http().get('/auth/me').set('Authorization', u.token).expect(401);
    const relogin = await auth.login({ email: u.email, password: nextPassword });
    expect(
      (
        await post('confirm', 'Bearer ' + relogin.accessToken, {
          token,
          bindingSecret: binding,
          newPassword: 'another password 3',
          confirmed: true,
        }).expect(400)
      ).body.code,
    ).toBe('EMAIL_TOKEN_INVALID');
    await expect(auth.login({ email: u.email, password })).rejects.toThrow();
  });

  it('another user cannot use the link; expired and superseded links are invalid', async () => {
    const owner = await actor();
    const other = await actor();
    const first = await issue(owner);
    expect(
      (
        await post('verify', other, {
          token: first.token,
          bindingSecret: first.binding,
        }).expect(400)
      ).body.code,
    ).toBe('EMAIL_TOKEN_INVALID');
    const second = await issue(owner);
    expect(
      (
        await post('verify', owner, {
          token: first.token,
          bindingSecret: first.binding,
        }).expect(400)
      ).body.code,
    ).toBe('EMAIL_TOKEN_INVALID');
    // Token identity is immutable in PostgreSQL: insert an already expired one.
    const expiredToken = randomBytes(32).toString('base64url');
    const expiredBinding = randomBytes(32).toString('base64url');
    await db.authEmailToken.create({
      data: {
        userId: owner.id,
        purpose: 'CHANGE_PASSWORD',
        tokenHash: emailTokenHash(expiredToken),
        bindingHash: bindingHash(expiredBinding),
        email: owner.email,
        credentialVersion: owner.credentialVersion,
        createdAt: new Date(Date.now() - 1_200_000),
        expiresAt: new Date(Date.now() - 300_000),
      },
    });
    expect(
      (
        await post('confirm', owner, {
          token: expiredToken,
          bindingSecret: expiredBinding,
          newPassword: nextPassword,
          confirmed: true,
        }).expect(400)
      ).body.code,
    ).toBe('EMAIL_TOKEN_INVALID');
    // The newest link still works for its own browser (not consumed by checks).
    expect(
      (
        await post('verify', owner, {
          token: second.token,
          bindingSecret: second.binding,
        }).expect(200)
      ).body.status,
    ).toBe('VALID');
    expect(
      await compare(
        password,
        (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
          .passwordHash,
      ),
    ).toBe(true);
  });

  it('two concurrent confirms commit exactly once', async () => {
    const u = await actor();
    const { token, binding } = await issue(u);
    const body = {
      token,
      bindingSecret: binding,
      newPassword: nextPassword,
      confirmed: true,
    };
    const results = await Promise.all([
      post('confirm', u, body),
      post('confirm', u, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(
      await db.accountSecurityEvent.count({
        where: { userId: u.id, event: 'PASSWORD_CHANGED' },
      }),
    ).toBe(1);
  });

  it('rate limits requests per user before checking the password', async () => {
    const u = await actor();
    // Fixed 15-minute PG windows: seven attempts guarantee a denial even if
    // the run straddles one window boundary (limit 3 per window).
    const codes: number[] = [];
    for (let i = 0; i < 7; i++)
      codes.push(
        (
          await post('request', u, {
            currentPassword: i === 1 ? 'wrong password' : password,
            confirmed: true,
          })
        ).status,
      );
    expect(codes).toContain(429);
    const denied = await post('request', u, {
      currentPassword: password,
      confirmed: true,
    });
    if (denied.status === 429)
      expect(denied.body.code).toBe('PASSWORD_CHANGE_RATE_LIMITED');
  });
});
