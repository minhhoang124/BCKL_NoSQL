import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { ImageRepairSummary } from './product-image-repair.service.js';
import { ProductImageRepairService } from './product-image-repair.service.js';
import { ProductImageRepairWorker } from './product-image-repair.worker.js';

const cleanSummary = (): ImageRepairSummary => ({
  scannedProducts: 1,
  repairedProducts: 0,
  removedImages: 0,
  promotedPrimaries: 0,
  outboxEvents: 0,
  failedProducts: 0,
});

function workerWith(repairAll: () => Promise<ImageRepairSummary>) {
  const repairService = {
    repairAll: vi.fn(repairAll),
  } as unknown as ProductImageRepairService;
  const config = {
    get: vi.fn((key: string) =>
      key === 'PRODUCT_IMAGE_REPAIR_BACKOFF_SECONDS' ? '60' : undefined,
    ),
  } as unknown as ConfigService;
  return {
    worker: new ProductImageRepairWorker(repairService, config),
    repairService,
  };
}

describe('ProductImageRepairWorker', () => {
  it('skips an overlapping runtime pass', async () => {
    let finish!: (summary: ImageRepairSummary) => void;
    const pending = new Promise<ImageRepairSummary>((resolve) => {
      finish = resolve;
    });
    const { worker, repairService } = workerWith(() => pending);

    const first = worker.runBatch();
    await vi.waitFor(() =>
      expect(repairService.repairAll).toHaveBeenCalledTimes(1),
    );
    await expect(worker.runBatch()).resolves.toEqual({
      status: 'SKIPPED_OVERLAP',
    });

    finish(cleanSummary());
    await expect(first).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('backs off after a pass with a product-level failure', async () => {
    const summary = { ...cleanSummary(), failedProducts: 1 };
    const { worker, repairService } = workerWith(async () => summary);

    await expect(worker.runBatch()).resolves.toMatchObject({
      status: 'COMPLETED',
      summary,
    });
    await expect(worker.runBatch()).resolves.toMatchObject({
      status: 'SKIPPED_BACKOFF',
      nextEligibleAt: expect.any(Date),
    });
    expect(repairService.repairAll).toHaveBeenCalledTimes(1);
  });
});
