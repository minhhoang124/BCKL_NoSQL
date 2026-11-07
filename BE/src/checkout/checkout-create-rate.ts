import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { checkoutError } from './checkout-error.js';

export function checkoutConfigInt(
  config: ConfigService,
  name: string,
  fallback: number,
  max = 60_000,
) {
  const value = Number(config.get<string>(name, String(fallback)));
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error(`${name} must be an integer from 1 to ${max}`);
  return value;
}

/** Per-instance abuse protection only; correctness relies on PostgreSQL locks. */
@Injectable()
export class CheckoutCreateRate {
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private readonly ingress: number;
  private readonly intent: number;
  private nextCleanup = 0;
  constructor(config: ConfigService) {
    this.ingress = checkoutConfigInt(
      config,
      'CHECKOUT_CREATE_INGRESS_PER_MINUTE',
      60,
    );
    this.intent = checkoutConfigInt(
      config,
      'CHECKOUT_CREATE_INTENTS_PER_MINUTE',
      5,
    );
  }
  consume(buyerId: number, kind: 'ingress' | 'intent') {
    const now = Date.now();
    if (now >= this.nextCleanup) {
      for (const [key, bucket] of this.buckets)
        if (bucket.resetAt <= now) this.buckets.delete(key);
      this.nextCleanup = now + 60_000;
    }
    const key = `${kind}:${buyerId}`;
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= 10_000) this.reject(60);
      bucket = { count: 0, resetAt: now + 60_000 };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= (kind === 'ingress' ? this.ingress : this.intent))
      this.reject(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
    bucket.count++;
  }
  private reject(retryAfter: number): never {
    throw checkoutError(
      429,
      'RATE_LIMITED',
      'Bạn thao tác quá nhanh. Vui lòng thử lại.',
      { retryAfter },
    );
  }
}

@Injectable()
export class CheckoutCreateIngressGuard implements CanActivate {
  constructor(private readonly rate: CheckoutCreateRate) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    this.rate.consume(request.user.userId, 'ingress');
    return true;
  }
}
