import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  AttributeTransactionBoundary,
  isAttributeTransactionConflict,
} from './attribute-transaction-boundary.js';
import type { PrismaService } from '../prisma.service.js';

const scope = {
  actorId: 1,
  categoryId: 2,
  definitionId: 3,
  expectedRevision: 1,
};
const known = (code: string, meta?: Prisma.JsonObject) =>
  new Prisma.PrismaClientKnownRequestError('test-only', {
    code,
    clientVersion: '7.10.0',
    meta,
  });
describe('Attribute transaction preparation bounds', () => {
  it.each([
    { actorId: 0 },
    { actorId: '1' },
    { actorId: Number.NaN },
    { categoryId: 0 },
    { categoryId: 2147483648 },
    { categoryId: 1.25 },
  ])(
    'rejects invalid create scope before opening a transaction: %o',
    async (invalid) => {
      const transaction = vi.fn();
      const boundary = new AttributeTransactionBoundary(
        { $transaction: transaction } as unknown as PrismaService,
        { enqueueCategory: vi.fn() },
      );
      await expect(
        boundary.createDefinition(
          { actorId: 1, categoryId: 2, ...invalid } as unknown as {
            actorId: number;
            categoryId: number;
          },
          vi.fn(),
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('bounds create retries and does not invoke the planner outside a transaction', async () => {
    const transaction = vi.fn().mockRejectedValue(known('P2034'));
    const prepare = vi.fn();
    const boundary = new AttributeTransactionBoundary(
      { $transaction: transaction } as unknown as PrismaService,
      { enqueueCategory: vi.fn() },
    );
    await expect(
      boundary.createDefinition({ actorId: 1, categoryId: 2 }, prepare),
    ).rejects.toMatchObject({ status: 503 });
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('does not retry a create uniqueness constraint violation', async () => {
    const error = known('P2002');
    const transaction = vi.fn().mockRejectedValue(error);
    const boundary = new AttributeTransactionBoundary(
      { $transaction: transaction } as unknown as PrismaService,
      { enqueueCategory: vi.fn() },
    );
    await expect(
      boundary.createDefinition({ actorId: 1, categoryId: 2 }, vi.fn()),
    ).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledOnce();
  });
  it.each([
    { actorId: 0 },
    { actorId: -1 },
    { categoryId: 1.5 },
    { categoryId: Number.NaN },
    { definitionId: Number.POSITIVE_INFINITY },
    { definitionId: 2147483648 },
    { expectedRevision: 0 },
    { expectedRevision: '1' },
    { optionId: null },
    { optionId: 0 },
  ])(
    'rejects invalid scope before opening a transaction: %o',
    async (invalid) => {
      const transaction = vi.fn();
      const boundary = new AttributeTransactionBoundary(
        { $transaction: transaction } as unknown as PrismaService,
        { enqueueCategory: vi.fn() },
      );
      await expect(
        boundary.run(
          { ...scope, ...invalid } as unknown as typeof scope,
          vi.fn(),
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    [known('P2034'), true],
    [known('P2010', { code: '40001' }), true],
    [known('P2010', { code: '40P01' }), true],
    [
      known('P2010', {
        driverAdapterError: { cause: { originalCode: '40001' } },
      }),
      true,
    ],
    [known('P2010', { code: '55P03' }), false],
    [known('P2010', { code: '57014' }), false],
    [known('P2010', { code: '23514' }), false],
    [known('P2002'), false],
    [new ConflictException(), false],
    [
      Object.assign(new Error('not a recognized adapter error'), {
        code: '40001',
      }),
      false,
    ],
  ])('classifies only known retryable errors (%s)', (error, expected) => {
    expect(isAttributeTransactionConflict(error)).toBe(expected);
  });
  it('stops after three serialization failures rather than looping forever', async () => {
    const transaction = vi.fn().mockRejectedValue(known('P2034'));
    const work = vi.fn();
    const boundary = new AttributeTransactionBoundary(
      { $transaction: transaction } as unknown as PrismaService,
      { enqueueCategory: vi.fn() },
    );
    await expect(boundary.run(scope, work)).rejects.toMatchObject({
      status: 503,
    });
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(work).not.toHaveBeenCalled();
  });
  it('does not retry a stale-revision business conflict', async () => {
    const error = new ConflictException({
      code: 'ATTRIBUTE_REVISION_CONFLICT',
    });
    const transaction = vi.fn().mockRejectedValue(error);
    const boundary = new AttributeTransactionBoundary(
      { $transaction: transaction } as unknown as PrismaService,
      { enqueueCategory: vi.fn() },
    );
    await expect(boundary.run(scope, vi.fn())).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledOnce();
  });
});
