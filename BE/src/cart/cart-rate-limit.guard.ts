import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { cartError } from './cart-http.js';

@Injectable()
export class CartRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<
    number,
    { count: number; resetAt: number }
  >();
  private readonly limit: number;
  private nextCleanup = 0;

  constructor(config: ConfigService) {
    this.limit = Number(config.get<string>('CART_RATE_LIMIT_PER_MINUTE', '60'));
    if (!Number.isSafeInteger(this.limit) || this.limit < 1)
      throw new Error('CART_RATE_LIMIT_PER_MINUTE must be a positive integer');
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const user = http.getRequest<Request & { user: AuthenticatedUser }>().user;
    const now = Date.now();
    if (now >= this.nextCleanup) {
      for (const [id, bucket] of this.buckets)
        if (bucket.resetAt <= now) this.buckets.delete(id);
      this.nextCleanup = now + 60_000;
    }
    let bucket = this.buckets.get(user.userId);
    if (!bucket || bucket.resetAt <= now) {
      // Bound memory without evicting live buckets and resetting their limits.
      if (!bucket && this.buckets.size >= 10_000)
        return this.reject(http.getResponse<Response>(), 60);
      bucket = { count: 0, resetAt: now + 60_000 };
      this.buckets.set(user.userId, bucket);
    }
    if (bucket.count >= this.limit)
      return this.reject(
        http.getResponse<Response>(),
        Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      );
    bucket.count++;
    return true;
  }

  private reject(response: Response, seconds: number): never {
    response.setHeader('Retry-After', seconds.toString());
    throw cartError(
      429,
      'RATE_LIMITED',
      'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
    );
  }
}
