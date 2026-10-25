import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';

function setup(role: Role, ownsStore: boolean, active = true) {
  const target = {
    id: 7,
    role,
    isActive: active,
    statusRevision: 1,
    credentialVersion: 1,
  };
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    user: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ id: 7, role, isActive: active }),
      findUnique: vi
        .fn()
        .mockImplementation(async ({ where }) =>
          where.id === 1
            ? { id: 1, role: Role.ADMIN, isActive: true, credentialVersion: 1 }
            : target,
        ),
      count: vi.fn().mockResolvedValue(2),
      update: vi
        .fn()
        .mockImplementation(async ({ data }) => ({
          id: 7,
          isActive: data.isActive,
          statusRevision: 2,
        })),
    },
    store: {
      findUnique: vi.fn().mockResolvedValue(ownsStore ? { id: 12 } : null),
    },
    refreshToken: { updateMany: vi.fn() },
    accountStatusHistory: { create: vi.fn().mockResolvedValue({ id: 10n }) },
  };
  const prisma = { $transaction: vi.fn(async (callback) => callback(tx)) };
  const jobs = {
    enqueueSeller: vi.fn().mockResolvedValue({ id: 31n, status: 'PENDING' }),
  };
  const service = new AuthService(
    prisma as never,
    {} as never,
    new ConfigService(),
    jobs as never,
  );
  const actor = {
    userId: 1,
    role: Role.ADMIN,
    email: 'qa-admin@example.test',
    credentialVersion: 1,
  };
  return {
    service: {
      updateAccountStatus: (id: number, isActive: boolean) =>
        service.updateAccountStatus(actor, id, {
          isActive,
          expectedRevision: 1,
          reason: 'QA explicit status change',
        }),
    },
    rawService: service,
    actor,
    tx,
    jobs,
    target,
    prisma,
  };
}
describe('Account status Search invalidation uses canonical Store ownership', () => {
  it.each([Role.USER, Role.ADMIN, Role.SELLER])(
    'invalidates owner with current role %s on lock and unlock',
    async (role) => {
      for (const active of [true, false]) {
        const { service, tx, jobs } = setup(role, true, active);
        expect(await service.updateAccountStatus(7, !active)).toMatchObject({
          searchReconciliation: { jobId: '31', status: 'PENDING' },
        });
        expect(tx.store.findUnique).toHaveBeenCalledWith({
          where: { sellerId: 7 },
          select: { id: true },
        });
        expect(tx.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              isActive: !active,
              statusRevision: { increment: 1 },
              credentialVersion: { increment: 1 },
            },
          }),
        );
        expect(tx.refreshToken.updateMany).toHaveBeenCalledOnce();
        expect(tx.accountStatusHistory.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              actorId: 1,
              targetId: 7,
              fromRevision: 1,
              toRevision: 2,
              fromCredentialVersion: 1,
              toCredentialVersion: 2,
            }),
          }),
        );
        expect(jobs.enqueueSeller).toHaveBeenCalledExactlyOnceWith(tx, 7);
      }
    },
  );
  it.each([Role.USER, Role.SELLER])(
    'does not enqueue a non-owner %s',
    async (role) => {
      const { service, jobs } = setup(role, false);
      expect(await service.updateAccountStatus(7, false)).toMatchObject({
        searchReconciliation: null,
      });
      expect(jobs.enqueueSeller).not.toHaveBeenCalled();
    },
  );
  it('no-op performs no write, lookup or job', async () => {
    const { service, tx, jobs } = setup(Role.USER, true);
    await service.updateAccountStatus(7, true);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.store.findUnique).not.toHaveBeenCalled();
    expect(jobs.enqueueSeller).not.toHaveBeenCalled();
  });
  it('does not hide enqueue failures as success (mock boundary, not rollback proof)', async () => {
    const { service, jobs } = setup(Role.USER, true);
    jobs.enqueueSeller.mockRejectedValue(new Error('QA failure'));
    await expect(service.updateAccountStatus(7, false)).rejects.toMatchObject({
      status: 503,
    });
  });
  it('stale no-op does not mutate', async () => {
    const s = setup(Role.USER, false);
    await expect(
      s.rawService.updateAccountStatus(s.actor, 7, {
        isActive: true,
        expectedRevision: 2,
        reason: 'QA stale no-op reason',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(s.tx.user.update).not.toHaveBeenCalled();
  });
  it('self-lock is forbidden', async () => {
    const s = setup(Role.USER, false);
    await expect(s.service.updateAccountStatus(1, false)).rejects.toMatchObject(
      { status: 409 },
    );
    expect(s.tx.user.update).not.toHaveBeenCalled();
  });
  it('last active Admin count is checked within transaction', async () => {
    const s = setup(Role.ADMIN, false);
    s.tx.user.count.mockResolvedValue(1);
    await expect(s.service.updateAccountStatus(7, false)).rejects.toMatchObject(
      { status: 409 },
    );
    expect(s.tx.user.update).not.toHaveBeenCalled();
  });
  it.each(['inactive', 'version', 'role'])(
    'rechecks actor %s after locks',
    async (mode) => {
      const s = setup(Role.USER, false);
      s.tx.user.findUnique.mockImplementation(async ({ where }) =>
        where.id === 1
          ? {
              id: 1,
              role: mode === 'role' ? Role.USER : Role.ADMIN,
              isActive: mode !== 'inactive',
              credentialVersion: mode === 'version' ? 2 : 1,
            }
          : s.target,
      );
      await expect(
        s.service.updateAccountStatus(7, false),
      ).rejects.toMatchObject({ status: mode === 'role' ? 403 : 401 });
      expect(s.tx.user.update).not.toHaveBeenCalled();
    },
  );
  it.each(['statusRevision', 'credentialVersion'] as const)(
    'rejects %s overflow',
    async (key) => {
      const s = setup(Role.USER, false);
      s.target[key] = 2147483647;
      await expect(
        s.rawService.updateAccountStatus(s.actor, 7, {
          isActive: false,
          expectedRevision: s.target.statusRevision,
          reason: 'QA overflow guard reason',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(s.tx.user.update).not.toHaveBeenCalled();
    },
  );
  it.each(['audit', 'revoke'])(
    'does not hide %s failures (not SQL rollback proof)',
    async (kind) => {
      const s = setup(Role.USER, false);
      if (kind === 'audit')
        s.tx.accountStatusHistory.create.mockRejectedValue(
          new Error('QA audit failure'),
        );
      else
        s.tx.refreshToken.updateMany.mockRejectedValue(
          new Error('QA revoke failure'),
        );
      await expect(
        s.service.updateAccountStatus(7, false),
      ).rejects.toMatchObject({ status: 503 });
      expect(s.jobs.enqueueSeller).not.toHaveBeenCalled();
    },
  );
  it('restarts the entire transaction on a serialization failure', async () => {
    const s = setup(Role.USER, false);
    s.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('QA conflict', {
        code: 'P2034',
        clientVersion: '7',
      }),
    );
    await s.service.updateAccountStatus(7, false);
    expect(s.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(s.tx.accountStatusHistory.create).toHaveBeenCalledOnce();
  });
  it('stops after three aborted transactions', async () => {
    const s = setup(Role.USER, false);
    s.prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('QA conflict', {
        code: 'P2034',
        clientVersion: '7',
      }),
    );
    await expect(s.service.updateAccountStatus(7, false)).rejects.toMatchObject(
      { status: 409 },
    );
    expect(s.prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});
