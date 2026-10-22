import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';

function setup(role: Role, ownsStore: boolean, active = true) {
  const tx = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 7, role, isActive: active }),
      update: vi.fn().mockImplementation(async ({ data }) => ({ id: 7, role, ...data })),
    },
    store: { findUnique: vi.fn().mockResolvedValue(ownsStore ? { id: 12 } : null) },
  };
  const prisma = { $transaction: vi.fn(async callback => callback(tx)) };
  const jobs = { enqueueSeller: vi.fn().mockResolvedValue({ id: 31n, status: 'PENDING' }) };
  const service = new AuthService(prisma as never, {} as never, new ConfigService(), jobs as never);
  return { service, tx, jobs };
}
describe('Account status Search invalidation uses canonical Store ownership', () => {
  it.each([Role.USER, Role.ADMIN, Role.SELLER])('invalidates owner with current role %s on lock and unlock', async role => {
    for (const active of [true, false]) {
      const { service, tx, jobs } = setup(role, true, active);
      expect(await service.updateAccountStatus(7, !active)).toMatchObject({ searchReconciliation: { jobId: '31', status: 'PENDING' } });
      expect(tx.store.findUnique).toHaveBeenCalledWith({ where: { sellerId: 7 }, select: { id: true } });
      expect(jobs.enqueueSeller).toHaveBeenCalledExactlyOnceWith(tx, 7);
    }
  });
  it.each([Role.USER, Role.SELLER])('does not enqueue a non-owner %s', async role => {
    const { service, jobs } = setup(role, false);
    expect(await service.updateAccountStatus(7, false)).toMatchObject({ searchReconciliation: null });
    expect(jobs.enqueueSeller).not.toHaveBeenCalled();
  });
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
    await expect(service.updateAccountStatus(7, false)).rejects.toThrow('QA failure');
  });
});
