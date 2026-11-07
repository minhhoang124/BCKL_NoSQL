import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { checkoutConfigInt } from '../checkout/checkout-create-rate.js';
import { orderCommandError } from './order-command-policy.js';

/** All cancellation requests/replays share one per-actor, per-instance ingress bucket. */
@Injectable()
export class OrderCancellationRateGuard implements CanActivate {
  private readonly buckets = new Map<
    number,
    { count: number; resetAt: number }
  >();
  private readonly limit: number;
  private cleanupAt = 0;
  constructor(config: ConfigService) {
    this.limit = checkoutConfigInt(config, 'ORDER_CANCEL_RATE_PER_MINUTE', 20);
  }
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const id = http.getRequest<Request & { user: AuthenticatedUser }>().user
      .userId;
    const now = Date.now();
    if (now >= this.cleanupAt) {
      for (const [key, value] of this.buckets)
        if (value.resetAt <= now) this.buckets.delete(key);
      this.cleanupAt = now + 60000;
    }
    let bucket = this.buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= 10000)
        this.reject(http.getResponse<Response>(), 60);
      bucket = { count: 0, resetAt: now + 60000 };
      this.buckets.set(id, bucket);
    }
    if (bucket.count >= this.limit)
      this.reject(
        http.getResponse<Response>(),
        Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      );
    bucket.count++;
    return true;
  }
  private reject(res: Response, seconds: number): never {
    res.setHeader('Retry-After', String(seconds));
    throw orderCommandError(429, 'RATE_LIMITED');
  }
}
