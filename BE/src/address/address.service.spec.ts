import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';
import { PrismaService } from '../prisma.service.js';
import { AddressService } from './address.service.js';
import { waitForTransactionRetry } from '../product/transaction-conflict.js';

vi.mock('../product/transaction-conflict.js', async (original) => ({
  ...(await original<typeof import('../product/transaction-conflict.js')>()),
  waitForTransactionRetry: vi.fn().mockResolvedValue(undefined),
}));

describe('Address bounded retry', () => {
  beforeEach(() => vi.clearAllMocks());
  const conflict = () =>
    new Prisma.PrismaClientKnownRequestError('test serialization', {
      code: 'P2034',
      clientVersion: '7.10.0',
    });
  function setup() {
    const transaction = vi.fn();
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    return {
      service: new AddressService(prisma, new ConfigService()),
      transaction,
    };
  }

  it('retries serialization conflicts but commits only the successful attempt', async () => {
    const { service, transaction } = setup();
    transaction
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({ id: 1 });
    await expect(service.setDefault(1, 1)).resolves.toEqual({ id: 1 });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(waitForTransactionRetry).toHaveBeenCalledTimes(1);
  });

  it('stops after five attempts with a documented safe conflict error', async () => {
    const { service, transaction } = setup();
    transaction.mockRejectedValue(conflict());
    await expect(service.setDefault(1, 1)).rejects.toMatchObject({
      response: { statusCode: 409, code: 'ADDRESS_WRITE_CONFLICT' },
    });
    expect(transaction).toHaveBeenCalledTimes(5);
    expect(waitForTransactionRetry).toHaveBeenCalledTimes(4);
  });

  it('does not retry unrelated DB or validation errors', async () => {
    const { service, transaction } = setup();
    const error = new Prisma.PrismaClientKnownRequestError('test FK', {
      code: 'P2003',
      clientVersion: '7.10.0',
    });
    transaction.mockRejectedValue(error);
    await expect(service.setDefault(1, 1)).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(waitForTransactionRetry).not.toHaveBeenCalled();
  });

  it('rejects empty PATCH before starting a write', async () => {
    const { service, transaction } = setup();
    expect(() => service.update(1, 1, {})).toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid address limit configuration at startup', () => {
    for (const value of ['0', '-1', '1.5', 'not-a-number'])
      expect(
        () =>
          new AddressService(
            {} as PrismaService,
            new ConfigService({ ADDRESS_MAX_PER_USER: value }),
          ),
      ).toThrow('ADDRESS_MAX_PER_USER');
  });
});
