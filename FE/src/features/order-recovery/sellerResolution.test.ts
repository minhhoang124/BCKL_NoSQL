// @vitest-environment jsdom
// Real FE adapter/validator/journal/coordinator; HTTP is mocked, no live DB/browser proof.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthSessionVersion,
  setAccessToken,
} from "../../services/apiClient";
import { validateSellerResolution } from "../../services/orderResolutionApi";
import {
  createOrderIntentJournal,
  OrderRecoveryBlockedError,
} from "./orderIntentJournal";
import { createSellerCommandRecovery } from "./sellerCommandRecovery";
import { createSellerResolutionFlow } from "./sellerResolutionFlow";
import {
  OrderRecoverySessionChangedError,
  type VerifiedOrderSession,
} from "./orderCommandCoordinator";
import {
  deferred,
  detailFixture,
  receiptFixture,
  seller,
} from "../order-readiness/testFixtures";
const storageKey = `bckl-order-command-journal-v1:${seller.id}`;
let session: VerifiedOrderSession | null;
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
const actor = { id: seller.id, role: "SELLER" } as const;
function setup(
  storage: Parameters<typeof createOrderIntentJournal>[0] = sessionStorage,
) {
  const journal = createOrderIntentJournal(
    storage,
    () => "original-pending-key-0001",
  );
  const intent = journal.prepare(actor, 19, "confirm");
  const recovery = createSellerCommandRecovery({
    storage,
    getSession: () => session,
  });
  return { journal, intent, recovery };
}
beforeEach(() => {
  sessionStorage.clear();
  setAccessToken("seller-fixture", seller.id);
  session = { actor, isActive: true, version: getAuthSessionVersion() };
});
afterEach(() => {
  setAccessToken(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("Resolver settlement bridge — unmounted preparation", () => {
  it.each(["COMMITTED", "CLOSED_WITHOUT_EXECUTION"] as const)(
    "%s settles the exact original pending without a new execution",
    async (outcome) => {
      const { intent, recovery } = setup();
      const fetch = vi
        .fn()
        .mockResolvedValue(
          json(outcome === "COMMITTED" ? committed() : closed()),
        );
      vi.stubGlobal("fetch", fetch);
      const result = await recovery.resolve({ intent, confirmed: true });
      expect(result.outcome).toBe(outcome);
      expect(recovery.pending()).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toMatch(/\/resolve-command$/);
      expect(fetch.mock.calls[0][1].headers.get("Idempotency-Key")).toBe(
        intent.idempotencyKey,
      );
    },
  );
  it("does not prepare a new key or auto send on construction/pending/reload", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { intent, recovery } = setup();
    expect(recovery.pending()).toEqual(intent);
    await expect(
      recovery.resolve({ intent, confirmed: false }),
    ).rejects.toThrow();
    await expect(
      recovery.resolve({ intent: { ...intent, orderId: 20 }, confirmed: true }),
    ).rejects.toThrow();
    await expect(
      recovery.resolve({
        intent: { ...intent, idempotencyKey: "another-pending-key" },
        confirmed: true,
      }),
    ).rejects.toThrow();
    const reloaded = createSellerCommandRecovery({
      storage: sessionStorage,
      getSession: () => session,
    });
    expect(reloaded.pending()).toEqual(intent);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 409, 413, 429, 500])(
    "HTTP%s cannot clear pending, including ORDER_COMMAND_CLOSED",
    async (status) => {
      const { intent, recovery } = setup();
      const fetch = vi
        .fn()
        .mockResolvedValue(json({ code: "ORDER_COMMAND_CLOSED" }, status));
      vi.stubGlobal("fetch", fetch);
      await expect(
        recovery.resolve({ intent, confirmed: true }),
      ).rejects.toThrow();
      expect(recovery.pending()).toEqual(intent);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    null,
    { ...closed(), extra: 1 },
    { outcome: "COMMITTED", receipt: receiptFixture() },
  ])("malformed200 keeps the old intent %#", async (raw) => {
    const { intent, recovery } = setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(raw)));
    await expect(
      recovery.resolve({ intent, confirmed: true }),
    ).rejects.toThrow();
    expect(recovery.pending()).toEqual(intent);
  });
  it("lost response then reload uses the old key with explicit resolver retry", async () => {
    const { intent, recovery } = setup();
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValueOnce(json(closed()));
    vi.stubGlobal("fetch", fetch);
    await expect(
      recovery.resolve({ intent, confirmed: true }),
    ).rejects.toThrow();
    const next = createSellerCommandRecovery({
      storage: sessionStorage,
      getSession: () => session,
    });
    expect(next.pending()).toEqual(intent);
    expect(fetch).toHaveBeenCalledTimes(1);
    await next.resolve({ intent: next.pending()!, confirmed: true });
    expect(
      fetch.mock.calls.map(([, init]) => init.headers.get("Idempotency-Key")),
    ).toEqual([intent.idempotencyKey, intent.idempotencyKey]);
    expect(next.pending()).toBeNull();
  });
  it("shares the synchronous latch with execute, so resolving cannot race another send", async () => {
    const { intent, recovery } = setup(),
      held = deferred<Response>();
    const fetch = vi.fn(() => held.promise);
    vi.stubGlobal("fetch", fetch);
    const first = recovery.resolve({ intent, confirmed: true });
    await expect(
      recovery.resolve({ intent, confirmed: true }),
    ).rejects.toThrow();
    await expect(
      recovery.execute({ orderId: 19, command: "confirm", confirmed: true }),
    ).rejects.toThrow();
    held.resolve(json(closed()));
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["success", "failure"] as const)(
    "late %s cannot acknowledge the old account or touch a new pending",
    async (kind) => {
      const { intent, recovery } = setup(),
        held = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => held.promise),
      );
      const running = recovery.resolve({ intent, confirmed: true });
      setAccessToken("other-seller", 99);
      session = {
        actor: { id: 99, role: "SELLER" },
        isActive: true,
        version: getAuthSessionVersion(),
      };
      const other = createOrderIntentJournal(
        sessionStorage,
        () => "other-account-key-0001",
      ).prepare(session.actor, 27, "confirm");
      if (kind === "success") held.resolve(json(closed()));
      else held.reject(new Error("old failure"));
      await expect(running).rejects.toThrow(OrderRecoverySessionChangedError);
      expect(recovery.pending()).toEqual(other);
      expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual(intent);
    },
  );
  it("same-account logout/login invalidates a pending HTTP response", async () => {
    const { intent, recovery } = setup(),
      held = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => held.promise),
    );
    const running = recovery.resolve({ intent, confirmed: true });
    setAccessToken(null);
    setAccessToken("new-login", seller.id);
    session = { ...session!, version: getAuthSessionVersion() };
    held.resolve(json(committed()));
    await expect(running).rejects.toThrow(OrderRecoverySessionChangedError);
    expect(recovery.pending()).toEqual(intent);
  });
  it("rejects typed JSON/pure-validator CLOSED without an actual invocation proof", () => {
    const { journal, intent } = setup();
    const parsed = validateSellerResolution(closed(), {
      actorId: seller.id,
      orderId: 19,
      command: "confirm",
      idempotencyKey: intent.idempotencyKey,
    });
    expect(() => journal.settleClosedIntent(actor, intent, parsed)).toThrow();
    expect(journal.pending(actor)).toEqual(intent);
  });
  it.each(["throw", "no-op"] as const)(
    "storage remove %s stays blocked without fabricating success",
    async (mode) => {
      const { intent, recovery } = setup({
        getItem: (k) => sessionStorage.getItem(k),
        setItem: (k, v) => sessionStorage.setItem(k, v),
        removeItem: () => {
          if (mode === "throw") throw new Error("storage denied");
        },
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(closed())));
      await expect(
        recovery.resolve({ intent, confirmed: true }),
      ).rejects.toThrow(OrderRecoveryBlockedError);
      expect(recovery.pending()).toEqual(intent);
    },
  );
  it.each(["key", "timestamp"] as const)(
    "replacement pending %s while HTTP is in flight is never removed",
    async (change) => {
      const { intent, recovery } = setup(),
        held = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => held.promise),
      );
      const running = recovery.resolve({ intent, confirmed: true });
      const replacement =
        change === "key"
          ? { ...intent, idempotencyKey: "replacement-pending-key" }
          : { ...intent, createdAt: "2026-01-01T00:00:00.000Z" };
      sessionStorage.setItem(storageKey, JSON.stringify(replacement));
      held.resolve(json(closed()));
      await expect(running).rejects.toThrow(OrderRecoveryBlockedError);
      expect(recovery.pending()).toEqual(replacement);
    },
  );
  it("storage read failure blocks HTTP", async () => {
    const { intent } = setup(),
      fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const recovery = createSellerCommandRecovery({
      storage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      getSession: () => session,
    });
    await expect(
      recovery.resolve({ intent, confirmed: true }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe("Settlement then fresh GET controller — mocked transport", () => {
  it.each(["COMMITTED", "CLOSED_WITHOUT_EXECUTION"] as const)(
    "%s refresh failure locks next step, retry only GETs",
    async (outcome) => {
      const { intent, recovery } = setup();
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          json(outcome === "COMMITTED" ? committed() : closed()),
        )
        .mockRejectedValueOnce(new TypeError("GET failed"))
        .mockResolvedValueOnce(json(detailFixture()));
      vi.stubGlobal("fetch", fetch);
      const flow = createSellerResolutionFlow({
        recovery,
        getSession: () => session,
      });
      await expect(flow.resolve(intent, true)).rejects.toThrow();
      expect(recovery.pending()).toBeNull();
      expect(flow.canStartNext()).toBe(false);
      expect(flow.snapshot().phase).toBe(
        outcome === "COMMITTED"
          ? "committed-refresh-error"
          : "closed-refresh-error",
      );
      await expect(flow.resolve(intent, true)).rejects.toThrow();
      await flow.retryRefresh();
      expect(flow.canStartNext()).toBe(true);
      expect(fetch.mock.calls.map(([, init]) => init.method ?? "GET")).toEqual([
        "POST",
        "GET",
        "GET",
      ]);
    },
  );
  it("double click, unconfirmed and mount never generate another resolver call", async () => {
    const { intent, recovery } = setup(),
      held = deferred<Response>();
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => held.promise)
      .mockResolvedValue(json(detailFixture()));
    vi.stubGlobal("fetch", fetch);
    const flow = createSellerResolutionFlow({
      recovery,
      getSession: () => session,
    });
    expect(fetch).not.toHaveBeenCalled();
    await expect(flow.resolve(intent, false)).rejects.toThrow();
    const first = flow.resolve(intent, true);
    await expect(flow.resolve(intent, true)).rejects.toThrow();
    held.resolve(json(closed()));
    await first;
    expect(flow.snapshot().phase).toBe("ready");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("session change during GET never exposes old Order or unlocks commands", async () => {
    const { intent, recovery } = setup(),
      held = deferred<Response>();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(closed()))
      .mockImplementationOnce(() => held.promise);
    vi.stubGlobal("fetch", fetch);
    const flow = createSellerResolutionFlow({
      recovery,
      getSession: () => session,
    });
    const running = flow.resolve(intent, true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    setAccessToken("other-seller", 99);
    session = {
      actor: { id: 99, role: "SELLER" },
      isActive: true,
      version: getAuthSessionVersion(),
    };
    held.resolve(json(detailFixture()));
    await expect(running).rejects.toThrow(OrderRecoverySessionChangedError);
    expect(flow.snapshot()).toEqual({ phase: "blocked", order: null });
    expect(flow.canStartNext()).toBe(false);
  });
  it("a malformed fresh GET cannot unlock a new command even after CLOSED", async () => {
    const { intent, recovery } = setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(closed()))
        .mockResolvedValueOnce(json({ id: 19 })),
    );
    const flow = createSellerResolutionFlow({
      recovery,
      getSession: () => session,
    });
    await expect(flow.resolve(intent, true)).rejects.toThrow();
    expect(flow.snapshot()).toEqual({
      phase: "closed-refresh-error",
      order: null,
    });
    expect(flow.canStartNext()).toBe(false);
    expect(recovery.pending()).toBeNull();
  });
  it("caller mutation during resolution cannot redirect the follow-up GET", async () => {
    const { intent, recovery } = setup(),
      held = deferred<Response>();
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => held.promise)
      .mockResolvedValue(json(detailFixture()));
    vi.stubGlobal("fetch", fetch);
    const mutable = { ...intent };
    const flow = createSellerResolutionFlow({
      recovery,
      getSession: () => session,
    });
    const running = flow.resolve(mutable, true);
    mutable.orderId = 777;
    held.resolve(json(closed()));
    await running;
    expect(fetch.mock.calls[1][0]).toMatch(/\/seller\/orders\/19$/);
    expect(flow.canStartNext()).toBe(true);
  });
});
