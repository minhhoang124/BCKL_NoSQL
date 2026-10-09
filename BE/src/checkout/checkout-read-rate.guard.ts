import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { checkoutError } from './checkout-error.js';

@Injectable()
export class CheckoutReadRateGuard implements CanActivate {
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private readonly previewLimit: number;
  private readonly lookupLimit: number;
  private nextCleanup = 0;
  constructor(config: ConfigService) {
    this.previewLimit = this.limit(config, 'CHECKOUT_PREVIEW_RATE_PER_MINUTE');
    this.lookupLimit = this.limit(config, 'CHECKOUT_LOOKUP_RATE_PER_MINUTE');
  }
  private limit(config: ConfigService, name: string) {
    const value = Number(config.get<string>(name, '20'));
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`${name} must be a positive integer`);
    return value;
  }
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user: AuthenticatedUser }>();
    const preview = req.method === 'POST';
    const key = `${preview ? 'preview' : 'lookup'}:${req.user.userId}`;
    const now = Date.now();
    if (now >= this.nextCleanup) {
      for (const [id, bucket] of this.buckets)
        if (bucket.resetAt <= now) this.buckets.delete(id);
      this.nextCleanup = now + 60_000;
    }
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= 10_000)
        this.reject(http.getResponse<Response>(), 60);
      bucket = { count: 0, resetAt: now + 60_000 };
      this.buckets.set(key, bucket);
    }
    const limit = preview ? this.previewLimit : this.lookupLimit;
    if (bucket.count >= limit)
      this.reject(
        http.getResponse<Response>(),
        Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      );
    bucket.count++;
    return true;
  }
  private reject(response: Response, seconds: number): never {
    response.setHeader('Retry-After', String(seconds));
    throw checkoutError(
      429,
      'RATE_LIMITED',
      'Bạn thao tác quá nhanh. Vui lòng thử lại.',
    );
  }
}
