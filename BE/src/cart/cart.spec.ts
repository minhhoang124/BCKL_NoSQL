import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { vi } from 'vitest';
import type { PrismaService } from '../prisma.service.js';
import { PutCartItemDto } from './cart.dto.js';
import { CartVariantIdPipe } from './cart-http.js';
import { CartRateLimitGuard } from './cart-rate-limit.guard.js';
import { CartService } from './cart.service.js';

vi.mock('../product/transaction-conflict.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../product/transaction-conflict.js')
  >()),
  waitForTransactionRetry: vi.fn().mockResolvedValue(undefined),
}));

describe('Cart quantity and ID validation', () => {
  it.each([1, 2, 99])('accepts integer quantity %s', async (quantity) => {
    expect(
      await validate(plainToInstance(PutCartItemDto, { quantity })),
    ).toHaveLength(0);
  });
  it.each([
    0,
    -1,
    100,
    1.5,
    '2',
    null,
    true,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects quantity %s', async (quantity) => {
    expect(
      (await validate(plainToInstance(PutCartItemDto, { quantity }))).length,
    ).toBeGreaterThan(0);
  });
  it.each(['1e2', '1.0', '-1', '0', '2147483648', 'NaN', ''])(
    'rejects path ID %s',
    (id) => {
      expect(() => new CartVariantIdPipe().transform(id)).toThrow();
    },
  );
  it('accepts PostgreSQL Int boundaries', () => {
    expect(new CartVariantIdPipe().transform('1')).toBe(1);
    expect(new CartVariantIdPipe().transform('2147483647')).toBe(2147483647);
  });
});

describe('Cart per-Buyer rate limiter', () => {
  afterEach(() => vi.restoreAllMocks());
  const header = vi.fn();
  function context(userId: number) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId } }),
        getResponse: () => ({ setHeader: header }),
      }),
    } as ExecutionContext;
  }
  it('limits shared calls, isolates users and expires the window', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const guard = new CartRateLimitGuard(
      new ConfigService({ CART_RATE_LIMIT_PER_MINUTE: '2' }),
    );
    expect(guard.canActivate(context(1))).toBe(true);
    expect(guard.canActivate(context(1))).toBe(true);
    expect(() => guard.canActivate(context(1))).toThrow();
    expect(header).toHaveBeenCalledWith('Retry-After', '60');
    expect(guard.canActivate(context(2))).toBe(true);
    now.mockReturnValue(61_000);
    expect(guard.canActivate(context(1))).toBe(true);
  });
  it.each(['0', '-1', 'NaN', '1.5'])(
    'refuses invalid rate configuration %s',
    (limit) => {
      expect(
        () =>
          new CartRateLimitGuard(
            new ConfigService({ CART_RATE_LIMIT_PER_MINUTE: limit }),
          ),
      ).toThrow();
    },
  );
});

describe('Cart bounded transaction retry', () => {
  const conflict = () =>
    new Prisma.PrismaClientKnownRequestError('test serialization', {
      code: 'P2034',
      clientVersion: '7.10.0',
    });
  function service(config = {}) {
    const transaction = vi.fn();
    return {
      transaction,
      cart: new CartService(
        { $transaction: transaction } as unknown as PrismaService,
        new ConfigService(config),
      ),
    };
  }
  it('retries serialization failure, then returns the successful transaction result', async () => {
    const { transaction, cart } = service();
    transaction
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({ lineCount: 1 });
    await expect(cart.put(1, 1, 1)).resolves.toEqual({ lineCount: 1 });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction.mock.calls[0][1]).toMatchObject({
      isolationLevel: 'Serializable',
    });
  });
  it('ends after five failures with stable CART_WRITE_CONFLICT', async () => {
    const { transaction, cart } = service();
    transaction.mockRejectedValue(conflict());
    await expect(cart.remove(1, 1)).rejects.toMatchObject({
      response: { code: 'CART_WRITE_CONFLICT', statusCode: 409 },
    });
    expect(transaction).toHaveBeenCalledTimes(5);
  });
  it('does not retry unrelated failures', async () => {
    const { transaction, cart } = service();
    const error = new Error('unrelated');
    transaction.mockRejectedValue(error);
    await expect(cart.put(1, 1, 1)).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it('rejects quantity beyond configured policy before database writes', () => {
    const { transaction, cart } = service({ CART_MAX_QUANTITY: '5' });
    expect(() => cart.put(1, 1, 6)).toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each(['0', '100', '-1', 'abc', '1.5'])(
    'refuses invalid quantity configuration %s',
    (value) => {
      expect(() => service({ CART_MAX_QUANTITY: value })).toThrow();
    },
  );
});
