import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { hash } from 'bcryptjs';
import { randomInt, randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PhoneOtpGuard } from '../src/auth/phone-otp.controller.js';
import { phoneCodeDigest } from '../src/auth/phone-otp.service.js';
import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';
describe('Phone OTP sandbox HTTP/PostgreSQL — no SMS delivery or ownership proof', () => {
  let app: INestApplication,
    other: INestApplication,
    db: PrismaService,
    auth: AuthService,
    passwordHash: string;
  const old = { ...process.env },
    key = 'synthetic-phone-sandbox-hmac-key-2026',
    password = 'Synthetic-phone-actor-password-2026';
  const phone = () => '+1' + randomInt(1000000000, 9999999999),
    http = (a = app) => request(a.getHttpServer());
  async function runtime() {
    const a = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApp(a);
    await a.init();
    return a;
  }
  beforeAll(async () => {
    assertRuntimeQaTarget(process.env.DATABASE_URL, process.env.GITHUB_ACTIONS);
    Object.assign(process.env, {
      AUTH_PHONE_OTP_ENABLED: 'true',
      AUTH_PHONE_OTP_PROVIDER: 'sandbox',
      AUTH_PHONE_OTP_HMAC_SECRET: key,
    });
    passwordHash = await hash(password, 4);
    app = await runtime();
    other = await runtime();
    db = app.get(PrismaService);
    auth = app.get(AuthService);
  });
  beforeEach(() => {
    for (const a of [app, other])
      (
        a.get(PhoneOtpGuard) as unknown as { buckets: Map<unknown, unknown> }
      ).buckets.clear();
  });
  afterEach(() => vi.restoreAllMocks());
  it('explicit reconciliation closes an unused code without changing the contact and never reopens it', async () => {
    const u = await actor(),
      r = await issue(u);
    const close = () =>
      http()
        .post('/auth/phone-otp/reconcile')
        .auth(u.accessToken, { type: 'bearer' })
        .send({ challengeId: r.body.challengeId, confirmed: true });
    expect((await close().expect(200)).body).toMatchObject({
      outcome: 'CLOSED',
      challengeId: r.body.challengeId,
      ownershipVerified: false,
    });
    await close().expect(200);
    await confirm(u, r.body.challengeId, r.body.demoCode).expect(400);
    expect(
      await db.userPhoneContact.findUnique({ where: { userId: u.id } }),
    ).toBeNull();
  });
  it('reconciliation races confirmation safely across app instances', async () => {
    const u = await actor(),
      r = await issue(u);
    const [c, recovery] = await Promise.all([
      confirm(u, r.body.challengeId, r.body.demoCode, other),
      http()
        .post('/auth/phone-otp/reconcile')
        .auth(u.accessToken, { type: 'bearer' })
        .send({ challengeId: r.body.challengeId, confirmed: true }),
    ]);
    expect(recovery.status).toBe(200);
    if (recovery.body.outcome === 'APPLIED') {
      expect(c.status).toBe(200);
      expect(
        (
          await db.userPhoneContact.findUniqueOrThrow({
            where: { userId: u.id },
          })
        ).version,
      ).toBe(1);
    } else {
      expect(recovery.body.outcome).toBe('CLOSED');
      expect(c.status).toBe(400);
      expect(
        await db.userPhoneContact.findUnique({ where: { userId: u.id } }),
      ).toBeNull();
    }
  });
  afterAll(async () => {
    await other?.close();
    await app?.close();
    for (const k of [
      'AUTH_PHONE_OTP_ENABLED',
      'AUTH_PHONE_OTP_PROVIDER',
      'AUTH_PHONE_OTP_HMAC_SECRET',
    ]) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  });
  async function actor() {
    const user = await db.user.create({
      data: { email: `phone-${randomUUID()}@example.invalid`, passwordHash },
    });
    return { ...user, ...(await auth.login({ email: user.email, password })) };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  const issue = (u: Actor, number = phone(), expectedVersion = 0, a = app) =>
    http(a)
      .post('/auth/phone-otp/request')
      .auth(u.accessToken, { type: 'bearer' })
      .send({ phoneNumber: number, expectedVersion, confirmed: true });
  const confirm = (u: Actor, id: string, code: string, a = app) =>
    http(a)
      .post('/auth/phone-otp/confirm')
      .auth(u.accessToken, { type: 'bearer' })
      .send({ challengeId: id, code, confirmed: true });
  const status = (u: Actor) =>
    http()
      .get('/auth/phone-otp/status')
      .auth(u.accessToken, { type: 'bearer' });
  async function fixture(
    u: Actor,
    patch: Partial<{
      phoneNumber: string;
      baseVersion: number;
      usedAt: Date;
      appliedVersion: number;
      expiresAt: Date;
    }> = {},
  ) {
    const createdAt = new Date(Date.now() - 120000),
      code = '123456',
      c = {
        id: randomUUID(),
        userId: u.id,
        phoneNumber: patch.phoneNumber ?? phone(),
        credentialVersion: u.credentialVersion,
      };
    const row = await db.phoneOtpChallenge.create({
      data: {
        ...c,
        codeHash: phoneCodeDigest(key, c, code),
        baseVersion: 0,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 300000),
        ...patch,
      },
    });
    return { ...row, code };
  }
  it('selected runtime uses non-superuser/no role creation and app mode has no CREATEDB', async () => {
    if (process.env.GITHUB_ACTIONS === 'true') return;
    const [r] = await db.$queryRaw<
      { rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean }[]
    >`SELECT rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user`;
    expect(r?.rolsuper).toBe(false);
    expect(r?.rolcreaterole).toBe(false);
    if (new URL(process.env.DATABASE_URL!).username === 'bckl_qa_app_20261021')
      expect(r?.rolcreatedb).toBe(false);
  });
  it('creates/consumes an own sandbox challenge and stores only HMAC, without changing role/email/CV/address/Store', async () => {
    const u = await actor(),
      before = await db.user.findUniqueOrThrow({ where: { id: u.id } }),
      r = await issue(u).expect(200).expect('Cache-Control', 'no-store');
    expect(r.body).toMatchObject({
      channel: 'SANDBOX',
      smsSent: false,
      ownershipVerified: false,
    });
    expect(r.body.demoCode).toMatch(/^[0-9]{6}$/);
    const c = await db.phoneOtpChallenge.findUniqueOrThrow({
      where: { id: r.body.challengeId },
    });
    expect(c.codeHash).toBe(phoneCodeDigest(key, c, r.body.demoCode));
    expect(Object.keys(c)).not.toContain('code');
    expect(Object.keys(c)).not.toContain('demoCode');
    const applied = await confirm(u, c.id, r.body.demoCode).expect(200);
    expect(applied.body).toMatchObject({
      outcome: 'APPLIED',
      challengeId: c.id,
      version: 1,
      channel: 'SANDBOX',
      ownershipVerified: false,
      isCurrentContact: true,
    });
    expect(await db.user.findUniqueOrThrow({ where: { id: u.id } })).toEqual(
      before,
    );
    expect(await db.store.count({ where: { sellerId: u.id } })).toBe(0);
    expect(await db.userAddress.count({ where: { userId: u.id } })).toBe(0);
    expect((await status(u).expect(200)).body).toMatchObject({
      version: 1,
      pending: null,
      ownershipVerified: false,
    });
  });
  it('persists wrong attempts despite HTTP400 and exhausts at five', async () => {
    const u = await actor(),
      r = await issue(u),
      bad = r.body.demoCode === '000000' ? '000001' : '000000';
    for (let n = 1; n <= 5; n++) {
      await confirm(u, r.body.challengeId, bad).expect(400);
      const c = await db.phoneOtpChallenge.findUniqueOrThrow({
        where: { id: r.body.challengeId },
      });
      expect(c.attempts).toBe(n);
      expect(!!c.exhaustedAt).toBe(n === 5);
    }
    await confirm(u, r.body.challengeId, r.body.demoCode).expect(400);
    expect(
      await db.userPhoneContact.findUnique({ where: { userId: u.id } }),
    ).toBeNull();
  });
  it('serializes six simultaneous wrong attempts across app instances and stops at five', async () => {
    const u = await actor(),
      r = await issue(u),
      bad = r.body.demoCode === '000000' ? '000001' : '000000';
    const out = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        confirm(u, r.body.challengeId, bad, i % 2 ? other : app),
      ),
    );
    expect(out.map((r) => r.status)).toEqual(Array(6).fill(400));
    const c = await db.phoneOtpChallenge.findUniqueOrThrow({
      where: { id: r.body.challengeId },
    });
    expect(c.attempts).toBe(5);
    expect(c.exhaustedAt).not.toBeNull();
  });
  it('two valid confirmations consume once, keep version1 and return the same receipt', async () => {
    const u = await actor(),
      r = await issue(u);
    const a = await Promise.all([
      confirm(u, r.body.challengeId, r.body.demoCode),
      confirm(u, r.body.challengeId, r.body.demoCode, other),
    ]);
    expect(a.map((x) => x.status)).toEqual([200, 200]);
    expect(a[0]!.body).toEqual(a[1]!.body);
    expect(
      (await db.userPhoneContact.findUniqueOrThrow({ where: { userId: u.id } }))
        .version,
    ).toBe(1);
  });
  it('expired code fails without consuming an attempt or contact update', async () => {
    const u = await actor(),
      c = await fixture(u, { expiresAt: new Date(Date.now() - 30000) });
    await confirm(u, c.id, c.code).expect(400);
    expect(
      (await db.phoneOtpChallenge.findUniqueOrThrow({ where: { id: c.id } }))
        .attempts,
    ).toBe(0);
    expect((await status(u)).body.pending).toBeNull();
  });
  it('explicit resend revokes the old code even when the destination changes', async () => {
    const u = await actor(),
      old = await fixture(u),
      r = await issue(u).expect(200);
    expect(
      (await db.phoneOtpChallenge.findUniqueOrThrow({ where: { id: old.id } }))
        .revokedAt,
    ).not.toBeNull();
    await confirm(u, old.id, old.code).expect(400);
    await confirm(u, r.body.challengeId, r.body.demoCode).expect(200);
  });
  it('enforces cooldown and version mismatch without revoking the rightful pending code', async () => {
    const u = await actor(),
      r = await issue(u).expect(200);
    await issue(u, phone(), 1).expect(409);
    await issue(u).expect(429).expect('Retry-After', /^\d+$/);
    expect(
      (
        await db.phoneOtpChallenge.findUniqueOrThrow({
          where: { id: r.body.challengeId },
        })
      ).revokedAt,
    ).toBeNull();
    await confirm(u, r.body.challengeId, r.body.demoCode).expect(200);
  });
  it('persistent recipient quota is shared across accounts and app instances', async () => {
    const number = phone(),
      users = await Promise.all([actor(), actor(), actor(), actor()]);
    const r = await Promise.all(
      users.map((u, i) => issue(u, number, 0, i % 2 ? other : app)),
    );
    expect(r.map((x) => x.status).sort()).toEqual([200, 200, 200, 429]);
    expect(
      await db.phoneOtpChallenge.count({ where: { phoneNumber: number } }),
    ).toBe(3);
  });
  it('does not globally reserve a sandbox phone or merge accounts', async () => {
    const number = phone(),
      a = await actor(),
      b = await actor(),
      ra = await issue(a, number),
      rb = await issue(b, number, 0, other);
    await confirm(a, ra.body.challengeId, ra.body.demoCode).expect(200);
    await confirm(b, rb.body.challengeId, rb.body.demoCode, other).expect(200);
    expect(
      await db.userPhoneContact.count({ where: { phoneNumber: number } }),
    ).toBe(2);
  });
  it('old applied receipt cannot overwrite the newer contact and reports isCurrentContact=false', async () => {
    const u = await actor(),
      old = await fixture(u, {
        usedAt: new Date(Date.now() - 60000),
        appliedVersion: 1,
      });
    await db.userPhoneContact.create({
      data: {
        userId: u.id,
        phoneNumber: old.phoneNumber,
        version: 1,
        lastChallengeId: old.id,
        sandboxConfirmedAt: old.usedAt!,
      },
    });
    const fresh = await issue(u, phone(), 1).expect(200);
    await confirm(u, fresh.body.challengeId, fresh.body.demoCode).expect(200);
    const before = await db.userPhoneContact.findUniqueOrThrow({
      where: { userId: u.id },
    });
    const replay = await confirm(u, old.id, old.code).expect(200);
    expect(replay.body).toMatchObject({ version: 1, isCurrentContact: false });
    expect(
      await db.userPhoneContact.findUniqueOrThrow({ where: { userId: u.id } }),
    ).toEqual(before);
  });
  it('a lost confirmation response can be reconciled read-only without a code or another write', async () => {
    const u = await actor(),
      r = await issue(u),
      before = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    const first = await confirm(u, r.body.challengeId, r.body.demoCode);
    const c = await db.phoneOtpChallenge.findUniqueOrThrow({
      where: { id: r.body.challengeId },
    });
    const read = await http()
      .get('/auth/phone-otp/receipts/' + c.id)
      .auth(u.accessToken, { type: 'bearer' })
      .expect(200);
    expect(read.body).toEqual(first.body);
    expect(
      await db.phoneOtpChallenge.findUniqueOrThrow({ where: { id: c.id } }),
    ).toEqual(c);
    expect(await db.user.findUniqueOrThrow({ where: { id: u.id } })).toEqual(
      before,
    );
  });
  it('switching accounts, invalidated CV or disabled User prevents consumption', async () => {
    const a = await actor(),
      b = await actor(),
      r = await issue(a);
    await confirm(b, r.body.challengeId, r.body.demoCode).expect(400);
    await http()
      .get('/auth/phone-otp/receipts/' + r.body.challengeId)
      .auth(b.accessToken, { type: 'bearer' })
      .expect(404);
    await db.user.update({
      where: { id: a.id },
      data: { credentialVersion: { increment: 1 } },
    });
    await confirm(a, r.body.challengeId, r.body.demoCode).expect(401);
    const c = await actor(),
      s = await issue(c);
    await db.user.update({ where: { id: c.id }, data: { isActive: false } });
    await confirm(c, s.body.challengeId, s.body.demoCode).expect(401);
  });
  it('rolls back code consumption if contact persistence fails', async () => {
    const u = await actor(),
      r = await issue(u),
      original = db.$transaction.bind(db) as (
        fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: unknown,
      ) => Promise<unknown>;
    vi.spyOn(db, '$transaction').mockImplementation(((
      fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: unknown,
    ) =>
      original(
        async (tx) =>
          fn(
            new Proxy(tx, {
              get(target, p) {
                if (p === 'userPhoneContact')
                  return new Proxy(target.userPhoneContact, {
                    get(t, k) {
                      if (k === 'create' || k === 'update')
                        return () =>
                          Promise.reject(
                            Error('Synthetic contact write failure'),
                          );
                      return Reflect.get(t, k);
                    },
                  });
                return Reflect.get(target, p);
              },
            }),
          ),
        options,
      )) as never);
    await confirm(u, r.body.challengeId, r.body.demoCode).expect(503);
    const c = await db.phoneOtpChallenge.findUniqueOrThrow({
      where: { id: r.body.challengeId },
    });
    expect(c.usedAt).toBeNull();
    expect(c.appliedVersion).toBeNull();
    expect(
      await db.userPhoneContact.findUnique({ where: { userId: u.id } }),
    ).toBeNull();
  });
  it('SQL refuses terminal reopening, payload tampering and mismatched contact evidence', async () => {
    const u = await actor(),
      c = await fixture(u),
      otherUser = await actor();
    await expect(
      db.phoneOtpChallenge.update({
        where: { id: c.id },
        data: { userId: otherUser.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.userPhoneContact.create({
        data: {
          userId: u.id,
          phoneNumber: c.phoneNumber,
          version: 1,
          lastChallengeId: c.id,
          sandboxConfirmedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await confirm(u, c.id, c.code).expect(200);
    await expect(
      db.phoneOtpChallenge.update({
        where: { id: c.id },
        data: { usedAt: null, appliedVersion: null },
      }),
    ).rejects.toThrow();
    await expect(
      db.userPhoneContact.delete({ where: { userId: u.id } }),
    ).rejects.toThrow();
  });
  it('HTTP boundaries reject guest/body/query/extra keys and keep no-store on failures', async () => {
    const u = await actor();
    await http()
      .post('/auth/phone-otp/request')
      .send({})
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await status(u).query({ code: '123456' }).expect(400);
    await http()
      .get('/auth/phone-otp/status')
      .auth(u.accessToken, { type: 'bearer' })
      .send({ code: '123456' })
      .expect(400);
    await http()
      .post('/auth/phone-otp/request')
      .auth(u.accessToken, { type: 'bearer' })
      .send({
        phoneNumber: phone(),
        expectedVersion: 0,
        confirmed: true,
        role: 'ADMIN',
      })
      .expect(400);
  });
  it('GET status never reveals a demo code after reload, even while a challenge is pending', async () => {
    const u = await actor(),
      r = await issue(u);
    const s = await status(u).expect(200);
    expect(s.body.pending.challengeId).toBe(r.body.challengeId);
    expect(s.body.pending).not.toHaveProperty('demoCode');
    expect(s.body.pending).not.toHaveProperty('code');
    expect(s.body).not.toHaveProperty('demoCode');
  });
});
