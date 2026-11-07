import { ConfigService } from '@nestjs/config';
import { redisCartConfig, redisClientOptions } from './redis.service.js';

const cfg = (values: Record<string, string>) => new ConfigService(values);

describe('redisCartConfig', () => {
  it('defaults to the PostgreSQL cart and rejects an ambiguous flag', () => {
    expect(redisCartConfig(cfg({})).enabled).toBe(false);
    expect(() => redisCartConfig(cfg({ USE_REDIS_CART: 'TRUE' }))).toThrow(/true or false/);
  });

  it('validates URL and TTL when enabled', () => {
    expect(redisCartConfig(cfg({ USE_REDIS_CART: 'true', REDIS_URL: 'redis://127.0.0.1:6379' })))
      .toMatchObject({ enabled: true, ttlSeconds: 604800, commandTimeoutMs: 500 });
    expect(() => redisCartConfig(cfg({ USE_REDIS_CART: 'true', REDIS_URL: 'http://x' }))).toThrow(/REDIS_URL/);
    expect(() => redisCartConfig(cfg({ USE_REDIS_CART: 'true', REDIS_URL: 'redis://x', REDIS_CART_TTL_SECONDS: '10' })))
      .toThrow(/REDIS_CART_TTL_SECONDS/);
  });

  it('F3: Redis command timeout must be lower than the checkout lock timeout', () => {
    const base = { USE_REDIS_CART: 'true', REDIS_URL: 'redis://127.0.0.1:6379' };
    expect(() => redisCartConfig(cfg({ ...base, REDIS_COMMAND_TIMEOUT_MS: '5000', CHECKOUT_LOCK_TIMEOUT_MS: '1000' })))
      .toThrow(/lower than CHECKOUT_LOCK_TIMEOUT_MS/);
    expect(() => redisCartConfig(cfg({ ...base, REDIS_COMMAND_TIMEOUT_MS: '1000' }))).toThrow(/lower than/);
    expect(redisCartConfig(cfg({ ...base, REDIS_COMMAND_TIMEOUT_MS: '999' })).commandTimeoutMs).toBe(999);
    expect(redisCartConfig(cfg({ ...base, REDIS_COMMAND_TIMEOUT_MS: '1500', CHECKOUT_LOCK_TIMEOUT_MS: '2000' })).commandTimeoutMs).toBe(1500);
  });

  it('client never queues or resends commands', () => {
    expect(redisClientOptions(500)).toMatchObject({
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      reconnectOnError: null,
      commandTimeout: 500,
    });
  });
});
