// @vitest-environment jsdom
// Real #55 validator/adapter and #56 journal/coordinator; mocked HTTP transport.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken, getAuthSessionVersion } from '../../services/apiClient';
import { createSellerCommandRecovery } from './sellerCommandRecovery';
import { OrderRecoverySessionChangedError, type VerifiedOrderSession } from './orderCommandCoordinator';
import { OrderRecoveryBlockedError } from './orderIntentJournal';
import { receiptFixture, seller, deferred } from '../order-readiness/testFixtures';
import { preparationTransitions } from '../../services/orderResponse';
import { PREPARATION_COMMANDS, type PreparationCommand } from '../../types/order';

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const input = { orderId: 19, command: 'confirm', confirmed: true } as const;
let current: VerifiedOrderSession | null;
const bridge = (storage: Storage = sessionStorage) => createSellerCommandRecovery({ storage, getSession: () => current });
beforeEach(() => {
  sessionStorage.clear(); setAccessToken('qa-seller-token', seller.id);
  current = { actor: { id: seller.id, role: 'SELLER' }, isActive: true, version: getAuthSessionVersion() };
});
afterEach(() => { setAccessToken(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Seller recovery preparation bridge — NOT route/runtime acceptance', () => {
  it.each(PREPARATION_COMMANDS)('persists before sending %s and acknowledges only validated receipt', async command => {
    const c = bridge();
    const receipt = receiptFixture(); receipt.command = command;
    [receipt.result.timeline[0].fromStatus, receipt.result.status] = preparationTransitions[command];
    receipt.result.timeline[0].toStatus = receipt.result.status;
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      expect(c.pending()).toMatchObject({ orderId: 19, command });
      expect(new Headers(init.headers).get('Idempotency-Key')).toBe(c.pending()!.idempotencyKey);
      expect(init.body).toBe('{}'); return response(receipt);
    }); vi.stubGlobal('fetch', fetch);
    expect(await c.execute({ ...input, command })).toEqual({ orderId: 19, command, commandId: 12 });
    expect(c.pending()).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does nothing without confirmation; construction/pending never auto send', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const c = bridge();
    expect(c.pending()).toBeNull(); await expect(c.execute({ ...input, confirmed: false })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  });
  it('remount/new login reconstructs the adapter handle with the same key after lost response', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('lost response')).mockResolvedValueOnce(response(receiptFixture()));
    vi.stubGlobal('fetch', fetch); const first = bridge();
    await expect(first.execute(input)).rejects.toThrow(); const pending = first.pending();
    setAccessToken(null); setAccessToken('new-login-token', seller.id);
    current = { ...current!, version: getAuthSessionVersion() };
    const second = bridge(); expect(second.pending()).toEqual(pending); expect(fetch).toHaveBeenCalledTimes(1);
    await second.execute(input);
    const keys = fetch.mock.calls.map(([, init]) => new Headers(init.headers).get('Idempotency-Key'));
    expect(keys[0]).toBe(keys[1]); expect(second.pending()).toBeNull();
  });
  it.each([400, 401, 403, 404, 409, 413, 429, 500])('keeps pending after HTTP %s; no auto resend/refresh', async status => {
    const fetch = vi.fn().mockResolvedValue(response({ message: 'Rejected', code: 'TEST_REJECTION' }, status));
    vi.stubGlobal('fetch', fetch); const c = bridge();
    await expect(c.execute(input)).rejects.toThrow(); expect(c.pending()?.command).toBe('confirm');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('malformed HTTP200 cannot acknowledge or clear the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...receiptFixture(), extra: true })));
    const c = bridge(); await expect(c.execute(input)).rejects.toThrow(); expect(c.pending()).not.toBeNull();
  });
  it('a synchronous second click cannot dispatch a second request', async () => {
    const held = deferred<Response>(); const fetch = vi.fn(() => held.promise); vi.stubGlobal('fetch', fetch);
    const c = bridge(); const first = c.execute(input);
    await expect(c.execute(input)).rejects.toThrow(OrderRecoveryBlockedError);
    held.resolve(response(receiptFixture())); await first; expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('late success from the old session cannot clear its pending or touch the new actor', async () => {
    const held = deferred<Response>(); vi.stubGlobal('fetch', vi.fn(() => held.promise));
    const c = bridge(); const sending = c.execute(input); const pending = c.pending();
    setAccessToken('other-account-token', 99);
    current = { actor: { id: 99, role: 'SELLER' }, isActive: true, version: getAuthSessionVersion() };
    held.resolve(response(receiptFixture())); await expect(sending).rejects.toThrow(OrderRecoverySessionChangedError);
    expect(c.pending()).toBeNull();
    setAccessToken('back-to-seller', seller.id); current = { ...current, actor: { id: seller.id, role: 'SELLER' }, version: getAuthSessionVersion() };
    expect(bridge().pending()).toEqual(pending);
  });
  it('storage failure blocks HTTP before dispatch', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const storage = { getItem: () => { throw new Error('storage blocked'); }, setItem: vi.fn(), removeItem: vi.fn() };
    const c = createSellerCommandRecovery({ storage, getSession: () => current });
    await expect(c.execute(input)).rejects.toThrow(OrderRecoveryBlockedError); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not expand to Buyer complete or cancel commands', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(bridge().execute({ ...input, command: 'complete' as PreparationCommand })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('an unknown command locks other orders/actions instead of creating a new key', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('lost response')); vi.stubGlobal('fetch', fetch);
    const c = bridge(); await expect(c.execute(input)).rejects.toThrow(); const pending = c.pending();
    await expect(c.execute({ ...input, orderId: 20 })).rejects.toThrow(OrderRecoveryBlockedError);
    await expect(c.execute({ ...input, command: 'start-packing' })).rejects.toThrow(OrderRecoveryBlockedError);
    expect(c.pending()).toEqual(pending); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('storage remove failure after valid receipt cannot release the pending key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(receiptFixture())));
    const c = createSellerCommandRecovery({
      storage: { getItem: k => sessionStorage.getItem(k), setItem: (k,v) => sessionStorage.setItem(k,v), removeItem: () => { throw new Error('blocked remove'); } },
      getSession: () => current,
    });
    await expect(c.execute(input)).rejects.toThrow(OrderRecoveryBlockedError);
    expect(c.pending()?.orderId).toBe(19);
  });
  it('refuses inactive, Buyer or stale session before persistence/HTTP', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const validSession = current!;
    for (const session of [ { ...validSession, isActive: false }, { ...validSession, actor: { id: seller.id, role: 'USER' as const } }, { ...validSession, version: validSession.version - 1 } ]) {
      current = session; await expect(bridge().execute(input)).rejects.toThrow(OrderRecoverySessionChangedError);
    }
    expect(fetch).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  });
});
