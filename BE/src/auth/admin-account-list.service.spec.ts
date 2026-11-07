import { describe, expect, it, vi } from 'vitest';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AdminAccountListService } from './admin-account-list.service.js';

describe('Admin account list transaction boundaries', () => {
  function setup(actor: { role: Role; isActive: boolean } | null) {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      user: {
        findUnique: vi.fn().mockResolvedValue(actor),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const database = {
      $transaction: vi.fn(
        async (run: (client: typeof tx) => unknown, _options?: unknown) =>
          run(tx),
      ),
    };
    const service = new AdminAccountListService(
      database as unknown as PrismaService,
    );
    return { tx, database, service };
  }
  it('uses read-only bounded RepeatableRead and explicit data projection', async () => {
    const { tx, database, service } = setup({
      role: Role.ADMIN,
      isActive: true,
    });
    expect(await service.list(7, { limit: 1, q: 'x%_\\', afterId: 5 })).toEqual(
      { items: [], nextCursor: null },
    );
    expect(database.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 7000,
      maxWait: 2000,
    });
    expect(
      tx.$executeRaw.mock.calls.map((call) => Array.from(call[0]).join('')),
    ).toEqual([
      'SET TRANSACTION READ ONLY',
      "SET LOCAL statement_timeout = '5s'",
    ]);
    const query = tx.user.findMany.mock.calls[0][0];
    expect(query.take).toBe(2);
    expect(query.where.OR[0].email.contains).toBe('x\\%\\_\\\\');
    expect(Object.keys(query.select).sort()).toEqual([
      'createdAt',
      'email',
      'fullName',
      'id',
      'isActive',
      'role',
      'store',
      'updatedAt',
    ]);
  });
  it.each([
    null,
    { role: Role.ADMIN, isActive: false },
    { role: Role.USER, isActive: true },
  ])(
    'does not read list when current transactional actor is %j',
    async (actor) => {
      const { tx, service } = setup(actor);
      await expect(service.list(7, { limit: 1 })).rejects.toThrow();
      expect(tx.user.findMany).not.toHaveBeenCalled();
    },
  );
});
