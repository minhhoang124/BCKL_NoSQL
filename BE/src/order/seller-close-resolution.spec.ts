import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Prisma, type OrderCommand } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  sellerCloseResolutionInput,
  replaySellerCloseReceipt,
} from './seller-close-resolution-request.js';
import { SellerCloseResolutionService } from './seller-close-resolution.service.js';
import { prepareOrderCommand } from './order-command-request.js';
import { prepareReturnedCommand } from './order-returned-request.js';
import type { PrismaService } from '../prisma.service.js';

const key = 'seller_original_close_key';
const time = '2026-10-30T08:00:00.000Z';
type Command = 'cancel' | 'confirm-returned';
function execution(command: Command = 'cancel', restockable = true) {
  return command === 'cancel'
    ? prepareOrderCommand({
        actorId: 8,
        actorType: 'SELLER',
        orderId: 101,
        command: 'cancel',
        idempotencyKey: key,
        body: { reasonCode: 'OTHER', reasonText: '  Lý do cũ  ' },
      })
    : prepareReturnedCommand(8, 'SELLER', 101, key, {
        reasonCode: restockable ? 'RETURN_RECEIVED' : 'DAMAGED',
        reasonText: '  Hàng đã về  ',
        restockable,
        receiptReference: ' RECEIPT-1 ',
      });
}
function input(command: Command = 'cancel', restockable = true) {
  return sellerCloseResolutionInput(8, 101, key, {
    command,
    hashVersion: 1,
    requestHash: execution(command, restockable).requestHash,
  });
}
function stored(command: Command = 'cancel', restockable = true): OrderCommand {
  const prepared = execution(command, restockable),
    body = prepared.body as {
      reasonCode: string;
      reasonText: string;
      receiptReference?: string;
      restockable?: boolean;
    };
  const returned = command === 'confirm-returned';
  return {
    id: 1,
    orderId: 101,
    actorId: 8,
    actorScope: 'USER:8',
    actorType: 'SELLER',
    command,
    idempotencyKey: key,
    hashVersion: 1,
    requestHash: prepared.requestHash,
    status: 'SUCCEEDED',
    responseStatus: 200,
    createdAt: new Date(time),
    completedAt: new Date(time),
    resultSnapshot: {
      status: 'CANCELLED',
      payment: {
        provider: 'COD',
        status: 'CANCELLED',
        amount: '20000.00',
        currency: 'VND',
        paidAt: null,
      },
      cancellation: {
        cancelledBy: { type: 'SELLER', id: 8 },
        reasonCode: body.reasonCode,
        reasonText: body.reasonText,
        cancelledAt: time,
      },
      ...(returned
        ? {
            restockable,
            receiptReference: 'RECEIPT-1',
            delivery: {
              deliveryAttempt: 2,
              retryCount: 1,
              trackingReference: 'TRACK-2',
            },
          }
        : {}),
      timeline: [
        {
          fromStatus: returned ? 'DELIVERY_FAILED' : 'CONFIRMED',
          toStatus: 'CANCELLED',
          actorType: 'SELLER',
          actorId: 8,
          reasonCode: body.reasonCode,
          reasonText: body.reasonText,
          ...(returned
            ? {
                restockable,
                receiptReference: 'RECEIPT-1',
                deliveryAttempt: 2,
                trackingReference: 'TRACK-2',
              }
            : {}),
          createdAt: time,
        },
      ],
    },
  };
}
function closed(command: Command = 'cancel') {
  return { ...input(command), id: 4, resolvedAt: new Date(time) };
}
function harness() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: {
      findUnique: vi.fn().mockResolvedValue({ isActive: true, role: 'SELLER' }),
    },
    order: { findFirst: vi.fn().mockResolvedValue({ id: 101, storeId: 4 }) },
    orderCommand: { findUnique: vi.fn().mockResolvedValue(null) },
    orderCommandResolution: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: { data: object }) => ({
        id: 4,
        ...data,
        resolvedAt: new Date(time),
      })),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (t: unknown) => unknown, _options?: unknown) =>
        callback(tx),
    ),
  };
  const service = new SellerCloseResolutionService(
    prisma as unknown as PrismaService,
    new ConfigService({}),
  );
  const run = (command: Command = 'cancel') => {
    const i = input(command);
    return service.resolve(i.actorId, i.orderId, i.idempotencyKey, {
      command,
      hashVersion: 1,
      requestHash: i.requestHash,
    });
  };
  return { tx, prisma, service, run };
}

