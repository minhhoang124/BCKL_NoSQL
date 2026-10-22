import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL, AuthSessionChangedError, setAccessToken } from './apiClient';
import { assertBuyerResolutionProof, prepareBuyerResolution, sendBuyerResolution, validateBuyerResolution, type BuyerResolutionIdentity } from './buyerResolutionApi';
const base: BuyerResolutionIdentity = { actorId: 7, orderId: 101, command: 'cancel', idempotencyKey: 'original-buyer-key-123', hashVersion: 1, requestHash: 'a'.repeat(64), total: '150000.00' };
const closed = () => ({ outcome: 'CLOSED_WITHOUT_EXECUTION', resolutionId: 9, orderId: 101, command: 'cancel', resolvedAt: '2026-10-18T10:00:00.000Z' });
const reason = { reasonCode: 'OTHER', reasonText: 'Không còn nhu cầu' };
const committed = () => ({ outcome: 'COMMITTED', receipt: {
  orderId: 101, commandId: 201, command: 'cancel', replayed: true,
  result: { status: 'CANCELLED', payment: { provider: 'COD', status: 'CANCELLED', amount: '150000.00', currency: 'VND', paidAt: null },
    cancellation: { cancelledBy: { type: 'BUYER', id: 7 }, ...reason, cancelledAt: '2026-10-18T10:00:00.000Z' },
    timeline: [{ fromStatus: 'PENDING_CONFIRMATION', toStatus: 'CANCELLED', actorType: 'BUYER', actorId: 7, ...reason, createdAt: '2026-10-18T10:00:00.000Z' }],
  },
} });
async function hash(body: object, command = 'cancel') {
  const data = JSON.stringify({ actorScope: 'USER:7', body, command, orderId: 101 });
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => setAccessToken('qa-only-token', 7));
afterEach(() => { setAccessToken(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Buyer resolver adapter preparation — mocked HTTP, not live Backend acceptance', () => {
  it('sends only the original key/fingerprint, validates closed proof and never accesses storage', async () => {
    const transport = vi.fn().mockResolvedValue(response(closed())); vi.stubGlobal('fetch', transport);
    const handle = prepareBuyerResolution(base); const result = await sendBuyerResolution(handle);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(`${API_URL}/orders/101/resolve-command`);
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'include' });
    expect(init.headers.get('Idempotency-Key')).toBe(base.idempotencyKey);
    expect(JSON.parse(init.body)).toEqual({ command: 'cancel', hashVersion: 1, requestHash: base.requestHash });
    expect(() => assertBuyerResolutionProof(result, base)).not.toThrow();
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => assertBuyerResolutionProof(structuredClone(result), base)).toThrow();
    expect(() => assertBuyerResolutionProof(result, { ...base, requestHash: 'b'.repeat(64) })).toThrow();
  });
  it('pure validation is not an invocation proof', async () => {
    const result = await validateBuyerResolution(closed(), base);
    expect(() => assertBuyerResolutionProof(result, base)).toThrow();
  });
  it('validates cancellation receipt hash, total, actor and replay before creating proof', async () => {
    const expected = { ...base, requestHash: await hash(reason) };
    expect(expected.requestHash).toBe('2b90ed0146392f084a1bf552011433676b85558f772f2421003b82ca7dbe0239');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(committed())));
    const result = await sendBuyerResolution(prepareBuyerResolution(expected));
    expect(() => assertBuyerResolutionProof(result, expected)).not.toThrow();
    if (result.outcome === 'COMMITTED') expect(Object.isFrozen(result.receipt.result.timeline)).toBe(true);
    await expect(validateBuyerResolution(committed(), base)).rejects.toThrow();
  });
  it('rejects cancellation reason tampering even when timeline remains internally consistent', async () => {
    const expected = { ...base, requestHash: await hash(reason) }; const raw = committed();
    raw.receipt.result.cancellation.reasonText = 'Lý do đã bị đổi';
    raw.receipt.result.timeline[0].reasonText = 'Lý do đã bị đổi';
    await expect(validateBuyerResolution(raw, expected)).rejects.toThrow();
  });
  it('matches the remaining CHANGED_MIND golden vector from contract69', async () => {
    const requested = { reasonCode: 'CHANGED_MIND', reasonText: 'Tôi đổi ý mua hàng' };
    const raw = committed();
    Object.assign(raw.receipt.result.cancellation, requested);
    Object.assign(raw.receipt.result.timeline[0], requested);
    const expected = { ...base, requestHash: await hash(requested) };
    expect(expected.requestHash).toBe('5c7e4d7ab866c3dd0cd08449c4484077ba73dfc7c81009b98549c20af453f412');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(raw)));
    const result = await sendBuyerResolution(prepareBuyerResolution(expected));
    expect(() => assertBuyerResolutionProof(result, expected)).not.toThrow();
  });
  it('keeps proofs bound to each original key when responses arrive in reverse order', async () => {
    let releaseA!: (value: Response) => void;
    let releaseB!: (value: Response) => void;
    const transport = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { releaseA = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { releaseB = resolve; }));
    vi.stubGlobal('fetch', transport);
    const other = { ...base, idempotencyKey: 'other-buyer-key-456' };
    const pendingA = sendBuyerResolution(prepareBuyerResolution(base));
    const pendingB = sendBuyerResolution(prepareBuyerResolution(other));
    expect(transport).toHaveBeenCalledTimes(2);
    releaseB(response({ ...closed(), resolutionId: 10 }));
    const resultB = await pendingB;
    releaseA(response(closed()));
    const resultA = await pendingA;
    expect(() => assertBuyerResolutionProof(resultA, base)).not.toThrow();
    expect(() => assertBuyerResolutionProof(resultB, other)).not.toThrow();
    expect(() => assertBuyerResolutionProof(resultA, other)).toThrow();
    expect(() => assertBuyerResolutionProof(resultB, base)).toThrow();
  });
  it('checks canonical complete hash for closed result', async () => {
    const raw = { ...closed(), command: 'complete' };
    const expected = { ...base, command: 'complete' as const, requestHash: await hash({}, 'complete') };
    expect(expected.requestHash).toBe('1ae432f016f4b068acdb4ec4be611a2716e30c499b7ae8fbfc217295cf7df861');
    await expect(validateBuyerResolution(raw, expected)).resolves.toMatchObject({ outcome: 'CLOSED_WITHOUT_EXECUTION' });
    await expect(validateBuyerResolution(raw, { ...expected, requestHash: base.requestHash })).rejects.toThrow();
  });
  it.each([
    { actorId: 0 }, { orderId: 2147483648 }, { command: 'confirm' }, { hashVersion: '1' },
    { requestHash: 'A'.repeat(64) }, { requestHash: 'a'.repeat(64) + '\n' },
    { idempotencyKey: 'new\nkey-is-invalid' }, { total: '150000.00\n' },
  ])('rejects malformed identity %j without HTTP', values => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    expect(() => prepareBuyerResolution({ ...base, ...values } as BuyerResolutionIdentity)).toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    { receipt: {} }, { orderId: 102 }, { command: 'complete' }, { resolutionId: 0 },
    { resolvedAt: '2026-02-30T00:00:00.000Z' }, { outcome: 'UNKNOWN' },
  ])('rejects malformed closed200 %j', async change => {
    await expect(validateBuyerResolution({ ...closed(), ...change }, base)).rejects.toThrow();
  });
  it.each([401, 409, 429, 500])('does not auto replay HTTP%s', async status => {
    const transport = vi.fn().mockResolvedValue(response({ code: 'ERROR', message: 'Safe error' }, status)); vi.stubGlobal('fetch', transport);
    await expect(sendBuyerResolution(prepareBuyerResolution(base))).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects a forged handle and old-session handle before HTTP', async () => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    const handle = prepareBuyerResolution(base);
    await expect(sendBuyerResolution({ ...handle })).rejects.toThrow();
    setAccessToken('new-session', 7);
    await expect(sendBuyerResolution(handle)).rejects.toBeInstanceOf(AuthSessionChangedError);
    expect(transport).not.toHaveBeenCalled();
  });
  it('invalidates proof on logout even for the same actor later', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(closed())));
    const result = await sendBuyerResolution(prepareBuyerResolution(base)); setAccessToken('another-session', 7);
    expect(() => assertBuyerResolutionProof(result, base)).toThrow();
  });
  it('detaches caller identity and receipt before asynchronous hashing', async () => {
    const expected = { ...base, requestHash: await hash(reason) }; const raw = committed();
    const promise = validateBuyerResolution(raw, expected);
    expected.orderId = 999; raw.receipt.result.cancellation.reasonText = 'Changed mid-flight';
    await expect(promise).resolves.toMatchObject({ receipt: { orderId: 101, result: { cancellation: reason } } });
  });
  it('checks session again after a delayed digest and never returns an old-session proof', async () => {
    const expected = { ...base, requestHash: await hash(reason) };
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
      entered(); await gate; return digest(...args);
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(committed())));
    const result = sendBuyerResolution(prepareBuyerResolution(expected));
    await started; setAccessToken('different-buyer', 8); release();
    await expect(result).rejects.toBeInstanceOf(AuthSessionChangedError);
  });
  it('combines external cancellation with a finite30s timeout and does not replay', async () => {
    const signal = AbortSignal.abort(new Error('QA deadline'));
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const transport = vi.fn(async (_url, init: RequestInit) => {
      init.signal!.throwIfAborted(); return response(closed());
    });
    vi.stubGlobal('fetch', transport);
    await expect(sendBuyerResolution(prepareBuyerResolution(base), new AbortController().signal)).rejects.toThrow('QA deadline');
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('accepts only a full canonical Buyer completion replay, not a Seller/System receipt', async () => {
    const raw = { outcome: 'COMMITTED', receipt: {
      orderId: 101, commandId: 202, command: 'complete', replayed: true,
      result: { status: 'COMPLETED', deliveredAt: '2026-10-17T10:00:00.000Z', completedAt: '2026-10-18T10:00:00.000Z',
        payment: { provider: 'COD', status: 'PAID', amount: '150000.00', currency: 'VND', paidAt: '2026-10-17T10:00:00.000Z' },
        timeline: [{ fromStatus: 'DELIVERED', toStatus: 'COMPLETED', actorType: 'BUYER', actorId: 7, createdAt: '2026-10-18T10:00:00.000Z' }],
      },
    } };
    const expected = { ...base, command: 'complete' as const, requestHash: await hash({}, 'complete') };
    await expect(validateBuyerResolution(raw, expected)).resolves.toMatchObject({ outcome: 'COMMITTED' });
    raw.receipt.result.timeline[0].actorType = 'SYSTEM';
    await expect(validateBuyerResolution(raw, expected)).rejects.toThrow();
  });
});
