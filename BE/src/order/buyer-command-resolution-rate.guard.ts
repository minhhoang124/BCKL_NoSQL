import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderCompletionRateGuard } from './order-completion-rate.guard.js';

/** Independent guard instance/bucket, not shared with cancel/complete execution. */
@Injectable()
export class BuyerCommandResolutionRateGuard extends OrderCompletionRateGuard {
  constructor(config: ConfigService) {
    // Reuse bounded bucket/cleanup behavior, with its own explicit setting.
    super(
      new ConfigService({
        ORDER_COMMAND_RATE_PER_MINUTE: config.get(
          'BUYER_RESOLUTION_RATE_PER_MINUTE',
          20,
        ),
      }),
    );
  }
}