describe('Seller close resolution metadata and immutable receipt provenance', () => {
  it.each(['cancel', 'confirm-returned'] as const)(
    'accepts only exact metadata for %s',
    (command) => {
      expect(input(command)).toMatchObject({
        actorId: 8,
        actorType: 'SELLER',
        actorScope: 'USER:8',
        orderId: 101,
        command,
        idempotencyKey: key,
        hashVersion: 1,
      });
      expect(Object.keys(input(command))).not.toContain('body');
    },
  );
  const raw = {
    command: 'cancel',
    hashVersion: 1,
    requestHash: 'a'.repeat(64),
  };
  it.each([
    null,
    [],
    {},
    { ...raw, actorId: 8 },
    { ...raw, reasonText: 'lost body' },
    { ...raw, command: 'complete' },
    { ...raw, command: 'confirm' },
    { ...raw, hashVersion: true },
    { ...raw, hashVersion: '1' },
    { ...raw, requestHash: 'A'.repeat(64) },
    { ...raw, requestHash: 'a'.repeat(63) },
    { ...raw, requestHash: 'a'.repeat(64) + '\n' },
    Object.create(raw),
    { ...raw, [Symbol('extra')]: true },
  ])('rejects invalid metadata %#', (body) => {
    expect(() => sellerCloseResolutionInput(8, 101, key, body)).toThrow();
  });
  it.each([
    undefined,
    null,
    [key],
    'a'.repeat(15),
    'a'.repeat(129),
    key + '\n',
  ])('rejects invalid original key %#', (value) => {
    expect(() => sellerCloseResolutionInput(8, 101, value, raw)).toThrow();
  });
  it.each([0, -1, 1.5, 2147483648, NaN])(
    'rejects invalid actor/order identity %#',
    (value) => {
      expect(() => sellerCloseResolutionInput(value, 101, key, raw)).toThrow();
      expect(() => sellerCloseResolutionInput(8, value, key, raw)).toThrow();
    },
  );
  it('preserves meaningful false in independent canonical returned hash', () => {
    const canonical =
      '{"actorScope":"USER:8","body":{"reasonCode":"DAMAGED","reasonText":"Hàng đã về","receiptReference":"RECEIPT-1","restockable":false},"command":"confirm-returned","orderId":101}';
    expect(input('confirm-returned', false).requestHash).toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    );
    expect(input('confirm-returned', false).requestHash).not.toBe(
      input('confirm-returned', true).requestHash,
    );
  });
  it.each(['cancel', 'confirm-returned'] as const)(
    'replays original %s snapshot without live Order state',
    (command) => {
      const commandRow = stored(command);
      expect(replaySellerCloseReceipt(commandRow, input(command))).toEqual({
        orderId: 101,
        commandId: 1,
        command,
        replayed: true,
        result: commandRow.resultSnapshot,
      });
    },
  );
  it('replays damaged receipt with restockable:false', () => {
    expect(
      replaySellerCloseReceipt(
        stored('confirm-returned', false),
        input('confirm-returned', false),
      ).result,
    ).toMatchObject({ restockable: false, receiptReference: 'RECEIPT-1' });
  });
  it.each([
    { actorId: 9 },
    { actorScope: 'USER:9' },
    { hashVersion: 2 },
    { orderId: 102 },
    { command: 'complete' },
    { actorType: 'BUYER' },
    { idempotencyKey: 'other_original_key' },
    { requestHash: 'b'.repeat(64) },
    { resultSnapshot: {} },
    { responseStatus: 201 },
    { completedAt: null },
    { completedAt: new Date(NaN) },
    { id: 0 },
  ])('rejects mismatched or corrupt stored receipt %#', (change) => {
    expect(() =>
      replaySellerCloseReceipt(
        { ...stored(), ...change } as OrderCommand,
        input(),
      ),
    ).toThrow();
  });
  it('PROCESSING is not proof of committed execution', () => {
    expect(() =>
      replaySellerCloseReceipt({ ...stored(), status: 'PROCESSING' }, input()),
    ).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'ORDER_COMMAND_IN_PROGRESS',
        }),
      }),
    );
  });
  it.each(['cancel', 'confirm-returned'] as const)(
    'detects valid-shaped changed %s reason even if cancellation and timeline agree',
    (command) => {
      const commandRow = stored(command);
      const snapshot = commandRow.resultSnapshot as {
        cancellation: { reasonText: string };
        timeline: { reasonText: string }[];
      };
      snapshot.cancellation.reasonText = 'Different reason';
      snapshot.timeline[0]!.reasonText = 'Different reason';
      expect(() =>
        replaySellerCloseReceipt(commandRow, input(command)),
      ).toThrow();
    },
  );
  it('rejects forged matching input/stored hash that does not describe the snapshot body', () => {
    expect(() =>
      replaySellerCloseReceipt(
        { ...stored(), requestHash: 'a'.repeat(64) },
        { ...input(), requestHash: 'a'.repeat(64) },
      ),
    ).toThrow();
  });
  it('rejects Seller LOST even with otherwise consistent snapshot/hash fields', () => {
    const commandRow = stored('confirm-returned', false);
    const snapshot = commandRow.resultSnapshot as {
      cancellation: { reasonCode: string };
      timeline: { reasonCode: string }[];
    };
    snapshot.cancellation.reasonCode = 'LOST';
    snapshot.timeline[0]!.reasonCode = 'LOST';
    expect(() =>
      replaySellerCloseReceipt(commandRow, input('confirm-returned', false)),
    ).toThrow();
  });
});

