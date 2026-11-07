import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, type RedisOptions } from 'ioredis';
import { checkoutConfigInt } from '../checkout/checkout-create-rate.js';
import {
  LUA_CLEANUP,
  LUA_IMPORT,
  LUA_WRITE,
  type CartWriteOp,
} from '../cart/cart-redis-protocol.js';

export interface RedisCartConfig {
  enabled: boolean;
  url: string;
  ttlSeconds: number;
  commandTimeoutMs: number;
}

function intSetting(
  config: ConfigService,
  name: string,
  fallback: string,
  min: number,
  max: number,
) {
  const raw = config.get<string>(name, fallback);
  const value = Number(raw);
  if (!/^[0-9]+$/.test(String(raw)) || value < min || value > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

/** Validated at startup; an invalid setting stops the app instead of falling back. */
export function redisCartConfig(config: ConfigService): RedisCartConfig {
  const flag = String(config.get<string>('USE_REDIS_CART', 'false'));
  if (flag !== 'true' && flag !== 'false')
    throw new Error('USE_REDIS_CART must be true or false');
  if (flag === 'false')
    return { enabled: false, url: '', ttlSeconds: 0, commandTimeoutMs: 0 };
  const url = String(config.get<string>('REDIS_URL', ''));
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('REDIS_URL must be a redis:// or rediss:// URL');
  }
  if (!['redis:', 'rediss:'].includes(parsed.protocol))
    throw new Error('REDIS_URL must be a redis:// or rediss:// URL');
  const commandTimeoutMs = intSetting(config, 'REDIS_COMMAND_TIMEOUT_MS', '500', 50, 5000);
  // Redis commands run while the buyer row is locked; one command must stay below the
  // lock budget other buyer writers wait for (same default as CheckoutCreateService).
  const lockMs = checkoutConfigInt(config, 'CHECKOUT_LOCK_TIMEOUT_MS', 1000);
  if (commandTimeoutMs >= lockMs)
    throw new Error(
      'REDIS_COMMAND_TIMEOUT_MS must be lower than CHECKOUT_LOCK_TIMEOUT_MS',
    );
  return {
    enabled: true,
    url,
    ttlSeconds: intSetting(config, 'REDIS_CART_TTL_SECONDS', '604800', 60, 31536000),
    commandTimeoutMs,
  };
}

/**
 * No client-side queueing or resending: a command is sent at most once. A command that
 * times out has an unknown outcome; callers report it as such and never resend it.
 */
export function redisClientOptions(commandTimeoutMs: number): RedisOptions {
  return {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    autoResendUnfulfilledCommands: false,
    reconnectOnError: null,
    enableReadyCheck: true,
    commandTimeout: commandTimeoutMs,
    connectTimeout: 2000,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  };
}

export type CartRedis = Redis & {
  cartWrite(
    key: string,
    seq: string,
    op: CartWriteOp,
    field: string,
    value: string,
    ttl: number,
  ): Promise<number>;
  cartCleanup(key: string, ...pairs: string[]): Promise<number>;
  cartImport(key: string, ...args: (string | number)[]): Promise<number>;
};

export function defineCartCommands(client: Redis): CartRedis {
  client.defineCommand('cartWrite', { numberOfKeys: 1, lua: LUA_WRITE });
  client.defineCommand('cartCleanup', { numberOfKeys: 1, lua: LUA_CLEANUP });
  client.defineCommand('cartImport', { numberOfKeys: 1, lua: LUA_IMPORT });
  return client as CartRedis;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly cart: RedisCartConfig;
  private redis: CartRedis | null = null;

  constructor(config: ConfigService) {
    this.cart = redisCartConfig(config);
  }

  get enabled() {
    return this.cart.enabled;
  }

  /** Only valid when enabled; startup has already connected and pinged. */
  get client(): CartRedis {
    if (!this.redis) throw new Error('Redis cart client is not initialised');
    return this.redis;
  }

  async onModuleInit() {
    if (!this.cart.enabled) return;
    const client = defineCartCommands(
      new Redis(this.cart.url, redisClientOptions(this.cart.commandTimeoutMs)),
    );
    client.on('error', () =>
      this.logger.warn('Redis cart connection error; details withheld.'),
    );
    await client.connect();
    if ((await client.ping()) !== 'PONG')
      throw new Error('Redis cart ping failed');
    this.redis = client;
    this.logger.log(`Redis cart enabled: ttl=${this.cart.ttlSeconds}s`);
  }

  async onModuleDestroy() {
    const client = this.redis;
    this.redis = null;
    if (client) await client.quit().catch(() => client.disconnect());
  }
}
