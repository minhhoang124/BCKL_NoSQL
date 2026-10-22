// @vitest-environment node
// Composition regression for #75 + #84. Mocked HTTP, NOT live Web/Backend QA.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuyerIntentJournal } from './buyerIntentJournal';
import { getAuthSessionVersion, setAccessToken } from '../../services/apiClient';
import { assertBuyerResolutionProof, prepareBuyerResolution, sendBuyerResolution } from '../../services/buyerResolutionApi';
import type { VerifiedOrderSession } from './orderCommandCoordinator';

const key = 'original-buyer-review-key-123';
const slot = 'bckl-order-command-journal-v1:7';
const reason = { reasonCode: 'OTHER' as const, reasonText: 'Không còn nhu cầu' };
let session: VerifiedOrderSession | null;
let entries: Map<string, string>;
const journal = () => createBuyerIntentJournal({
  getSession: () => session,
  getStorage: () => ({ getItem: (name: string) => entries.get(name) ?? null, setItem: (name: string, value: string) => { entries.set(name, value); } }),
  keyFactory: () => key,
  now: () => new Date('2026-10-19T00:00:00.000Z'),
});
const closed = (command = 'cancel') => ({ outcome: 'CLOSED_WITHOUT_EXECUTION', resolutionId: 9, orderId: 101, command, resolvedAt: '2026-10-19T01:00:00.000Z' });
const committed = () => ({ outcome: 'COMMITTED', receipt: {
  orderId: 101, commandId: 201, command: 'cancel', replayed: true,
  result: { status: 'CANCELLED', payment: { provider: 'COD', status: 'CANCELLED', amount: '150000.00', currency: 'VND', paidAt: null },
    cancellation: { cancelledBy: { type: 'BUYER', id: 7 }, ...reason, cancelledAt: '2026-10-19T01:00:00.000Z' },
    timeline: [{ fromStatus: 'PENDING_CONFIRMATION', toStatus: 'CANCELLED', actorType: 'BUYER', actorId: 7, ...reason, createdAt: '2026-10-19T01:00:00.000Z' }],
  },
} });
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  entries = new Map();
  setAccessToken('review-only-token', 7);
  session = { actor: { id: 7, role: 'USER' }, isActive: true, version: getAuthSessionVersion() };
});
afterEach(() => { setAccessToken(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Buyer journal -> resolver adapter -> proof composition', () => {
  it.each(['COMMITTED', 'CLOSED_WITHOUT_EXECUTION'])('accepts %s with original journal identity, but does not auto-clear it', async (outcome) => {
    const log = journal();
    const pending = await log.prepareNew({ orderId: 101, command: 'cancel', body: reason, confirmed: true });
    const raw = entries.get(slot);
    expect(raw).not.toContain(reason.reasonText);
    expect(raw).not.toContain('reasonCode');
    expect(pending.requestHash).toBe('2b90ed0146392f084a1bf552011433676b85558f772f2421003b82ca7dbe0239');
    const expected = { ...pending, total: '150000.00' };
    const transport = vi.fn().mockResolvedValue(reply(outcome === 'COMMITTED' ? committed() : closed()));
    vi.stubGlobal('fetch', transport);
    const result = await sendBuyerResolution(prepareBuyerResolution(expected));
    expect(() => assertBuyerResolutionProof(result, expected)).not.toThrow();
    expect(() => assertBuyerResolutionProof(structuredClone(result), expected)).toThrow();
    expect(entries.get(slot)).toBe(raw);
    expect(journal().pending()).toEqual(pending);
    await expect(log.prepareNew({ orderId: 101, command: 'cancel', body: reason, confirmed: true })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(['network', 'invalid200', 'http500'])('keeps the original pending record on %s without automatic replay', async (kind) => {
    const log = journal();
    const pending = await log.prepareNew({ orderId: 101, command: 'cancel', body: reason, confirmed: true });
    const raw = entries.get(slot);
    const transport = kind === 'network' ? vi.fn().mockRejectedValue(new TypeError('offline'))
      : vi.fn().mockResolvedValue(reply(kind === 'invalid200' ? { ...closed(), orderId: 102 } : { message: 'safe error' }, kind === 'http500' ? 500 : 200));
    vi.stubGlobal('fetch', transport);
    await expect(sendBuyerResolution(prepareBuyerResolution({ ...pending, total: '150000.00' }))).rejects.toThrow();
    expect(entries.get(slot)).toBe(raw);
    expect(journal().pending()).toEqual(pending);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('preserves old account storage and rejects its delayed response after account switch', async () => {
    const pending = await journal().prepareNew({ orderId: 101, command: 'cancel', body: reason, confirmed: true });
    const raw = entries.get(slot);
    let release!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const result = sendBuyerResolution(prepareBuyerResolution({ ...pending, total: '150000.00' }));
    const rejection = expect(result).rejects.toThrow();
    setAccessToken('different-review-account', 8);
    session = { actor: { id: 8, role: 'USER' }, isActive: true, version: getAuthSessionVersion() };
    release(reply(closed()));
    await rejection;
    expect(entries.get(slot)).toBe(raw);
    expect(journal().pending()).toBeNull();
  });
  it('upgrades legacy complete without changing key and composes its canonical hash with resolver', async () => {
    entries.set(slot, JSON.stringify({ schemaVersion: 1, actorId: 7, role: 'USER', orderId: 101, command: 'complete', idempotencyKey: key, createdAt: '2026-10-19T00:00:00.000Z' }));
    const pending = await journal().upgradeLegacyComplete();
    expect(pending.idempotencyKey).toBe(key);
    expect(pending.requestHash).toBe('1ae432f016f4b068acdb4ec4be611a2716e30c499b7ae8fbfc217295cf7df861');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(closed('complete'))));
    const expected = { ...pending, total: '150000.00' };
    const result = await sendBuyerResolution(prepareBuyerResolution(expected));
    expect(() => assertBuyerResolutionProof(result, expected)).not.toThrow();
    expect(journal().pending()).toEqual(pending);
  });
});