describe('Seller close resolver transaction boundary (mocked SQL, not DB acceptance)', () => {
  it('authorizes and locks canonical ownership before reading outcomes', async () => {
    const h = harness();
    await h.run();
    const sql = h.tx.$queryRaw.mock.calls.map((call) =>
      (call[0] as unknown as string[]).join('?'),
    );
    expect(sql[2]).toMatch(/users.*FOR UPDATE/);
    expect(sql[3]).toMatch(/stores.*FOR SHARE/);
    expect(sql[4]).toMatch(/orders.*FOR UPDATE/);
    expect(h.prisma.$transaction.mock.calls[0]?.[1]).toMatchObject({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 2000,
    });
    expect(
      h.tx.orderCommand.findUnique.mock.invocationCallOrder[0],
    ).toBeGreaterThan(h.tx.order.findFirst.mock.invocationCallOrder[1]!);
  });
  it.each([
    ['inactive', 401],
    ['wrong-role', 403],
    ['foreign-order', 404],
  ] as const)('blocks %s before receipt/fence lookup', async (kind, status) => {
    const h = harness();
    if (kind === 'inactive')
      h.tx.user.findUnique.mockResolvedValue({
        isActive: false,
        role: 'SELLER',
      });
    if (kind === 'wrong-role')
      h.tx.user.findUnique.mockResolvedValue({ isActive: true, role: 'USER' });
    if (kind === 'foreign-order')
      h.tx.order.findFirst.mockResolvedValue(null as never);
    await expect(h.run()).rejects.toMatchObject({
      response: { statusCode: status },
    });
    expect(h.tx.orderCommand.findUnique).not.toHaveBeenCalled();
    expect(h.tx.orderCommandResolution.create).not.toHaveBeenCalled();
  });
  it('rechecks ownership after locks and does not expose receipt when relation changed', async () => {
    const h = harness();
    h.tx.order.findFirst
      .mockResolvedValueOnce({ id: 101, storeId: 4 })
      .mockResolvedValueOnce(null as never);
    await expect(h.run()).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_FOUND' },
    });
    expect(h.tx.orderCommand.findUnique).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'confirm-returned'] as const)(
    'returns COMMITTED %s original receipt without creating a fence',
    async (command) => {
      const h = harness();
      h.tx.orderCommand.findUnique.mockResolvedValue(stored(command) as never);
      await expect(h.run(command)).resolves.toMatchObject({
        outcome: 'COMMITTED',
        receipt: { orderId: 101, command, replayed: true },
      });
      expect(h.tx.orderCommandResolution.create).not.toHaveBeenCalled();
    },
  );
  it.each(['cancel', 'confirm-returned'] as const)(
    'closes absent %s key using metadata only, without executing the command',
    async (command) => {
      const h = harness();
      await expect(h.run(command)).resolves.toEqual({
        outcome: 'CLOSED_WITHOUT_EXECUTION',
        resolutionId: 4,
        orderId: 101,
        actorId: 8,
        command,
        hashVersion: 1,
        requestHash: input(command).requestHash,
        resolvedAt: time,
      });
      const data = h.tx.orderCommandResolution.create.mock.calls[0]?.[0].data;
      expect(data).toMatchObject({
        actorScope: 'USER:8',
        idempotencyKey: key,
        command,
        requestHash: input(command).requestHash,
      });
      expect(data).not.toHaveProperty('body');
    },
  );
  it('repeats an existing valid fence idempotently without creating a new one', async () => {
    const h = harness();
    h.tx.orderCommandResolution.findUnique.mockResolvedValue(closed() as never);
    await expect(h.run()).resolves.toMatchObject({
      outcome: 'CLOSED_WITHOUT_EXECUTION',
      resolutionId: 4,
      requestHash: input().requestHash,
    });
    expect(h.tx.orderCommandResolution.create).not.toHaveBeenCalled();
  });
  it('fails closed when both mutually exclusive outcomes exist', async () => {
    const h = harness();
    h.tx.orderCommand.findUnique.mockResolvedValue(stored() as never);
    h.tx.orderCommandResolution.findUnique.mockResolvedValue(closed() as never);
    await expect(h.run()).rejects.toMatchObject({
      response: { code: 'INTERNAL_ERROR' },
    });
    expect(h.tx.orderCommandResolution.create).not.toHaveBeenCalled();
  });
  it('rejects a valid stored fence for a different fingerprint', async () => {
    const h = harness();
    h.tx.orderCommandResolution.findUnique.mockResolvedValue({
      ...closed(),
      requestHash: 'a'.repeat(64),
    } as never);
    await expect(h.run()).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(h.tx.orderCommandResolution.create).not.toHaveBeenCalled();
  });
  it('rejects invalid timeout ordering at construction', () => {
    expect(
      () =>
        new SellerCloseResolutionService(
          {} as PrismaService,
          new ConfigService({
            ORDER_COMMAND_LOCK_TIMEOUT_MS: '3000',
            ORDER_COMMAND_STATEMENT_TIMEOUT_MS: '1000',
          }),
        ),
    ).toThrow();
  });
});
