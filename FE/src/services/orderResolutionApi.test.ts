import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_URL, AuthSessionChangedError, setAccessToken } from "./apiClient";
import {
  assertSellerResolutionProof,
  prepareSellerResolution,
  sendSellerResolution,
  validateSellerResolution,
  type PreparedSellerResolution,
} from "./orderResolutionApi";
import {
  receiptFixture,
  deferred,
  seller,
} from "../features/order-readiness/testFixtures";
import { PREPARATION_COMMANDS } from "../types/order";
import { preparationTransitions } from "./orderResponse";
const identity = {
  actorId: seller.id,
  orderId: 19,
  command: "confirm",
  idempotencyKey: "original-resolution-key",
} as const;
const closed = () => ({
  outcome: "CLOSED_WITHOUT_EXECUTION",
  resolutionId: 11,
  orderId: 19,
  command: "confirm",
  resolvedAt: "2026-10-18T03:00:00.000Z",
});
const committed = () => ({
  outcome: "COMMITTED",
  receipt: { ...receiptFixture(), replayed: true },
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeEach(() => setAccessToken("test-seller-token", seller.id));
afterEach(() => {
  setAccessToken(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("Resolver adapter — mocked HTTP, NOT Backend/browser acceptance", () => {
  it.each(PREPARATION_COMMANDS)(
    "sends original key once for %s, validates and freezes the receipt",
    async (command) => {
      const r = committed();
      r.receipt.command = command;
      const [from, to] = preparationTransitions[command];
      r.receipt.result.status = to;
      r.receipt.result.timeline[0].fromStatus = from;
      r.receipt.result.timeline[0].toStatus = to;
      const fetch = vi.fn().mockResolvedValue(json(r));
      vi.stubGlobal("fetch", fetch);
      const handle = prepareSellerResolution({ ...identity, command });
      const result = await sendSellerResolution(handle);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(`${API_URL}/seller/orders/19/resolve-command`);
      expect(init).toMatchObject({
        method: "POST",
        body: JSON.stringify({ command }),
        cache: "no-store",
        credentials: "include",
      });
      expect(init.headers.get("Idempotency-Key")).toBe(identity.idempotencyKey);
      expect(init.headers.get("Authorization")).toBe(
        "Bearer test-seller-token",
      );
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(() =>
        assertSellerResolutionProof(result, { ...identity, command }),
      ).not.toThrow();
      expect(Object.isFrozen(result)).toBe(true);
      if (result.outcome === "COMMITTED")
        expect(Object.isFrozen(result.receipt.result.timeline[0])).toBe(true);
    },
  );
  it("mints CLOSED proof only for the actual current invocation, not a clone or pure validation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(closed())));
    const result = await sendSellerResolution(
      prepareSellerResolution(identity),
    );
    expect(() => assertSellerResolutionProof(result, identity)).not.toThrow();
    for (const value of [
      structuredClone(result),
      validateSellerResolution(closed(), identity),
    ])
      expect(() => assertSellerResolutionProof(value, identity)).toThrow();
    expect(() =>
      assertSellerResolutionProof(result, {
        ...identity,
        idempotencyKey: "another-resolution-key",
      }),
    ).toThrow();
    expect(() =>
      assertSellerResolutionProof(result, { ...identity, actorId: 99 }),
    ).toThrow();
    setAccessToken("same-user-new-login", seller.id);
    expect(() => assertSellerResolutionProof(result, identity)).toThrow();
  });
  it.each([
    null,
    [],
    {},
    { ...closed(), extra: true },
    { ...closed(), commandId: 1 },
    { ...closed(), outcome: "closed" },
    { ...closed(), orderId: 20 },
    { ...closed(), command: "start-packing" },
    { ...closed(), resolutionId: 0 },
    { ...closed(), resolutionId: 2147483648 },
    { ...closed(), resolutionId: "11" },
    { ...closed(), resolutionId: NaN },
    { ...closed(), resolvedAt: "yesterday" },
    { ...closed(), resolvedAt: "2026-10-18" },
    { ...closed(), resolvedAt: null },
    { outcome: "COMMITTED", receipt: {} },
    { ...committed(), extra: true },
    { outcome: "COMMITTED", receipt: receiptFixture() },
    { outcome: "COMMITTED", receipt: { ...committed().receipt, orderId: 20 } },
  ])(
    "rejects malformed HTTP200 %# instead of minting a proof",
    async (value) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(value)));
      await expect(
        sendSellerResolution(prepareSellerResolution(identity)),
      ).rejects.toThrow();
    },
  );
  it("validates nested receipt actor, result, money and extra fields", () => {
    for (const mutate of [
      (r: ReturnType<typeof committed>) => {
        r.receipt.result.timeline[0].actorId = 99;
      },
      (r: ReturnType<typeof committed>) => {
        r.receipt.result.status = "DELIVERED";
      },
      (r: ReturnType<typeof committed>) => {
        r.receipt.result.payment.amount = "1.50";
      },
      (r: ReturnType<typeof committed>) => {
        Object.assign(r.receipt.result.payment, { secret: true });
      },
    ]) {
      const r = committed();
      mutate(r);
      expect(() => validateSellerResolution(r, identity)).toThrow();
    }
  });
  it.each([400, 401, 403, 404, 409, 413, 429, 500])(
    "does not retry/refresh after %s",
    async (status) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(json({ code: "TEST_ERROR" }, status));
      vi.stubGlobal("fetch", fetch);
      await expect(
        sendSellerResolution(prepareSellerResolution(identity)),
      ).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("refuses forged handles and stale handles before HTTP", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const h = prepareSellerResolution(identity);
    await expect(
      sendSellerResolution({ ...h } as PreparedSellerResolution),
    ).rejects.toThrow();
    setAccessToken("new-session", seller.id);
    await expect(sendSellerResolution(h)).rejects.toThrow(
      AuthSessionChangedError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["success", "failure"] as const)(
    "rejects late %s from an old session",
    async (kind) => {
      const held = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => held.promise),
      );
      const result = sendSellerResolution(prepareSellerResolution(identity));
      setAccessToken("other-account", 99);
      if (kind === "success") held.resolve(json(closed()));
      else held.reject(new TypeError("old network failure"));
      await expect(result).rejects.toThrow(AuthSessionChangedError);
    },
  );
  it.each(["timeout", "external"] as const)(
    "bounds resolver wait to 30s and respects %s cancellation without retry",
    async (source) => {
      const timer = new AbortController(),
        external = new AbortController();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(timer.signal);
      const fetch = vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise<Response>((_yes, no) => {
            init.signal!.addEventListener(
              "abort",
              () => no(init.signal!.reason),
              { once: true },
            );
          }),
      );
      vi.stubGlobal("fetch", fetch);
      const result = sendSellerResolution(
        prepareSellerResolution(identity),
        external.signal,
      );
      const rejected = expect(result).rejects.toThrow();
      expect(timeout).toHaveBeenCalledWith(30000);
      if (source === "timeout")
        timer.abort(new DOMException("Timeout", "TimeoutError"));
      else external.abort(new DOMException("Cancelled", "AbortError"));
      await rejected;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(external.signal.aborted).toBe(source === "external");
    },
  );
  it.each([
    { ...identity, actorId: 0 },
    { ...identity, orderId: 2147483648 },
    { ...identity, idempotencyKey: "" },
    { ...identity, idempotencyKey: "đ".repeat(20) },
    { ...identity, idempotencyKey: "valid-looking-key\n" },
    { ...identity, idempotencyKey: "x".repeat(129) },
    { ...identity, command: "complete" },
  ])("requires a valid original identity before HTTP %#", (value) => {
    expect(() => prepareSellerResolution(value as typeof identity)).toThrow();
  });
});
