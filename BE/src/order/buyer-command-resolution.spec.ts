import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import type { OrderCommand, Prisma } from '@prisma/client';
import {
  buyerResolutionInput,
  assertCompleteFingerprint,
  replayBuyerReceipt,
} from './buyer-command-resolution-request.js';
import { completeInput } from './order-completion-request.js';
import { prepareOrderCommand } from './order-command-request.js';
import { assertOrderCommandNotClosed } from './order-command-fence.js';

const key = 'buyer_original_request_key';
const body = {
  reasonCode: 'CHANGED_MIND',
  reasonText: '  Tôi đổi ý mua hàng  ',
};
const prepared = prepareOrderCommand({
  actorId: 7,
  actorType: 'BUYER',
  orderId: 101,
  command: 'cancel',
  idempotencyKey: key,
  body,
});
const raw = {
  command: 'cancel',
  hashVersion: 1,
  requestHash: prepared.requestHash,
};
const input = () => buyerResolutionInput(7, 101, key, raw);
const time = '2026-01-01T00:00:01.000Z';
function stored(): OrderCommand {
  return {
    id: 1,
    orderId: 101,
    actorId: 7,
    actorScope: 'USER:7',
    actorType: 'BUYER',
    command: 'cancel',
    idempotencyKey: key,
    hashVersion: 1,
    requestHash: prepared.requestHash,
    status: 'SUCCEEDED',
    responseStatus: 200,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: new Date(time),
    resultSnapshot: {
      status: 'CANCELLED',
      payment: {
        provider: 'COD',
        status: 'CANCELLED',
        amount: '10000.00',
        currency: 'VND',
        paidAt: null,
      },
      cancellation: {
        cancelledBy: { type: 'BUYER', id: 7 },
        reasonCode: 'CHANGED_MIND',
        reasonText: body.reasonText.trim(),
        cancelledAt: time,
      },
      timeline: [
        {
          fromStatus: 'PENDING_CONFIRMATION',
          toStatus: 'CANCELLED',
          actorType: 'BUYER',
          actorId: 7,
          reasonCode: 'CHANGED_MIND',
          reasonText: body.reasonText.trim(),
          createdAt: time,
        },
      ],
    },
  };
}
describe('Buyer resolver strict request, receipts and five-writer fence', () => {
  it('all three reviewed #69 vectors match execution builders and independent WebCrypto', async () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          '../../../docs/api/examples/buyer-command-recovery-proposed-v1.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      vectors: {
        actorId: number;
        orderId: number;
        command: 'cancel' | 'complete';
        body: unknown;
        canonical: string;
        requestHash: string;
      }[];
    };
    expect(fixture.vectors).toHaveLength(3);
    for (const v of fixture.vectors) {
      const canonical = JSON.stringify({
        actorScope: `USER:${v.actorId}`,
        body: v.body,
        command: v.command,
        orderId: v.orderId,
      });
      expect(canonical).toBe(v.canonical);
      const digest = Buffer.from(
        await webcrypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(canonical),
        ),
      ).toString('hex');
      expect(digest).toBe(v.requestHash);
      const actual =
        v.command === 'complete'
          ? completeInput(v.actorId, v.orderId, key, v.body)
          : prepareOrderCommand({
              actorId: v.actorId,
              actorType: 'BUYER',
              orderId: v.orderId,
              command: 'cancel',
              idempotencyKey: key,
              body: v.body,
            });
      expect(actual.requestHash).toBe(v.requestHash);
      expect(
        buyerResolutionInput(v.actorId, v.orderId, key, {
          command: v.command,
          hashVersion: 1,
          requestHash: v.requestHash,
        }).requestHash,
      ).toBe(digest);
    }
  });
  it('accepts exact metadata only', () =>
    expect(input()).toMatchObject({
      actorId: 7,
      command: 'cancel',
      requestHash: prepared.requestHash,
    }));
  it.each([
    null,
    [],
    {},
    { ...raw, actorId: 7 },
    { ...raw, reasonText: 'secret' },
    { ...raw, command: 'confirm' },
    { ...raw, hashVersion: true },
    { ...raw, hashVersion: '1' },
    { ...raw, hashVersion: 2 },
    { ...raw, requestHash: 'a'.repeat(63) },
    { ...raw, requestHash: 'a'.repeat(64) + '\n' },
    { ...raw, requestHash: 'A'.repeat(64) },
  ])('rejects invalid body %#', (v) =>
    expect(() => buyerResolutionInput(7, 101, key, v)).toThrow(),
  );
  it.each([
    undefined,
    null,
    ['buyer_original_request_key'],
    'a'.repeat(15),
    'a'.repeat(129),
    'a'.repeat(16) + '\n',
  ])('rejects invalid key %#', (k) =>
    expect(() => buyerResolutionInput(7, 101, k, raw)).toThrow(),
  );
  it.each([0, -1, 1.5, 2147483648, NaN])('rejects invalid path ID %#', (id) =>
    expect(() => buyerResolutionInput(7, id, key, raw)).toThrow(),
  );
  it('recomputes complete hash but does not pretend to verify no-record cancel reason', () => {
    const canonical = completeInput(7, 101, key, {});
    expect(() =>
      assertCompleteFingerprint(
        { ...input(), command: 'complete', requestHash: canonical.requestHash },
        400,
      ),
    ).not.toThrow();
    expect(() =>
      assertCompleteFingerprint({ ...input(), command: 'complete' }, 400),
    ).toThrow();
    expect(() => assertCompleteFingerprint(input(), 400)).not.toThrow();
  });
  it('replays original snapshot unchanged, not live Order', () =>
    expect(replayBuyerReceipt(stored(), input()).result).toEqual(
      stored().resultSnapshot,
    ));
  it('detects a valid-shaped changed reason via canonical hash', () => {
    const s = stored();
    const snapshot = s.resultSnapshot as {
      cancellation: { reasonText: string };
      timeline: { reasonText: string }[];
    };
    snapshot.cancellation.reasonText = 'changed';
    snapshot.timeline[0]!.reasonText = 'changed';
    expect(() => replayBuyerReceipt(s, input())).toThrow();
  });
  it.each([
    { orderId: 102 },
    { command: 'complete' },
    { requestHash: 'b'.repeat(64) },
    { actorType: 'SELLER' },
    { actorScope: 'USER:9' },
    { actorId: 9 },
    { hashVersion: 2 },
    { resultSnapshot: {} },
    { responseStatus: 201 },
    { completedAt: null },
  ])('rejects wrong/corrupt receipt %#', (change) =>
    expect(() =>
      replayBuyerReceipt({ ...stored(), ...change } as OrderCommand, input()),
    ).toThrow(),
  );
  it('PROCESSING is not a committed result', () =>
    expect(() =>
      replayBuyerReceipt({ ...stored(), status: 'PROCESSING' }, input()),
    ).toThrow());
  it.each(['cancel', 'complete'])(
    'valid Buyer fence %s blocks all late writers',
    async (command) => {
      const identity = { ...input(), command };
      const closed = {
        ...identity,
        actorType: 'BUYER',
        id: 3,
        resolvedAt: new Date(),
      };
      const tx = {
        orderCommandResolution: {
          findUnique: vi.fn().mockResolvedValue(closed),
        },
      } as unknown as Prisma.TransactionClient;
      await expect(
        assertOrderCommandNotClosed(tx, identity, false),
      ).rejects.toMatchObject({ response: { code: 'ORDER_COMMAND_CLOSED' } });
      await expect(
        assertOrderCommandNotClosed(
          tx,
          { ...identity, actorType: 'SELLER' },
          false,
        ),
      ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
      await expect(
        assertOrderCommandNotClosed(
          tx,
          { ...identity, actorType: 'ADMIN' },
          false,
        ),
      ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
      await expect(
        assertOrderCommandNotClosed(tx, identity, true),
      ).rejects.toMatchObject({ response: { code: 'INTERNAL_ERROR' } });
    },
  );
  it('invalid stored actor/command pair fails closed before identity comparison', async () => {
    const tx = {
      orderCommandResolution: {
        findUnique: vi.fn().mockResolvedValue({
          ...input(),
          id: 1,
          actorType: 'BUYER',
          command: 'confirm',
          resolvedAt: new Date(),
        }),
      },
    } as unknown as Prisma.TransactionClient;
    await expect(
      assertOrderCommandNotClosed(tx, input(), false),
    ).rejects.toMatchObject({ response: { code: 'INTERNAL_ERROR' } });
  });
});
