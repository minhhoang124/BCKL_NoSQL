import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { SearchReconciliationWorker } from './search-reconciliation.worker.js';

describe('Reconciliation poison-product operational policy', () => {
  it('retains an exhausted failed job as DEAD and continues another job without silently skipping the failed scope', async () => {
    const jobs = [
      { id: 10n, attemptCount: 7, scope: 'STORE', scopeId: 1 },
      { id: 11n, attemptCount: 0, scope: 'STORE', scopeId: 2 },
    ];
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { searchReconciliationJob: { findMany: vi.fn().mockResolvedValue(jobs), updateMany } };
    const processClaimedJob = vi.fn()
      .mockRejectedValueOnce(new Error('Invalid catalog image, productId=42 imageIndex=0'))
      .mockResolvedValueOnce({ scanned: 1, created: 1, skipped: 0, failed: 0 });
    const worker = new SearchReconciliationWorker(prisma as never, { processClaimedJob } as never, new ConfigService());
    await worker.runBatch();
    expect(processClaimedJob.mock.calls).toEqual([[10n, 8], [11n, 1]]);
    expect(updateMany.mock.calls[1][0]).toMatchObject({ where: { id: 10n, attemptCount: 8 }, data: { status: 'DEAD', nextAttemptAt: null, leaseExpiresAt: null } });
    expect(updateMany.mock.calls[1][0].data).not.toHaveProperty('cursorProductId');
    expect(updateMany.mock.calls[3][0]).toMatchObject({ where: { id: 11n, attemptCount: 1 }, data: { status: 'SUCCEEDED' } });
  });
});
