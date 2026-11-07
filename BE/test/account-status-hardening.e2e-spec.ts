import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { AuthenticatedUser } from '../src/auth/auth.types.js';
import { PrismaService } from '../src/prisma.service.js';
import { SearchReconciliationService } from '../src/search/search-reconciliation.service.js';
// @ts-expect-error QA fixture is a directly executable JavaScript module.
import { provisionAccounts } from '../scripts/account-status-qa.mjs';

// setup-env.ts fails closed before imports unless DATABASE_URL is an explicit QA target.
describe('Accounts status — actual HTTP and PostgreSQL transactions', () => {
  let app: INestApplication,
    prisma: PrismaService,
    auth: AuthService,
    jobs: SearchReconciliationService,
    passwordHash: string;
  const password = 'QA-only-status-passphrase-2026';
  beforeAll(async () => {
    passwordHash = await hash(password, 4);
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    jobs = app.get(SearchReconciliationService);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });
  // Retain fixture actors/targets referenced by immutable audit. Isolated QA DB only.
  const user = (role: Role = Role.USER) =>
    prisma.user.create({
      data: {
        email: `status-${randomUUID()}@example.test`,
        passwordHash,
        role,
      },
    });
  const actor = (u: {
    id: number;
    email: string;
    role: Role;
    credentialVersion: number;
  }): AuthenticatedUser => ({
    userId: u.id,
    email: u.email,
    role: u.role,
    credentialVersion: u.credentialVersion,
  });
  const input = (isActive = false, expectedRevision = 1) => ({
    isActive,
    expectedRevision,
    reason: 'QA explicit account status decision',
  });
  const login = (u: { email: string }) =>
    auth.login({ email: u.email, password });
  it('login paused after reading the old account cannot mint a session after lock commits', async () => {
    const admin = await user(Role.ADMIN),
      target = await user();
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = prisma.user.findUnique.bind(prisma.user);
    // Auth.login only awaits this read; no Prisma fluent relation is consumed.
    const pausedRead = (async (
      args: Parameters<typeof prisma.user.findUnique>[0],
    ) => {
      const result = await read(args);
      entered();
      await gate;
      return result;
    }) as unknown as typeof prisma.user.findUnique;
    const spy = vi
      .spyOn(prisma.user, 'findUnique')
      .mockImplementationOnce(pausedRead);
    const pending = login(target).then(
      () => ({ status: 200 }),
      (error) => error,
    );
    try {
      await reached;
      await auth.updateAccountStatus(actor(admin), target.id, input());
    } finally {
      release();
      spy.mockRestore();
    }
    expect((await pending).status).toBe(401);
    expect(
      await prisma.refreshToken.count({
        where: { userId: target.id, revokedAt: null },
      }),
    ).toBe(0);
  });
  it('refresh verified before lock is rejected when its transaction resumes after commit', async () => {
    const admin = await user(Role.ADMIN),
      target = await user(),
      old = await login(target);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The application has module-scoped JwtService providers. Pause the exact
    // instance injected into AuthService, not another module's verifier.
    const jwt = auth['jwt'],
      verify = jwt.verifyAsync.bind(jwt);
    const spy = vi
      .spyOn(jwt, 'verifyAsync')
      .mockImplementationOnce(async (...args) => {
        const payload = await verify(...args);
        entered();
        await gate;
        return payload;
      });
    const pending = auth.refresh(old.refreshToken).then(
      () => ({ status: 200 }),
      (error) => error,
    );
    try {
      await reached;
      await auth.updateAccountStatus(actor(admin), target.id, input());
    } finally {
      release();
      spy.mockRestore();
    }
    expect((await pending).status).toBe(401);
    expect(
      await prisma.refreshToken.count({
        where: { userId: target.id, revokedAt: null },
      }),
    ).toBe(0);
  });
  it('portable fixture rerun preserves changed credentials, status, revision, audit and Store', async () => {
    const first = await provisionAccounts(prisma, passwordHash);
    expect(first).toHaveLength(5);
    const target = first.find(
      (row: { label: string }) => row.label === 'buyer',
    );
    const admin = await user(Role.ADMIN);
    const canonical = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
    });
    await auth.updateAccountStatus(
      actor(admin),
      target.id,
      input(!canonical.isActive, canonical.statusRevision),
    );
    const ids = first.map((row: { id: number }) => row.id);
    const snapshot = async () => ({
      users: await prisma.user.findMany({
        where: { id: { in: ids } },
        orderBy: { id: 'asc' },
      }),
      stores: await prisma.store.findMany({
        where: { sellerId: { in: ids } },
        orderBy: { id: 'asc' },
      }),
      audit: await prisma.accountStatusHistory.findMany({
        where: { targetId: { in: ids } },
        orderBy: { id: 'asc' },
      }),
    });
    const before = await snapshot();
    const second = await provisionAccounts(
      prisma,
      'different hash must never overwrite',
    );
    expect(second.every((row: { created: boolean }) => !row.created)).toBe(
      true,
    );
    expect(await snapshot()).toEqual(before);
  });
  it('advisory gate returns a supported integer, not PostgreSQL void', async () => {
    const result = await prisma.$transaction(
      async (tx) =>
        tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(190311, 1)`,
    );
    expect(result).toEqual([{ locked: 1 }]);
  });
  it('GET revision is allowlisted and no-store; anonymous and non-Admin denied', async () => {
    const admin = await user(Role.ADMIN),
      buyer = await user(),
      target = await user();
    const a = await login(admin),
      b = await login(buyer);
    await request(app.getHttpServer())
      .get(`/admin/accounts/${target.id}/status`)
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await request(app.getHttpServer())
      .get(`/admin/accounts/${target.id}/status`)
      .auth(b.accessToken, { type: 'bearer' })
      .expect(403);
    const r = await request(app.getHttpServer())
      .get(`/admin/accounts/${target.id}/status`)
      .auth(a.accessToken, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(r.body).toEqual({
      id: target.id,
      isActive: true,
      statusRevision: 1,
    });
  });
  it('rejects legacy bool-only body and query without mutation', async () => {
    const admin = await user(Role.ADMIN),
      target = await user(),
      a = await login(admin);
    await request(app.getHttpServer())
      .patch(`/admin/accounts/${target.id}/status`)
      .auth(a.accessToken, { type: 'bearer' })
      .send({ isActive: false })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/admin/accounts/${target.id}/status?q=x`)
      .auth(a.accessToken, { type: 'bearer' })
      .send(input())
      .expect(400);
    expect(await prisma.user.findUnique({ where: { id: target.id } })).toEqual(
      target,
    );
  });
  it('self-lock cannot remove the acting Admin', async () => {
    const admin = await user(Role.ADMIN),
      a = await login(admin);
    const r = await request(app.getHttpServer())
      .patch(`/admin/accounts/${admin.id}/status`)
      .auth(a.accessToken, { type: 'bearer' })
      .send(input())
      .expect(409);
    expect(r.body.code).toBe('ACCOUNT_SELF_LOCK_FORBIDDEN');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: admin.id } }))
        .isActive,
    ).toBe(true);
  });
  it('two concurrent requests on one revision create exactly one transition/audit', async () => {
    const a = await user(Role.ADMIN),
      b = await user(Role.ADMIN),
      target = await user();
    const results = await Promise.allSettled([
      auth.updateAccountStatus(actor(a), target.id, input()),
      auth.updateAccountStatus(actor(b), target.id, input()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failure.reason.getResponse().code).toBe('ACCOUNT_REVISION_CONFLICT');
    expect(
      await prisma.accountStatusHistory.count({
        where: { targetId: target.id },
      }),
    ).toBe(1);
    expect(
      await prisma.user.findUnique({ where: { id: target.id } }),
    ).toMatchObject({
      isActive: false,
      statusRevision: 2,
      credentialVersion: 2,
    });
  });
  it('two Admins locking each other cannot both commit', async () => {
    const a = await user(Role.ADMIN),
      b = await user(Role.ADMIN);
    const results = await Promise.allSettled([
      auth.updateAccountStatus(actor(a), b.id, input()),
      auth.updateAccountStatus(actor(b), a.id, input()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.user.count({
        where: { id: { in: [a.id, b.id] }, isActive: true },
      }),
    ).toBe(1);
    expect(
      await prisma.accountStatusHistory.count({
        where: { targetId: { in: [a.id, b.id] } },
      }),
    ).toBe(1);
  });
  it('no-op is zero-mutation; stale retry does not create another audit', async () => {
    const admin = await user(Role.ADMIN),
      target = await user();
    expect(
      await auth.updateAccountStatus(actor(admin), target.id, input(true)),
    ).toEqual({
      account: { id: target.id, isActive: true, statusRevision: 1 },
      auditId: null,
      searchReconciliation: null,
    });
    expect(await prisma.user.findUnique({ where: { id: target.id } })).toEqual(
      target,
    );
    await auth.updateAccountStatus(actor(admin), target.id, input());
    await expect(
      auth.updateAccountStatus(actor(admin), target.id, input()),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.accountStatusHistory.count({
        where: { targetId: target.id },
      }),
    ).toBe(1);
  });
  it('lock then unlock never resurrects old access or refresh; new login works', async () => {
    const admin = await user(Role.ADMIN),
      target = await user(),
      old = await login(target);
    await auth.updateAccountStatus(actor(admin), target.id, input());
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(old.accessToken, { type: 'bearer' })
      .expect(401);
    await auth.updateAccountStatus(actor(admin), target.id, input(true, 2));
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(old.accessToken, { type: 'bearer' })
      .expect(401);
    await expect(auth.refresh(old.refreshToken)).rejects.toMatchObject({
      status: 401,
    });
    const fresh = await login(target);
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(fresh.accessToken, { type: 'bearer' })
      .expect(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: target.id } }))
        .credentialVersion,
    ).toBe(3);
  });
  it('unlock also rotates credential version for a legacy inactive account', async () => {
    const admin = await user(Role.ADMIN),
      target = await user(),
      old = await login(target);
    // Historical fixture: legacy lock did not revoke tokens/version. Not runtime proof.
    await prisma.user.update({
      where: { id: target.id },
      data: { isActive: false },
    });
    await auth.updateAccountStatus(actor(admin), target.id, input(true));
    await request(app.getHttpServer())
      .get('/auth/me')
      .auth(old.accessToken, { type: 'bearer' })
      .expect(401);
    await expect(auth.refresh(old.refreshToken)).rejects.toMatchObject({
      status: 401,
    });
  });
  it('enqueue failure rolls back status, versions, revocation and audit together', async () => {
    const admin = await user(Role.ADMIN),
      target = await user();
    await login(target);
    await prisma.store.create({
      data: {
        sellerId: target.id,
        name: 'QA status suspended Store',
        status: 'SUSPENDED',
      },
    });
    const tokens = await prisma.refreshToken.findMany({
      where: { userId: target.id },
    });
    const spy = vi
      .spyOn(jobs, 'enqueueSeller')
      .mockRejectedValueOnce(new Error('QA fault after audit'));
    try {
      await expect(
        auth.updateAccountStatus(actor(admin), target.id, input()),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.user.findUnique({ where: { id: target.id } })).toEqual(
      target,
    );
    expect(
      await prisma.refreshToken.findMany({ where: { userId: target.id } }),
    ).toEqual(tokens);
    expect(
      await prisma.accountStatusHistory.count({
        where: { targetId: target.id },
      }),
    ).toBe(0);
    expect(
      (await prisma.store.findUniqueOrThrow({ where: { sellerId: target.id } }))
        .status,
    ).toBe('SUSPENDED');
  });
  it('actor token version is rechecked inside transaction', async () => {
    const admin = await user(Role.ADMIN),
      target = await user();
    await prisma.user.update({
      where: { id: admin.id },
      data: { credentialVersion: { increment: 1 } },
    });
    await expect(
      auth.updateAccountStatus(actor(admin), target.id, input()),
    ).rejects.toMatchObject({ status: 401 });
    expect(await prisma.user.findUnique({ where: { id: target.id } })).toEqual(
      target,
    );
  });
  it('SQL UPDATE/DELETE cannot rewrite immutable status audit', async () => {
    const admin = await user(Role.ADMIN),
      target = await user();
    const result = await auth.updateAccountStatus(
      actor(admin),
      target.id,
      input(),
    );
    const id = BigInt(result.auditId!);
    const before = await prisma.accountStatusHistory.findUniqueOrThrow({
      where: { id },
    });
    await expect(
      prisma.accountStatusHistory.update({
        where: { id },
        data: { reason: 'QA attempted rewrite audit' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.accountStatusHistory.delete({ where: { id } }),
    ).rejects.toThrow();
    expect(
      await prisma.accountStatusHistory.findUnique({ where: { id } }),
    ).toEqual(before);
  });
});
