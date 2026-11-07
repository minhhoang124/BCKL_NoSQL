import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ImageRepairSummary,
  ProductImageRepairService,
} from './product-image-repair.service.js';

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_BACKOFF_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 3600;

export type ImageRepairRunResult =
  | { status: 'COMPLETED'; summary: ImageRepairSummary }
  | { status: 'SKIPPED_OVERLAP' }
  | { status: 'SKIPPED_BACKOFF'; nextEligibleAt: Date }
  | { status: 'FAILED'; nextEligibleAt: Date };

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Runtime entry point for eventual repair after image publish compensation fails.
 *
 * ProductImageRepairService owns the per-product lock and transactional repair.
 * This worker only schedules passes, prevents overlapping passes in this process,
 * and backs off after partial or batch-level failures to avoid a tight retry loop.
 */
@Injectable()
export class ProductImageRepairWorker {
  private readonly logger = new Logger(ProductImageRepairWorker.name);
  private readonly batchSize: number;
  private readonly baseBackoffSeconds: number;
  private running = false;
  private consecutiveFailedPasses = 0;
  private nextEligibleAtMs = 0;

  constructor(
    private readonly repairService: ProductImageRepairService,
    private readonly config: ConfigService,
  ) {
    this.batchSize = positiveInteger(
      config.get<string>('PRODUCT_IMAGE_REPAIR_BATCH_SIZE'),
      DEFAULT_BATCH_SIZE,
    );
    this.baseBackoffSeconds = positiveInteger(
      config.get<string>('PRODUCT_IMAGE_REPAIR_BACKOFF_SECONDS'),
      DEFAULT_BACKOFF_SECONDS,
    );
  }

  async runBatch(): Promise<ImageRepairRunResult> {
    if (this.running) {
      this.logger.warn(
        'Image repair pass skipped because another pass is running',
      );
      return { status: 'SKIPPED_OVERLAP' };
    }

    const now = Date.now();
    if (now < this.nextEligibleAtMs) {
      return {
        status: 'SKIPPED_BACKOFF',
        nextEligibleAt: new Date(this.nextEligibleAtMs),
      };
    }

    this.running = true;
    try {
      const summary = await this.repairService.repairAll({
        batchSize: this.batchSize,
      });
      if (summary.failedProducts > 0) {
        const nextEligibleAt = this.applyBackoff();
        this.logger.warn(
          `Image repair pass completed with failures: failed=${summary.failedProducts} nextEligibleAt=${nextEligibleAt.toISOString()}`,
        );
      } else {
        this.clearBackoff();
      }
      return { status: 'COMPLETED', summary };
    } catch (error: unknown) {
      const nextEligibleAt = this.applyBackoff();
      this.logger.error(
        `Image repair pass failed: ${error instanceof Error ? error.message : String(error)} nextEligibleAt=${nextEligibleAt.toISOString()}`,
      );
      return { status: 'FAILED', nextEligibleAt };
    } finally {
      this.running = false;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'product-image-repair' })
  protected async tick(): Promise<void> {
    if (this.config.get<string>('PRODUCT_IMAGE_REPAIR_ENABLED') === 'false') {
      return;
    }
    await this.runBatch();
  }

  private applyBackoff(): Date {
    this.consecutiveFailedPasses += 1;
    const exponent = Math.min(this.consecutiveFailedPasses - 1, 10);
    const delaySeconds = Math.min(
      this.baseBackoffSeconds * 2 ** exponent,
      MAX_BACKOFF_SECONDS,
    );
    this.nextEligibleAtMs = Date.now() + delaySeconds * 1000;
    return new Date(this.nextEligibleAtMs);
  }

  private clearBackoff(): void {
    this.consecutiveFailedPasses = 0;
    this.nextEligibleAtMs = 0;
  }
}
