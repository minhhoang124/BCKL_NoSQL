// @vitest-environment node
// Real journal/adapter/validators/coordinator; mocked fetch, NOT live Backend QA.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBuyerCommandRecovery } from "./buyerCommandRecovery";
import { createBuyerIntentJournal, createBuyerSettlementJournal } from "./buyerIntentJournal";
import { type VerifiedOrderSession, OrderRecoverySessionChangedError } from "./orderCommandCoordinator";
import { OrderRecoveryBlockedError } from "./orderIntentJournal";
import { getAuthSessionVersion, setAccessToken } from "../../services/apiClient";
import { sendBuyerResolution, validateBuyerResolution } from "../../services/buyerResolutionApi";
import { detailFixture, deferred } from "../order-readiness/testFixtures";

const slot = "bckl-order-command-journal-v1:7", key = "original_buyer_recovery_123";
const reason = { reasonCode: "OTHER" as const, reasonText: "Không còn nhu cầu" };
const time = "2026-10-22T01:00:00.000Z";
let entries: Map<string, string>;
let session: VerifiedOrderSession | null;
let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
const options = () => ({ getStorage: () => storage, getSession: () => session });
const journal = () => createBuyerIntentJournal({ ...options(), keyFactory: () => key, now: () => new Date(time) });
const bridge = () => createBuyerCommandRecovery(options());
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const closed = (command: "cancel" | "complete" = "cancel") => ({
  outcome: "CLOSED_WITHOUT_EXECUTION", resolutionId: 9, orderId: 101, command, resolvedAt: time,
});
const committed = (command: "cancel" | "complete" = "cancel") => ({ outcome: "COMMITTED", receipt: {
  orderId: 101, commandId: 201, command, replayed: true,
  result: command === "cancel" ? {
    status: "CANCELLED", payment: { provider: "COD", status: "CANCELLED", amount: "20000.00", currency: "VND", paidAt: null },
    cancellation: { cancelledBy: { type: "BUYER", id: 7 }, ...reason, cancelledAt: time },
    timeline: [{ fromStatus: "PENDING_CONFIRMATION", toStatus: "CANCELLED", actorType: "BUYER", actorId: 7, ...reason, createdAt: time }],
  } : {
    status: "COMPLETED", deliveredAt: "2026-10-21T01:00:00.000Z", completedAt: time,
    payment: { provider: "COD", status: "PAID", amount: "20000.00", currency: "VND", paidAt: "2026-10-21T01:00:00.000Z" },
    timeline: [{ fromStatus: "DELIVERED", toStatus: "COMPLETED", actorType: "BUYER", actorId: 7, createdAt: time }],
  },
} });
async function seed(command: "cancel" | "complete" = "cancel") {
  return journal().prepareNew({ orderId: 101, command, body: command === "cancel" ? reason : {}, confirmed: true });
}
function login(actorId = 7) {
  setAccessToken("qa-only-token", actorId);
  session = { actor: { id: actorId, role: "USER" }, isActive: true, version: getAuthSessionVersion() };
}
beforeEach(() => {
  entries = new Map();
  storage = { getItem: k => entries.get(k) ?? null, setItem: (k, v) => { entries.set(k, v); }, removeItem: k => { entries.delete(k); } };
  login();
});
afterEach(() => { setAccessToken(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Buyer recovery composition/settlement — unmounted, mocked HTTP", () => {
  it.each(["cancel", "complete"] as const)("settles actual COMMITTED %s proof, then GET; never executes", async command => {
    const intent = await seed(command), c = bridge();
    const transport = vi.fn().mockResolvedValueOnce(json(committed(command))).mockResolvedValueOnce(json(detailFixture(101)));
    vi.stubGlobal("fetch", transport);
    const state = await c.resolve({ intent, confirmed: true, order: detailFixture(101) });
    expect(state.phase).toBe("committed");
    expect(entries.has(slot)).toBe(false);
    expect(c.pending()).toBeNull();
    const [url, init] = transport.mock.calls[0];
    expect(url).toMatch(/\/orders\/101\/resolve-command$/);
    expect(init.headers.get("Idempotency-Key")).toBe(key);
    expect(JSON.parse(init.body)).toEqual({ command, hashVersion: 1, requestHash: intent.requestHash });
    expect(transport.mock.calls[1][1].method ?? "GET").toBe("GET");
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.keys(c)).not.toContain("execute");
    await expect(c.resolve({ intent, confirmed: true, order: detailFixture(101) })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each(["cancel", "complete"] as const)("settles CLOSED %s without fabricating a command receipt or changing GET state", async command => {
    const intent = await seed(command), c = bridge();
    const transport = vi.fn().mockResolvedValueOnce(json(closed(command))).mockResolvedValueOnce(json(detailFixture(101)));
    vi.stubGlobal("fetch", transport);
    const result = await c.resolve({ intent, confirmed: true, order: detailFixture(101) });
    expect(result.phase).toBe("closed");
    if (result.phase !== "closed") throw new Error("unexpected phase");
    expect(result.outcome).not.toHaveProperty("receipt");
    expect(result.order.status).toBe("PENDING_CONFIRMATION");
    expect(entries.has(slot)).toBe(false);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("does no HTTP on construction, reload, pending read or missing consent", async () => {
    const intent = await seed(), transport = vi.fn(); vi.stubGlobal("fetch", transport);
    const c = bridge(); expect(c.pending()).toEqual(intent);
    await expect(c.reload()).rejects.toThrow();
    await expect(c.resolve({ intent, confirmed: false, order: detailFixture(101) })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled(); expect(journal().pending()).toEqual(intent);
  });
  it.each([400, 401, 403, 404, 409, 413, 429, 500])("retains exact raw pending on HTTP %s; no auto refresh/replay", async status => {
    const intent = await seed(), before = entries.get(slot), c = bridge();
    const transport = vi.fn().mockResolvedValue(json({ code: "SAFE_TEST_ERROR", message: "Rejected" }, status));
    vi.stubGlobal("fetch", transport);
    await expect(c.resolve({ intent, confirmed: true, order: detailFixture(101) })).rejects.toThrow();
    expect(entries.get(slot)).toBe(before); expect(bridge().pending()).toEqual(intent);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(c.getState().phase).toBe("confirm-resolution");
  });
  it("lost response then reload retains key; explicit resolver retry does not execute", async () => {
    const intent = await seed(), before = entries.get(slot), first = bridge();
    const transport = vi.fn().mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValueOnce(json(committed())).mockResolvedValueOnce(json(detailFixture(101)));
    vi.stubGlobal("fetch", transport);
    await expect(first.resolve({ intent, confirmed: true, order: detailFixture(101) })).rejects.toThrow();
    first.dispose();
    const next = bridge(); expect(entries.get(slot)).toBe(before); expect(next.pending()).toEqual(intent);
    expect(transport).toHaveBeenCalledTimes(1);
    await next.resolve({ intent, confirmed: true, order: detailFixture(101) });
    expect(transport.mock.calls.slice(0, 2).map(([, init]) => init.headers.get("Idempotency-Key"))).toEqual([key, key]);
    expect(transport.mock.calls.every(([url]) => !/\/(cancel|complete)$/.test(String(url)))).toBe(true);
  });
  it("timeout abort keeps the key; not a rollback acknowledgement", async () => {
    const intent = await seed(), before = entries.get(slot), timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const transport = vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_ok, no) => {
      init.signal!.addEventListener("abort", () => no(init.signal!.reason), { once: true });
    })); vi.stubGlobal("fetch", transport);
    const result = bridge().resolve({ intent, confirmed: true, order: detailFixture(101) });
    const rejected = expect(result).rejects.toThrow(); timeout.abort(new DOMException("Timeout", "TimeoutError")); await rejected;
    expect(entries.get(slot)).toBe(before); expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(["extra", "wrong-order", "wrong-money", "wrong-reason"])("invalid HTTP200 (%s) cannot remove pending", async kind => {
    const intent = await seed(), before = entries.get(slot), raw = committed();
    if (kind === "extra") Object.assign(raw, { extra: true });
    if (kind === "wrong-order") raw.receipt.orderId = 102;
    if (kind === "wrong-money") raw.receipt.result.payment.amount = "30000.00";
    if (kind === "wrong-reason" && raw.receipt.result.cancellation) {
      raw.receipt.result.cancellation.reasonText = "Changed reason";
      Object.assign(raw.receipt.result.timeline[0], { reasonText: "Changed reason" });
    }
    const transport = vi.fn().mockResolvedValue(json(raw)); vi.stubGlobal("fetch", transport);
    await expect(bridge().resolve({ intent, confirmed: true, order: detailFixture(101) })).rejects.toThrow();
    expect(entries.get(slot)).toBe(before); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("same-tick double click dispatches one resolver and one GET", async () => {
    const intent = await seed(), c = bridge(), held = deferred<Response>();
    const transport = vi.fn().mockReturnValueOnce(held.promise).mockResolvedValueOnce(json(detailFixture(101))); vi.stubGlobal("fetch", transport);
    const first = c.resolve({ intent, confirmed: true, order: detailFixture(101) });
    await expect(c.resolve({ intent, confirmed: true, order: detailFixture(101) })).rejects.toThrow(OrderRecoveryBlockedError);
    expect(c.isBusy()).toBe(true); held.resolve(json(closed())); await first;
    expect(transport).toHaveBeenCalledTimes(2); expect(c.isBusy()).toBe(false);
  });
  it.each(["switch", "same-account-login", "dispose"])("ignores delayed response after %s and preserves the journal", async mode => {
    const intent = await seed(), before = entries.get(slot), c = bridge(), held = deferred<Response>();
    const transport = vi.fn().mockReturnValue(held.promise); vi.stubGlobal("fetch", transport);
    const result = c.resolve({ intent, confirmed: true, order: detailFixture(101) });
    const rejected = expect(result).rejects.toThrow(OrderRecoverySessionChangedError);
    if (mode === "dispose") c.dispose(); else login(mode === "switch" ? 8 : 7);
    held.resolve(json(closed())); await rejected;
    expect(entries.get(slot)).toBe(before); expect(c.getState()).toEqual({ phase: "blocked" });
    expect(transport).toHaveBeenCalledTimes(1);
    if (mode === "switch") expect(bridge().pending()).toBeNull();
  });
  it("cannot clear a newer pending changed during the HTTP await", async () => {
    const intent = await seed(), c = bridge(), held = deferred<Response>();
    const transport = vi.fn().mockReturnValue(held.promise); vi.stubGlobal("fetch", transport);
    const result = c.resolve({ intent, confirmed: true, order: detailFixture(101) });
    const rejected = expect(result).rejects.toThrow();
    const newer = JSON.stringify({ ...intent, createdAt: "2026-10-22T02:00:00.000Z" }); entries.set(slot, newer);
    held.resolve(json(closed())); await rejected;
    expect(entries.get(slot)).toBe(newer); expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(["throw", "silent", "readback"])("storage removal %s fails closed; never GET or resolve again", async mode => {
    const intent = await seed(), before = entries.get(slot), c = bridge();
    let removed = false;
    storage.removeItem = k => {
      if (mode === "throw") throw new Error("storage unavailable");
      if (mode !== "silent") entries.delete(k);
      removed = true;
    };
    storage.getItem = k => { if (mode === "readback" && removed) throw new Error("readback unavailable"); return entries.get(k) ?? null; };
    const transport = vi.fn().mockResolvedValue(json(closed())); vi.stubGlobal("fetch", transport);
    await expect(c.resolve({ intent, confirmed: true, order: detailFixture(101) })).rejects.toThrow();
    expect(c.getState().phase).toBe("blocked");
    await expect(c.resolve({ intent, confirmed: true, order: detailFixture(101) })).rejects.toThrow();
    await expect(c.reload()).rejects.toThrow();
    if (mode !== "readback") expect(entries.get(slot)).toBe(before);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(["COMMITTED", "CLOSED_WITHOUT_EXECUTION"])("%s plus failed GET retains known outcome; reload sends GET only", async outcome => {
    const intent = await seed(), c = bridge();
    const transport = vi.fn().mockResolvedValueOnce(json(outcome === "COMMITTED" ? committed() : closed()))
      .mockRejectedValueOnce(new TypeError("GET offline"))
      .mockResolvedValueOnce(json(detailFixture(101)));
    vi.stubGlobal("fetch", transport);
    const result = await c.resolve({ intent, confirmed: true, order: detailFixture(101) });
    expect(result.phase).toBe(outcome === "COMMITTED" ? "committed-refresh-error" : "closed-refresh-error");
    expect(result).toHaveProperty("outcome.outcome", outcome); expect(entries.has(slot)).toBe(false);
    await expect(c.resolve({ intent, confirmed: true, order: detailFixture(101) })).rejects.toThrow();
    const fresh = await c.reload(); expect(fresh.phase).toBe(outcome === "COMMITTED" ? "committed" : "closed");
    expect(transport.mock.calls.map(([, init]) => init.method ?? "GET")).toEqual(["POST", "GET", "GET"]);
  });
  it.each(["wrong-order", "wrong-money", "malformed"])("invalid GET %s after settlement is refresh error, not another POST", async kind => {
    const intent = await seed(), c = bridge(), detail = detailFixture(101);
    if (kind === "wrong-order") detail.id = 102;
    if (kind === "wrong-money") detail.total = "30000.00";
    if (kind === "malformed") Object.assign(detail, { privateField: true });
    const transport = vi.fn().mockResolvedValueOnce(json(closed())).mockResolvedValueOnce(json(detail)); vi.stubGlobal("fetch", transport);
    expect((await c.resolve({ intent, confirmed: true, order: detailFixture(101) })).phase).toBe("closed-refresh-error");
    expect(entries.has(slot)).toBe(false); expect(transport).toHaveBeenCalledTimes(2);
  });
  it("a delayed GET after account switch exposes no old receipt/detail to the new session", async () => {
    const intent = await seed(), c = bridge(), held = deferred<Response>();
    const transport = vi.fn().mockResolvedValueOnce(json(committed())).mockReturnValueOnce(held.promise); vi.stubGlobal("fetch", transport);
    const result = c.resolve({ intent, confirmed: true, order: detailFixture(101) });
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    login(8); const rejected = expect(result).rejects.toThrow(OrderRecoverySessionChangedError);
    held.resolve(json(detailFixture(101))); await rejected;
    expect(c.getState()).toEqual({ phase: "blocked" }); expect(entries.has(slot)).toBe(false);
  });
  it("new pending during the final GET is preserved and blocks refresh completion", async () => {
    const intent = await seed(), c = bridge(), held = deferred<Response>();
    const transport = vi.fn().mockResolvedValueOnce(json(closed())).mockReturnValueOnce(held.promise); vi.stubGlobal("fetch", transport);
    const result = c.resolve({ intent, confirmed: true, order: detailFixture(101) });
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    const newer = JSON.stringify({ ...intent, orderId: 102, idempotencyKey: "different_pending_key_456" }); entries.set(slot, newer);
    held.resolve(json(detailFixture(101)));
    expect((await result).phase).toBe("closed-refresh-error");
    expect(entries.get(slot)).toBe(newer);
    expect((await c.reload()).phase).toBe("closed-refresh-error");
    expect(transport).toHaveBeenCalledTimes(2); // No GET while another pending exists.
  });
  it("same identity but reserialized raw storage cannot be cleared by an older claim", async () => {
    const intent = await seed(), c = bridge(), held = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(held.promise));
    const result = c.resolve({ intent, confirmed: true, order: detailFixture(101) });
    const rejection = expect(result).rejects.toThrow();
    const changedRaw = JSON.stringify(intent, null, 2); entries.set(slot, changedRaw);
    held.resolve(json(closed())); await rejection;
    expect(entries.get(slot)).toBe(changedRaw);
  });
  it.each(["inactive", "role"])("a verified actor becoming %s in flight cannot settle", async mode => {
    const intent = await seed(), before = entries.get(slot), c = bridge(), held = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(held.promise));
    const result = c.resolve({ intent, confirmed: true, order: detailFixture(101) });
    const rejection = expect(result).rejects.toThrow(OrderRecoverySessionChangedError);
    session = mode === "inactive" ? { ...session!, isActive: false } : { ...session!, actor: { id: 7, role: "SELLER" } };
    held.resolve(json(closed())); await rejection;
    expect(entries.get(slot)).toBe(before); expect(c.getState()).toEqual({ phase: "blocked" });
  });
  it("legacy complete is upgraded with consent then resolved under its original key", async () => {
    const legacy = { schemaVersion: 1 as const, actorId: 7, role: "USER" as const, orderId: 101, command: "complete" as const, idempotencyKey: key, createdAt: time };
    entries.set(slot, JSON.stringify(legacy));
    const transport = vi.fn().mockResolvedValueOnce(json(closed("complete"))).mockResolvedValueOnce(json(detailFixture(101))); vi.stubGlobal("fetch", transport);
    await bridge().resolve({ intent: legacy, confirmed: true, order: detailFixture(101) });
    expect(transport.mock.calls[0][1].headers.get("Idempotency-Key")).toBe(key);
    expect(JSON.parse(transport.mock.calls[0][1].body).requestHash).toBe("1ae432f016f4b068acdb4ec4be611a2716e30c499b7ae8fbfc217295cf7df861");
    expect(entries.has(slot)).toBe(false);
  });
  it("captures the immutable Order total before HTTP await", async () => {
    const intent = await seed(), order = detailFixture(101), held = deferred<Response>();
    const transport = vi.fn().mockReturnValueOnce(held.promise).mockResolvedValueOnce(json(detailFixture(101))); vi.stubGlobal("fetch", transport);
    const result = bridge().resolve({ intent, confirmed: true, order }); order.total = "30000.00";
    held.resolve(json(committed())); expect((await result).phase).toBe("committed");
  });
  it("pure validation, cloned proofs, forged handles and reused settlement cannot clear pending", async () => {
    const log = createBuyerSettlementJournal(options()), intent = await seed(), handle = log.prepareResolution(intent, "20000.00"), before = entries.get(slot);
    const pure = await validateBuyerResolution(closed(), handle);
    expect(() => log.settleResolution(handle, pure)).toThrow();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(closed())));
    const result = await sendBuyerResolution(handle);
    expect(() => log.settleResolution(handle, structuredClone(result))).toThrow();
    expect(() => log.settleResolution({ ...handle }, result)).toThrow();
    expect(entries.get(slot)).toBe(before);
    log.settleResolution(handle, result); expect(entries.has(slot)).toBe(false);
    expect(() => log.settleResolution(handle, result)).toThrow();
  });
  it("stale consent/Order mismatch cannot issue HTTP", async () => {
    const intent = await seed(), transport = vi.fn(); vi.stubGlobal("fetch", transport);
    await expect(bridge().resolve({ intent: { ...intent, idempotencyKey: "another_key_no_consent_123" }, confirmed: true, order: detailFixture(101) })).rejects.toThrow();
    await expect(bridge().resolve({ intent, confirmed: true, order: detailFixture(102) })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled(); expect(journal().pending()).toEqual(intent);
  });
});
