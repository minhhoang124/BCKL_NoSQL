import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { AccountStatusRecoveryService } from '../src/auth/account-status-recovery.service.js';
import {
  reasonDigest,
  statusIntentData,
} from '../src/auth/account-status-command.js';
import { SearchReconciliationService } from '../src/search/search-reconciliation.service.js';

describe('Accounts durable status, closure and audit — HTTP/PostgreSQL', () => {
  let app: INestApplication,
    db: PrismaService,
    auth: AuthService,
    recovery: AccountStatusRecoveryService,
    passwordHash: string;
  const password = 'Synthetic-recovery-QA-only-2026';
  beforeAll(async () => {
    passwordHash = await hash(password, 4);
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    auth = app.get(AuthService);
    recovery = app.get(AccountStatusRecoveryService);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });
  const user = (role: Role = Role.USER) =>
    db.user.create({
      data: {
        email: `status-recovery-${randomUUID()}@example.invalid`,
        passwordHash,
        role,
      },
    });
  const actor = (row: {
    id: number;
    email: string;
    role: Role;
    credentialVersion: number;
  }) => ({
    userId: row.id,
    email: row.email,
    role: row.role,
    credentialVersion: row.credentialVersion,
  });
  const decision = (isActive = false, expectedRevision = 1) => ({
    commandId: randomUUID(),
    expectedRevision,
    isActive,
    reason: 'QA explicit status recovery decision',
  });
  const intent = (body: ReturnType<typeof decision>) => ({
    commandId: body.commandId,
    isActive: body.isActive,
    expectedRevision: body.expectedRevision,
    reasonDigest: reasonDigest(body.reason),
  });
  async function setup() {
    const admin = await user(Role.ADMIN),
      target = await user();
    const session = await auth.login({ email: admin.email, password });
    const path = `/admin/accounts/${target.id}/status`;
    return { admin, target, path, token: session.accessToken };
  }
  const http = () => request(app.getHttpServer());

  it('closes an undelivered command without changing account/audit/sessions/jobs; late PATCH is denied', async () => {
    const { admin, target, path, token } = await setup(),
      body = decision();
    await auth.login({ email: target.email, password });
    const snapshot = async () => ({
      user: await db.user.findUnique({ where: { id: target.id } }),
      tokens: await db.refreshToken.findMany({ where: { userId: target.id } }),
      audit: await db.accountStatusHistory.count({
        where: { targetId: target.id },
      }),
      jobs: await db.searchReconciliationJob.count({
        where: { scope: 'SELLER', scopeId: target.id },
      }),
    });
    const before = await snapshot();
    const closed = await http()
      .post(path + '/reconcile')
      .auth(token, { type: 'bearer' })
      .send(intent(body))
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(closed.body).toEqual({
      commandId: body.commandId,
      outcome: 'CLOSED',
      current: { id: target.id, isActive: true, statusRevision: 1 },
      receipt: null,
    });
    expect(await snapshot()).toEqual(before);
    await expect(
      auth.updateAccountStatus(actor(admin), target.id, body),
    ).rejects.toMatchObject({ status: 409 });
    expect(await snapshot()).toEqual(before);
    const row = await db.accountStatusCommand.findUniqueOrThrow({
      where: {
        actorId_commandId: { actorId: admin.id, commandId: body.commandId },
      },
    });
    await recovery.reconcile(actor(admin), target.id, intent(body));
    expect(
      await db.accountStatusCommand.findUnique({ where: { id: row.id } }),
    ).toEqual(row);
  });
  it('write then reconcile returns persisted receipt; repeated PATCH does not revoke or audit twice', async () => {
    const { admin, target, path, token } = await setup(),
      body = decision();
    const first = await http()
      .patch(path)
      .auth(token, { type: 'bearer' })
      .send(body)
      .expect(200);
    const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    const replay = await auth.updateAccountStatus(
      actor(admin),
      target.id,
      body,
    );
    expect(replay).toEqual(first.body);
    expect(await db.user.findUnique({ where: { id: target.id } })).toEqual(
      after,
    );
    const resolved = await recovery.reconcile(
      actor(admin),
      target.id,
      intent(body),
    );
    expect(resolved.outcome).toBe('APPLIED');
    expect(resolved.receipt).toEqual({
      account: first.body.account,
      auditId: first.body.auditId,
      searchReconciliation: first.body.searchReconciliation,
    });
    expect(
      await db.accountStatusHistory.count({ where: { targetId: target.id } }),
    ).toBe(1);
  });
  it('receipt describes original transition, current describes a later Admin change', async () => {
    const { admin, target } = await setup(),
      body = decision();
    const receipt = await auth.updateAccountStatus(
      actor(admin),
      target.id,
      body,
    );
    await auth.updateAccountStatus(actor(admin), target.id, {
      isActive: true,
      expectedRevision: 2,
      reason: 'QA later independent Admin decision',
    });
    const resolved = await recovery.reconcile(
      actor(admin),
      target.id,
      intent(body),
    );
    expect(resolved.receipt?.account).toEqual(receipt.account);
    expect(resolved.current).toEqual({
      id: target.id,
      isActive: true,
      statusRevision: 3,
    });
  });
  it('write and close racing on one command can only yield APPLIED or CLOSED, never both', async () => {
    const { admin, target } = await setup(),
      body = decision();
    const [write, resolve] = await Promise.allSettled([
      auth.updateAccountStatus(actor(admin), target.id, body),
      recovery.reconcile(actor(admin), target.id, intent(body)),
    ]);
    expect(resolve.status).toBe('fulfilled');
    if (resolve.status !== 'fulfilled') return;
    expect(['APPLIED', 'CLOSED']).toContain(resolve.value.outcome);
    const count = await db.accountStatusHistory.count({
      where: { targetId: target.id },
    });
    if (resolve.value.outcome === 'APPLIED') {
      expect(write.status).toBe('fulfilled');
      expect(count).toBe(1);
    } else {
      expect(write.status).toBe('rejected');
      expect(count).toBe(0);
    }
    expect(
      await db.accountStatusCommand.count({
        where: { actorId: admin.id, commandId: body.commandId },
      }),
    ).toBe(1);
  });
  it('same actor/key cannot change target, revision, state or reason, even after CLOSED', async () => {
    const { admin, target } = await setup(),
      other = await user(),
      body = decision();
    await recovery.reconcile(actor(admin), target.id, intent(body));
    for (const changed of [
      { ...intent(body), expectedRevision: 2 },
      { ...intent(body), isActive: true },
      { ...intent(body), reasonDigest: 'a'.repeat(64) },
    ])
      await expect(
        recovery.reconcile(actor(admin), target.id, changed),
      ).rejects.toMatchObject({ status: 409 });
    await expect(
      recovery.reconcile(actor(admin), other.id, intent(body)),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      auth.updateAccountStatus(actor(admin), target.id, {
        ...body,
        reason: 'QA changed reason under existing key',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await db.accountStatusCommand.count({ where: { actorId: admin.id } }),
    ).toBe(1);
  });
  it('another Admin may use same UUID independently but cannot access the first Admin receipt', async () => {
    const { admin, target } = await setup(),
      other = await user(Role.ADMIN),
      body = decision();
    await auth.updateAccountStatus(actor(admin), target.id, body);
    const result = await recovery.reconcile(
      actor(other),
      target.id,
      intent(body),
    );
    expect(result.outcome).toBe('CLOSED');
    expect(result.receipt).toBeNull();
    expect(
      await db.accountStatusCommand.count({
        where: { commandId: body.commandId },
      }),
    ).toBe(2);
  });
  it('durable NOOP records metadata only and replays original snapshot after later state change', async () => {
    const { admin, target } = await setup(),
      body = decision(true);
    await auth.updateAccountStatus(actor(admin), target.id, body);
    expect(await db.user.findUnique({ where: { id: target.id } })).toEqual(
      target,
    );
    expect(
      await db.accountStatusHistory.count({ where: { targetId: target.id } }),
    ).toBe(0);
    expect(
      (await recovery.reconcile(actor(admin), target.id, intent(body))).outcome,
    ).toBe('NOOP');
    await auth.updateAccountStatus(actor(admin), target.id, {
      isActive: false,
      expectedRevision: 1,
      reason: 'QA later transition after no-op',
    });
    expect(
      (await auth.updateAccountStatus(actor(admin), target.id, body)).account,
    ).toEqual({ id: target.id, isActive: true, statusRevision: 1 });
  });
  it('stale new command creates no receipt; explicit reconciliation closes it without mutation', async () => {
    const { admin, target } = await setup(),
      body = decision();
    await auth.updateAccountStatus(actor(admin), target.id, {
      isActive: false,
      expectedRevision: 1,
      reason: 'QA different operation wins first',
    });
    await expect(
      auth.updateAccountStatus(actor(admin), target.id, body),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await db.accountStatusCommand.count({ where: { actorId: admin.id } }),
    ).toBe(0);
    expect(
      (await recovery.reconcile(actor(admin), target.id, intent(body))).outcome,
    ).toBe('CLOSED');
    expect(
      await db.accountStatusHistory.count({ where: { targetId: target.id } }),
    ).toBe(1);
  });
  it('audit read is scoped, ordered, paginated and contains no credential/hash/command metadata', async () => {
    const { admin, target, path, token } = await setup();
    await auth.updateAccountStatus(actor(admin), target.id, decision());
    await auth.updateAccountStatus(actor(admin), target.id, decision(true, 2));
    const before = await db.user.findUniqueOrThrow({
      where: { id: target.id },
    });
    const first = await http()
      .get(path + '/history?limit=1')
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(
      first.body.items.map((row: { toRevision: number }) => row.toRevision),
    ).toEqual([3]);
    expect(first.body.nextBeforeRevision).toBe(3);
    const second = await http()
      .get(path + '/history?limit=1&beforeRevision=3')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(
      second.body.items.map((row: { toRevision: number }) => row.toRevision),
    ).toEqual([2]);
    expect(second.body.nextBeforeRevision).toBeNull();
    expect(JSON.stringify(first.body)).not.toMatch(
      /passwordHash|credentialVersion|CredentialVersion|tokenHash|requestHash|reasonDigest|commandId/,
    );
    expect(await db.user.findUnique({ where: { id: target.id } })).toEqual(
      before,
    );
  });
  it('default history includes a valid maximum revision rather than silently hiding it', async () => {
    const { admin, target } = await setup();
    await db.user.update({
      where: { id: target.id },
      data: { statusRevision: 2147483646 },
    });
    await auth.updateAccountStatus(actor(admin), target.id, {
      isActive: false,
      expectedRevision: 2147483646,
      reason: 'QA final allowed account revision',
    });
    expect(
      (await recovery.history(actor(admin), target.id, '/')).items[0]
        .toRevision,
    ).toBe(2147483647);
  });
  it('guest/non-Admin and revoked Admin cannot read audit or close commands', async () => {
    const { admin, target, path, token } = await setup(),
      buyer = await user(),
      body = decision();
    const b = await auth.login({ email: buyer.email, password });
    for (const suffix of ['/history', ''])
      await http()
        .get(path + suffix)
        .expect(401)
        .expect('Cache-Control', 'no-store');
    await http()
      .post(path + '/reconcile')
      .send(intent(body))
      .expect(401);
    await http()
      .get(path + '/history')
      .auth(b.accessToken, { type: 'bearer' })
      .expect(403);
    await http()
      .post(path + '/reconcile')
      .auth(b.accessToken, { type: 'bearer' })
      .send(intent(body))
      .expect(403);
    await db.user.update({
      where: { id: admin.id },
      data: { credentialVersion: { increment: 1 } },
    });
    await http()
      .post(path + '/reconcile')
      .auth(token, { type: 'bearer' })
      .send(intent(body))
      .expect(401);
    await expect(
      recovery.history(actor(admin), target.id, '/'),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await db.accountStatusCommand.count({ where: { actorId: admin.id } }),
    ).toBe(0);
  });
  it('rejects query/body smuggling and malformed reconcile without creating a fence', async () => {
    const { target, path, token } = await setup(),
      body = decision();
    await http()
      .get(path + '/history?limit=1&limit=2')
      .auth(token, { type: 'bearer' })
      .expect(400);
    await http()
      .get(path + '/history')
      .auth(token, { type: 'bearer' })
      .send({ extra: true })
      .expect(400);
    await http()
      .post(path + '/reconcile?x=1')
      .auth(token, { type: 'bearer' })
      .send(intent(body))
      .expect(400)
      .expect('Cache-Control', 'no-store');
    await http()
      .post(path + '/reconcile')
      .auth(token, { type: 'bearer' })
      .send({ ...intent(body), reason: 'private' })
      .expect(400);
    expect(
      await db.accountStatusCommand.count({ where: { targetId: target.id } }),
    ).toBe(0);
  });
  it('immutable command cannot be rewritten/deleted; SQL NOOP cannot omit its receipt', async () => {
    const { admin, target } = await setup(),
      body = decision();
    await recovery.reconcile(actor(admin), target.id, intent(body));
    const row = await db.accountStatusCommand.findUniqueOrThrow({
      where: {
        actorId_commandId: { actorId: admin.id, commandId: body.commandId },
      },
    });
    await expect(
      db.accountStatusCommand.update({
        where: { id: row.id },
        data: { outcome: 'NOOP' },
      }),
    ).rejects.toThrow();
    await expect(
      db.accountStatusCommand.delete({ where: { id: row.id } }),
    ).rejects.toThrow();
    await expect(
      db.accountStatusCommand.create({
        data: {
          ...statusIntentData(admin.id, target.id, {
            ...intent(body),
            commandId: randomUUID(),
          }),
          outcome: 'NOOP',
        },
      }),
    ).rejects.toThrow();
  });
  it('corrupt valid-shaped receipt fails closed without replacing the record or changing account', async () => {
    const { admin, target } = await setup(),
      body = decision();
    const legacy = await auth.updateAccountStatus(actor(admin), target.id, {
      isActive: false,
      expectedRevision: 1,
      reason: body.reason,
    });
    const row = await db.accountStatusCommand.create({
      data: {
        ...statusIntentData(admin.id, target.id, intent(body)),
        outcome: 'APPLIED',
        auditId: BigInt(legacy.auditId!),
        receipt: {
          account: { id: target.id, isActive: false, statusRevision: 999 },
          auditId: legacy.auditId,
          searchReconciliation: null,
        },
      },
    });
    const before = await db.user.findUniqueOrThrow({
      where: { id: target.id },
    });
    await expect(
      recovery.reconcile(actor(admin), target.id, intent(body)),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      auth.updateAccountStatus(actor(admin), target.id, body),
    ).rejects.toMatchObject({ status: 503 });
    expect(
      await db.accountStatusCommand.findUnique({ where: { id: row.id } }),
    ).toEqual(row);
    expect(await db.user.findUnique({ where: { id: target.id } })).toEqual(
      before,
    );
    expect(
      await db.accountStatusHistory.count({ where: { targetId: target.id } }),
    ).toBe(1);
  });
  it('enqueue failure rolls back command/audit/state/revocation; closing later is still safe', async () => {
    const { admin, target } = await setup(),
      body = decision();
    await db.store.create({
      data: {
        sellerId: target.id,
        name: 'QA recovery Store',
        status: 'ACTIVE',
      },
    });
    const jobs = app.get(SearchReconciliationService),
      spy = vi
        .spyOn(jobs, 'enqueueSeller')
        .mockRejectedValueOnce(
          new Error('QA forced transactional enqueue failure'),
        );
    try {
      await expect(
        auth.updateAccountStatus(actor(admin), target.id, body),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      spy.mockRestore();
    }
    expect(await db.user.findUnique({ where: { id: target.id } })).toEqual(
      target,
    );
    expect(
      await db.accountStatusHistory.count({ where: { targetId: target.id } }),
    ).toBe(0);
    expect(
      await db.accountStatusCommand.count({ where: { targetId: target.id } }),
    ).toBe(0);
    expect(
      (await recovery.reconcile(actor(admin), target.id, intent(body))).outcome,
    ).toBe('CLOSED');
  });
});
