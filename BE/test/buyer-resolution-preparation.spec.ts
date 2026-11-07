// Pure fixture/guard self-tests. NO resolver HTTP, DB or transaction proof.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buyerCancellationFixtureInput,
  buyerCompletionFixtureInput,
  buyerResolutionFixtureTarget,
} from './helpers/buyer-resolution-fixture-plan.js';

const identity = {
  actorId: 7,
  orderId: 101,
  idempotencyKey: 'buyer-recovery-qa-key-001',
} as const;
const reason = {
  reasonCode: 'CHANGED_MIND',
  reasonText: 'Tôi đổi ý mua hàng',
} as const;

describe('Buyer recovery fixture preparation — no runtime acceptance', () => {
  it('uses merged cancellation normalization and canonical hash', () => {
    const p = buyerCancellationFixtureInput(identity, {
      ...reason,
      reasonText: ` \n${reason.reasonText}\t `,
    });
    expect(p).toMatchObject({
      actorId: 7,
      actorType: 'BUYER',
      actorScope: 'USER:7',
      orderId: 101,
      command: 'cancel',
      hashVersion: 1,
      body: reason,
      requestHash:
        '5c7e4d7ab866c3dd0cd08449c4484077ba73dfc7c81009b98549c20af453f412',
    });
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.body)).toBe(true);
  });
  it('uses merged Buyer completion identity, not SYSTEM identity', () => {
    expect(buyerCompletionFixtureInput(identity)).toMatchObject({
      actorId: 7,
      actorType: 'BUYER',
      actorScope: 'USER:7',
      orderId: 101,
      hashVersion: 1,
      requestHash:
        '1ae432f016f4b068acdb4ec4be611a2716e30c499b7ae8fbfc217295cf7df861',
    });
  });
  it('keeps the original key for replay while a new key does not change payload hash', () => {
    const a = buyerCancellationFixtureInput(identity, reason);
    const b = buyerCancellationFixtureInput(identity, reason);
    const c = buyerCancellationFixtureInput(
      { ...identity, idempotencyKey: 'buyer-recovery-qa-key-002' },
      reason,
    );
    expect(a).toEqual(b);
    expect(a.requestHash).toBe(c.requestHash);
    expect(a.idempotencyKey).not.toBe(c.idempotencyKey);
    // Same hash under a NEW key does not prove the original key has settled.
  });
  it.each(['actorId', 'orderId'] as const)(
    'changing %s changes canonical hash',
    (field) => {
      const first = buyerCancellationFixtureInput(identity, reason);
      const other = buyerCancellationFixtureInput(
        { ...identity, [field]: 999 },
        reason,
      );
      expect(first.requestHash).not.toBe(other.requestHash);
    },
  );
  it('distinguishes reason/code/command and does not Unicode-normalize text', () => {
    const a = buyerCancellationFixtureInput(identity, reason);
    expect(a.requestHash).not.toBe(
      buyerCompletionFixtureInput(identity).requestHash,
    );
    expect(a.requestHash).not.toBe(
      buyerCancellationFixtureInput(identity, {
        ...reason,
        reasonCode: 'OTHER',
      }).requestHash,
    );
    expect(a.requestHash).not.toBe(
      buyerCancellationFixtureInput(identity, {
        ...reason,
        reasonText: 'Lý do khác',
      }).requestHash,
    );
    const nfc = buyerCancellationFixtureInput(identity, {
      ...reason,
      reasonText: 'é',
    });
    const nfd = buyerCancellationFixtureInput(identity, {
      ...reason,
      reasonText: 'e\u0301',
    });
    expect(nfc.requestHash).not.toBe(nfd.requestHash);
  });
  it('canonical hash equals the actual normalized payload, not raw input JSON', () => {
    const p = buyerCancellationFixtureInput(identity, reason);
    const canonical = JSON.stringify({
      actorScope: 'USER:7',
      body: p.body,
      command: 'cancel',
      orderId: 101,
    });
    expect(createHash('sha256').update(canonical, 'utf8').digest('hex')).toBe(
      p.requestHash,
    );
  });
  it.each([0, -1, 1.5, 2147483648, NaN])(
    'rejects invalid IDs %s in both builders',
    (actorId) => {
      expect(() =>
        buyerCancellationFixtureInput({ ...identity, actorId }, reason),
      ).toThrow();
      expect(() =>
        buyerCompletionFixtureInput({ ...identity, actorId }),
      ).toThrow();
      expect(() =>
        buyerCancellationFixtureInput(
          { ...identity, orderId: actorId },
          reason,
        ),
      ).toThrow();
      expect(() =>
        buyerCompletionFixtureInput({ ...identity, orderId: actorId }),
      ).toThrow();
    },
  );
  it.each(['', 'short', 'a'.repeat(129), 'invalid key with spaces'])(
    'rejects invalid original key %#',
    (idempotencyKey) => {
      expect(() =>
        buyerCancellationFixtureInput({ ...identity, idempotencyKey }, reason),
      ).toThrow();
      expect(() =>
        buyerCompletionFixtureInput({ ...identity, idempotencyKey }),
      ).toThrow();
    },
  );
  it('accepts a dedicated target without connecting or returning credentials', () => {
    expect(
      buyerResolutionFixtureTarget(
        'postgresql://qa:fixture-only@127.0.0.1:5549/bckl_order_resolution_test_buyer_prep?schema=public',
      ),
    ).toBeUndefined();
  });
  it.each([
    undefined,
    '',
    'not-a-url',
    'postgresql://qa:do-not-log@127.0.0.1:5432/bckl_order_resolution_test_buyer',
    'postgresql://qa:do-not-log@127.0.0.1:5549/klcn_ecommerce',
    'postgresql://qa:do-not-log@remote.example:5549/bckl_order_resolution_test_buyer',
    'postgresql://qa:do-not-log@127.0.0.1:5549/bckl_order_resolution_test_buyer?options=x',
  ])('rejects unsafe target %# without logging credentials', (target) => {
    expect(() => buyerResolutionFixtureTarget(target)).toThrow(
      'Dedicated loopback order-resolution test database on port 5549 required',
    );
    try {
      buyerResolutionFixtureTarget(target);
    } catch (error) {
      expect((error as Error).message).not.toContain('do-not-log');
    }
  });
});
