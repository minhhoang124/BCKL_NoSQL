import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { parseResolutionCommand } from './order-command-resolution.service.js';
import { assertOrderCommandNotClosed } from './order-command-fence.js';
const input = {
  actorType: 'SELLER',
  actorScope: 'USER:8',
  actorId: 8,
  orderId: 10,
  command: 'confirm',
  idempotencyKey: 'original_command_key',
  requestHash: 'a'.repeat(64),
  hashVersion: 1,
};
const fence = { ...input, id: 1, actorType: 'SELLER', resolvedAt: new Date() };
const tx = (value: unknown) =>
  ({
    orderCommandResolution: { findUnique: vi.fn().mockResolvedValue(value) },
  }) as unknown as Prisma.TransactionClient;
describe('Order resolution parser and fence policy', () => {
  it.each(['confirm', 'start-packing', 'ready-to-ship'])(
    'accepts %s',
    (command) => expect(parseResolutionCommand({ command })).toBe(command),
  );
  it.each([
    null,
    [],
    {},
    { command: 'cancel' },
    { command: 'confirm', key: 'new' },
    { command: 1 },
  ])('rejects strict body %#', (body) =>
    expect(() => parseResolutionCommand(body)).toThrow(),
  );
  it('permits unfenced key', async () =>
    expect(
      await assertOrderCommandNotClosed(tx(null), input, false),
    ).toBeUndefined());
  it('same identity blocks execution', async () =>
    await expect(
      assertOrderCommandNotClosed(tx(fence), input, false),
    ).rejects.toMatchObject({ response: { code: 'ORDER_COMMAND_CLOSED' } }));
  it('different identity conflicts', async () =>
    await expect(
      assertOrderCommandNotClosed(
        tx(fence),
        { ...input, command: 'cancel' },
        false,
      ),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } }));
  it('dual outcome fails closed before replay', async () =>
    await expect(
      assertOrderCommandNotClosed(tx(fence), input, true),
    ).rejects.toMatchObject({ response: { code: 'INTERNAL_ERROR' } }));
  it('corrupt identity fails closed', async () =>
    await expect(
      assertOrderCommandNotClosed(
        tx({ ...fence, actorType: 'ADMIN' }),
        input,
        false,
      ),
    ).rejects.toMatchObject({ response: { code: 'INTERNAL_ERROR' } }));
  it('SYSTEM remains independent', async () =>
    expect(
      await assertOrderCommandNotClosed(
        tx(fence),
        { ...input, actorScope: 'SYSTEM:ORDER_AUTO_COMPLETE' },
        false,
      ),
    ).toBeUndefined());
});
