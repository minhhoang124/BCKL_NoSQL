import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { orderError } from './order-list.http.js';

/** Per-instance operational protection; does not claim a shared replica quota. */
@Injectable()
export class OrderListRateGuard implements CanActivate {
  private readonly buckets = new Map<
    number,
    { count: number; resetAt: number }
  >();
  private readonly limit: number;
  private nextCleanup = 0;
  constructor(config: ConfigService) {
    this.limit = Number(config.get<string>('ORDER_LIST_RATE_PER_MINUTE', '60'));
    if (
      !Number.isSafeInteger(this.limit) ||
      this.limit < 1 ||
      this.limit > 60_000
    )
      throw new Error(
        'ORDER_LIST_RATE_PER_MINUTE must be an integer from 1 to 60000',
      );
  }
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const user = http.getRequest<Request & { user: AuthenticatedUser }>().user;
    const now = Date.now();
    if (now >= this.nextCleanup) {
      for (const [id, value] of this.buckets)
        if (value.resetAt <= now) this.buckets.delete(id);
      this.nextCleanup = now + 60_000;
    }
    let bucket = this.buckets.get(user.userId);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= 10_000)
        this.reject(http.getResponse<Response>(), 60);
      bucket = { count: 0, resetAt: now + 60_000 };
      this.buckets.set(user.userId, bucket);
    }
    if (bucket.count >= this.limit)
      this.reject(
        http.getResponse<Response>(),
        Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      );
    bucket.count++;
    return true;
  }
  private reject(response: Response, retryAfter: number): never {
    response.setHeader('Retry-After', String(retryAfter));
    throw orderError(
      429,
      'RATE_LIMITED',
      'Bạn thao tác quá nhanh. Vui lòng thử lại.',
    );
  }
}
