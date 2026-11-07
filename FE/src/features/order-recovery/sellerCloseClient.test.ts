// @vitest-environment jsdom
// HTTP/storage unit boundary only; no PostgreSQL or real inventory assertions.
// @ts-expect-error Vitest-only Node WebCrypto; browser app intentionally excludes Node globals.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getAuthSessionVersion, setAccessToken } from "../../services/apiClient";
import { deferred, detailFixture, seller } from "../order-readiness/testFixtures";
import { createOrderIntentJournal } from "./orderIntentJournal";
import {
  closeBody, closeDefiniteRejection, closeHash, closeReceipt, eligibleClose,
  pendingSellerClose, prepareClose, sellerCloseApi, sellerCloseKey,
  SellerCloseBlocked, settleClose,
  type CloseBody, type CloseCommand, type CloseIntent, type CloseStorage,
} from "./sellerCloseClient";

const actorId = seller.id;
const orderId = 19;
const key = "seller-close-fixture-key-0001";
const stamp = "2026-10-30T03:00:00.000Z";
const expectedPayment = { provider: "COD" as const, amount: "20000.00" };
const cancel = () => closeBody("cancel", "OTHER", "  Đổi kế hoạch  ");
const returned = (restockable = false) => closeBody("confirm-returned", "", "  Đã nhận hàng  ", "  RECEIPT-19  ", restockable);
function intent(command: CloseCommand = "cancel"): CloseIntent {
  return { schemaVersion: 1, actorId, orderId, command, idempotencyKey: key, requestHash: "a".repeat(64) };
}
function receipt(body: CloseBody = cancel(), command: CloseCommand = "cancel") {
  const isReturn = command === "confirm-returned";
  return {
    orderId, commandId: 44, command, replayed: false,
    result: {
      status: "CANCELLED",
      payment: { provider: "COD", status: "CANCELLED", amount: "20000.00", currency: "VND", paidAt: null },
      cancellation: { cancelledBy: { type: "SELLER", id: actorId }, reasonCode: body.reasonCode, reasonText: body.reasonText, cancelledAt: stamp },
      ...(isReturn ? { restockable: body.restockable, receiptReference: body.receiptReference, delivery: { deliveryAttempt: 2, retryCount: 1, trackingReference: "TRACK-19" } } : {}),
      timeline: [{
        fromStatus: isReturn ? "DELIVERY_FAILED" : "PENDING_CONFIRMATION", toStatus: "CANCELLED", actorType: "SELLER", actorId,
        reasonCode: body.reasonCode, reasonText: body.reasonText,
        ...(isReturn ? { restockable: body.restockable, receiptReference: body.receiptReference, deliveryAttempt: 2, trackingReference: "TRACK-19" } : {}),
        createdAt: stamp,
      }],
    },
  };
}
const seed = (p = intent()) => sessionStorage.setItem(sellerCloseKey(actorId), JSON.stringify(p));
const prepareInput = () => ({ actorId, orderId, command: "cancel" as const, requestHash: "a".repeat(64) });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  setAccessToken("fixture-token", actorId);
});
afterEach(() => {
  setAccessToken(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Seller close canonical body/hash", () => {
  it("matches an independent exact UTF-8 cancel envelope", async () => {
    const canonical = '{"actorScope":"USER:8","body":{"reasonCode":"OTHER","reasonText":"Đổi kế hoạch"},"command":"cancel","orderId":19}';
    expect(await closeHash(actorId, orderId, "cancel", cancel())).toBe(createHash("sha256").update(canonical, "utf8").digest("hex"));
  });
  it("preserves meaningful false in the independently specified returned envelope", async () => {
    const canonical = '{"actorScope":"USER:8","body":{"reasonCode":"DAMAGED","reasonText":"Đã nhận hàng","receiptReference":"RECEIPT-19","restockable":false},"command":"confirm-returned","orderId":19}';
    expect(returned()).toEqual({ reasonCode: "DAMAGED", reasonText: "Đã nhận hàng", receiptReference: "RECEIPT-19", restockable: false });
    expect(await closeHash(actorId, orderId, "confirm-returned", returned())).toBe(createHash("sha256").update(canonical, "utf8").digest("hex"));
    expect(await closeHash(actorId, orderId, "confirm-returned", returned())).not.toBe(await closeHash(actorId, orderId, "confirm-returned", returned(true)));
  });
  it("binds actor, order, command and changed text to different hashes", async () => {
    const original = await closeHash(actorId, orderId, "cancel", cancel());
    for (const changed of [closeHash(9, orderId, "cancel", cancel()), closeHash(actorId, 20, "cancel", cancel()), closeHash(actorId, orderId, "cancel", { ...cancel(), reasonText: "Lý do khác" })])
      expect(await changed).not.toBe(original);
  });
  it.each(["CHANGED_MIND", "LOST", "UNKNOWN"])("rejects Seller cancellation reason %s", (reason) => {
    expect(() => closeBody("cancel", reason, "Lý do")).toThrow(SellerCloseBlocked);
  });
  it.each(["", " ", "x".repeat(501)])("rejects blank or oversized reason", (reason) => {
    expect(() => closeBody("cancel", "OTHER", reason)).toThrow();
  });
  it.each(["", " ", "x".repeat(101)])("requires bounded returned-goods receipt", (reference) => {
    expect(() => closeBody("confirm-returned", "", "Lý do", reference, false)).toThrow();
  });
});

describe("Seller close metadata journal", () => {
  it("persists metadata only, reuses the exact key for identical request and settles it", () => {
    const first = prepareClose(sessionStorage, prepareInput());
    expect(Object.keys(first).sort()).toEqual(["actorId", "command", "idempotencyKey", "orderId", "requestHash", "schemaVersion"]);
    expect(JSON.stringify(first)).not.toContain("reasonText");
    expect(prepareClose(sessionStorage, prepareInput())).toEqual(first);
    settleClose(sessionStorage, first);
    expect(pendingSellerClose(sessionStorage, actorId)).toBeNull();
  });
  it.each([{ orderId: 20 }, { command: "confirm-returned" as const }, { requestHash: "b".repeat(64) }])("refuses a different command/body/order while preserving original key", (change) => {
    const first = prepareClose(sessionStorage, prepareInput());
    expect(() => prepareClose(sessionStorage, { ...prepareInput(), ...change })).toThrow(SellerCloseBlocked);
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(first);
  });
  it.each(["{", "null", "[]", JSON.stringify({ ...intent(), actorId: 9 }), JSON.stringify({ ...intent(), requestHash: "A".repeat(64) }), JSON.stringify({ ...intent(), reasonText: "must not store payload" })])("blocks corrupt or unexpected metadata without deleting it", (raw) => {
    sessionStorage.setItem(sellerCloseKey(actorId), raw);
    expect(() => pendingSellerClose(sessionStorage, actorId)).toThrow(SellerCloseBlocked);
    expect(sessionStorage.getItem(sellerCloseKey(actorId))).toBe(raw);
  });
  it("refuses close while a preparation command is unresolved", () => {
    const prep = createOrderIntentJournal(sessionStorage).prepare({ id: actorId, role: "SELLER" }, orderId, "confirm");
    expect(() => prepareClose(sessionStorage, prepareInput())).toThrow(SellerCloseBlocked);
    expect(createOrderIntentJournal(sessionStorage).pending({ id: actorId, role: "SELLER" })).toEqual(prep);
    expect(sessionStorage.getItem(sellerCloseKey(actorId))).toBeNull();
  });
  it("blocks write failures and storage which silently drops the intent", () => {
    for (const setItem of [() => { throw Error("quota"); }, () => {}]) {
      const storage: CloseStorage = { getItem: () => null, setItem, removeItem: () => {} };
      expect(() => prepareClose(storage, prepareInput())).toThrow(SellerCloseBlocked);
    }
  });
  it("blocks unreadable storage and failed deletion", () => {
    const denied: CloseStorage = { getItem: () => { throw Error("denied"); }, setItem: () => {}, removeItem: () => {} };
    expect(() => pendingSellerClose(denied, actorId)).toThrow(SellerCloseBlocked);
    seed();
    const nonRemoving: CloseStorage = { getItem: (k) => sessionStorage.getItem(k), setItem: (k, v) => sessionStorage.setItem(k, v), removeItem: () => {} };
    expect(() => settleClose(nonRemoving, intent())).toThrow(SellerCloseBlocked);
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(intent());
  });
  it("never deletes a replacement intent when settling a stale key", () => {
    const replacement = { ...intent(), idempotencyKey: key + "-new" };
    seed(replacement);
    expect(() => settleClose(sessionStorage, intent())).toThrow(SellerCloseBlocked);
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(replacement);
  });
});

describe("Seller close eligibility", () => {
  it("allows active/suspended Store unpaid early cancellation, not paid VNPay", () => {
    const order = detailFixture();
    expect(eligibleClose(order, "ACTIVE", "cancel")).toBe(true);
    order.status = "CONFIRMED";
    expect(eligibleClose(order, "SUSPENDED", "cancel")).toBe(true);
    order.payment = { ...order.payment!, provider: "VNPAY", status: "PAID", paidAt: stamp };
    expect(eligibleClose(order, "ACTIVE", "cancel")).toBe(false);
  });
  it.each(["SHIPPING", "DELIVERED", "COMPLETED", "CANCELLED"] as const)("blocks cancel in %s", (status) => {
    expect(eligibleClose({ ...detailFixture(), status }, "ACTIVE", "cancel")).toBe(false);
  });
  it("allows returned COD only and refuses missing/mismatched payment or Store", () => {
    const order = detailFixture();order.status = "DELIVERY_FAILED";
    expect(eligibleClose(order, "ACTIVE", "confirm-returned")).toBe(true);
    expect(eligibleClose(order, "CLOSED", "confirm-returned")).toBe(false);
    expect(eligibleClose({ ...order, payment: null }, "ACTIVE", "confirm-returned")).toBe(false);
    expect(eligibleClose({ ...order, payment: { ...order.payment!, amount: "1.00" } }, "ACTIVE", "confirm-returned")).toBe(false);
    expect(eligibleClose({ ...order, payment: { ...order.payment!, provider: "VNPAY" } }, "ACTIVE", "confirm-returned")).toBe(false);
  });
});

describe("Seller close receipt validation", () => {
  it("accepts cancellation acknowledgement including replay", () => {
    const raw = receipt();raw.replayed = true;
    expect(closeReceipt(raw, intent(), cancel(), expectedPayment)).toEqual({ orderId, commandId: 44, command: "cancel", replayed: true });
  });
  it("accepts damaged/no-restock return without converting false", () => {
    expect(closeReceipt(receipt(returned(), "confirm-returned"), intent("confirm-returned"), returned(), expectedPayment)).toEqual({ orderId, commandId: 44, command: "confirm-returned", replayed: false });
  });
  it("rejects well-shaped receipt money that differs from the loaded Order snapshot", () => {
    const raw = receipt();raw.result.payment.amount = "1.00";
    expect(() => closeReceipt(raw, intent(), cancel(), expectedPayment)).toThrow(SellerCloseBlocked);
  });
  it("rejects a different provider even when amount/status are well-shaped", () => {
    const raw = receipt();raw.result.payment.provider = "VNPAY";
    expect(() => closeReceipt(raw, intent(), cancel(), expectedPayment)).toThrow(SellerCloseBlocked);
  });
  it("accepts legitimate unpaid-VNPay cancellation acknowledgement when it matches the snapshot", () => {
    const raw = receipt();raw.result.payment.provider = "VNPAY";
    expect(closeReceipt(raw, intent(), cancel(), { provider: "VNPAY", amount: "20000.00" })).toEqual({ orderId, commandId: 44, command: "cancel", replayed: false });
  });
  it.each([
    (r: ReturnType<typeof receipt>) => { r.orderId = 20; },
    (r: ReturnType<typeof receipt>) => { r.result.cancellation.cancelledBy.id = 9; },
    (r: ReturnType<typeof receipt>) => { r.result.cancellation.cancelledBy.type = "ADMIN"; },
    (r: ReturnType<typeof receipt>) => { r.result.timeline[0].reasonText = "Changed"; },
    (r: ReturnType<typeof receipt>) => { r.result.payment.status = "PAID"; },
    (r: ReturnType<typeof receipt>) => { r.result.payment.amount = "NaN"; },
    (r: ReturnType<typeof receipt>) => { r.result.timeline[0].createdAt = "2026-10-29T00:00:00.000Z"; },
  ])("rejects inconsistent actor/order/payment/timeline receipts", (change) => {
    const raw = receipt();change(raw);
    expect(() => closeReceipt(raw, intent(), cancel(), expectedPayment)).toThrow(SellerCloseBlocked);
  });
  it("rejects returned disposition, receipt and delivery inconsistencies", () => {
    for (const field of ["disposition", "receipt", "attempt", "tracking"]) {
      const raw = receipt(returned(), "confirm-returned");
      if (field === "disposition") raw.result.restockable = true;
      if (field === "receipt") raw.result.receiptReference = "OTHER";
      if (field === "attempt") raw.result.delivery!.retryCount = 4;
      if (field === "tracking") raw.result.timeline[0].trackingReference = "OTHER";
      expect(() => closeReceipt(raw, intent("confirm-returned"), returned(), expectedPayment)).toThrow(SellerCloseBlocked);
    }
  });
});

describe("Seller close HTTP and session boundary", () => {
  it("sends explicit original key/body once, with unauthorized POST replay disabled", async () => {
    const transport = vi.fn(async () => json(receipt()));vi.stubGlobal("fetch", transport);
    await sellerCloseApi.send(intent(), cancel(), getAuthSessionVersion(), expectedPayment);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/seller\/orders\/19\/cancel$/);
    expect(new Headers(options.headers).get("Idempotency-Key")).toBe(key);
    expect(JSON.parse(options.body as string)).toEqual(cancel());
  });
  it("rejects a stale session before dispatch", async () => {
    const transport = vi.fn();vi.stubGlobal("fetch", transport);
    const version = getAuthSessionVersion();setAccessToken("another-session", 99);
    await expect(sellerCloseApi.send(intent(), cancel(), version, expectedPayment)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects a response from a session replaced while request was in flight", async () => {
    const gate = deferred<Response>();vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    const request = sellerCloseApi.send(intent(), cancel(), getAuthSessionVersion(), expectedPayment);
    setAccessToken("new-session", 99);gate.resolve(json(receipt()));
    await expect(request).rejects.toThrow();
  });
  it("never auto-refreshes/retries an unauthorized mutation", async () => {
    const transport = vi.fn(async () => json({ code: "UNAUTHORIZED" }, 401));vi.stubGlobal("fetch", transport);
    await expect(sellerCloseApi.send(intent(), cancel(), getAuthSessionVersion(), expectedPayment)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects a foreign Store read", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => json(url.endsWith("/seller/store") ? { id: 4, sellerId: 99, status: "ACTIVE" } : detailFixture())));
    await expect(sellerCloseApi.read(actorId, orderId)).rejects.toThrow(SellerCloseBlocked);
  });
  it("does not classify timeout/500/key collision as definite non-execution", () => {
    expect(closeDefiniteRejection(new Error("timeout"))).toBe(false);
    expect(closeDefiniteRejection(new ApiError("throttled", 429))).toBe(false);
    expect(closeDefiniteRejection(new ApiError("expired", 401))).toBe(false);
    expect(closeDefiniteRejection(new ApiError("server", 500))).toBe(false);
    expect(closeDefiniteRejection(new ApiError("conflict", 409, "IDEMPOTENCY_KEY_CONFLICT"))).toBe(false);
    expect(closeDefiniteRejection(new ApiError("invalid transition", 409, "INVALID_ORDER_TRANSITION"))).toBe(true);
  });
});

describe("Seller close resolver — immutable receipt or closed-command proof", () => {
  const closed = (p = intent()) => ({
    outcome: "CLOSED_WITHOUT_EXECUTION", resolutionId: 51, orderId: p.orderId,
    command: p.command, hashVersion: 1, requestHash: p.requestHash,
    actorId: p.actorId, resolvedAt: stamp,
  });
  async function committedFixture(command: CloseCommand = "cancel") {
    const body = command === "cancel" ? cancel() : returned(false);
    const p = { ...intent(command), requestHash: await closeHash(actorId, orderId, command, body) };
    const raw = receipt(body, command);raw.replayed = true;
    return { p, raw, response: { outcome: "COMMITTED", receipt: raw } };
  }
  it("sends only original key and command/hash metadata, validates CLOSED and leaves journal for coordinator settlement", async () => {
    const p = intent();seed(p);
    const transport = vi.fn(async () => json(closed(p)));vi.stubGlobal("fetch", transport);
    await expect(sellerCloseApi.resolve(p, getAuthSessionVersion(), expectedPayment)).resolves.toEqual({ outcome: "CLOSED_WITHOUT_EXECUTION" });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/seller\/orders\/19\/resolve-close-command$/);
    expect(new Headers(options.headers).get("Idempotency-Key")).toBe(p.idempotencyKey);
    expect(JSON.parse(options.body as string)).toEqual({ command: "cancel", hashVersion: 1, requestHash: p.requestHash });
    expect(options.body).not.toContain("reasonText");
    expect(options.body).not.toContain("receiptReference");
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(p);
  });
  it.each([
    { actorId: 9 }, { orderId: 20 }, { command: "confirm-returned" },
    { requestHash: "b".repeat(64) }, { hashVersion: 2 }, { resolutionId: 0 },
    { resolvedAt: "2026-10-30" }, { outcome: "COMMITTED" }, { unexpected: "extra" },
  ])("rejects inconsistent CLOSED proof without settling journal", async (change) => {
    const p = intent();seed(p);
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...closed(p), ...change })));
    await expect(sellerCloseApi.resolve(p, getAuthSessionVersion(), expectedPayment)).rejects.toThrow();
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(p);
  });
  it.each(["cancel", "confirm-returned"] as const)("proves COMMITTED %s from immutable receipt without original form contents", async (command) => {
    const { p, response } = await committedFixture(command);seed(p);
    vi.stubGlobal("fetch", vi.fn(async () => json(response)));
    await expect(sellerCloseApi.resolve(p, getAuthSessionVersion(), expectedPayment)).resolves.toEqual({ outcome: "COMMITTED" });
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(p);
    expect(Object.keys(pendingSellerClose(sessionStorage, actorId)!)).not.toContain("reasonText");
    if (command === "confirm-returned") expect(response.receipt.result.restockable).toBe(false);
  });
  it.each([
    (raw: ReturnType<typeof receipt>) => { raw.orderId = 20; },
    (raw: ReturnType<typeof receipt>) => { raw.command = "confirm-returned"; },
    (raw: ReturnType<typeof receipt>) => { raw.result.cancellation.cancelledBy.id = 9; },
    (raw: ReturnType<typeof receipt>) => { raw.replayed = false; },
    (raw: ReturnType<typeof receipt>) => { raw.result.payment.amount = "1.00"; },
    (raw: ReturnType<typeof receipt>) => { raw.result.payment.provider = "VNPAY"; },
    (raw: ReturnType<typeof receipt>) => { raw.result.cancellation.reasonText = "Different original body"; },
  ])("rejects inconsistent COMMITTED identity, replay, payment or body hash", async (change) => {
    const { p, raw, response } = await committedFixture();seed(p);change(raw);
    vi.stubGlobal("fetch", vi.fn(async () => json(response)));
    await expect(sellerCloseApi.resolve(p, getAuthSessionVersion(), expectedPayment)).rejects.toThrow();
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(p);
  });
  it("rejects a receipt whose reconstructed canonical hash differs from the journal", async () => {
    const { p, response } = await committedFixture("confirm-returned");
    const altered = { ...p, requestHash: "b".repeat(64) };seed(altered);
    vi.stubGlobal("fetch", vi.fn(async () => json(response)));
    await expect(sellerCloseApi.resolve(altered, getAuthSessionVersion(), expectedPayment)).rejects.toThrow(SellerCloseBlocked);
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(altered);
  });
  it("rejects extra COMMITTED fields instead of accepting a broad envelope", async () => {
    const { p, response } = await committedFixture();seed(p);
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...response, actorId })));
    await expect(sellerCloseApi.resolve(p, getAuthSessionVersion(), expectedPayment)).rejects.toThrow(SellerCloseBlocked);
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(p);
  });
  it("rejects a stale session before resolving and performs no POST", async () => {
    const p = intent();seed(p);const version = getAuthSessionVersion();
    const transport = vi.fn();vi.stubGlobal("fetch", transport);setAccessToken("next-session", 99);
    await expect(sellerCloseApi.resolve(p, version, expectedPayment)).rejects.toThrow(SellerCloseBlocked);
    expect(transport).not.toHaveBeenCalled();
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(p);
  });
  it("rejects a late resolver response after a session switch", async () => {
    const p = intent();seed(p);const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    const request = sellerCloseApi.resolve(p, getAuthSessionVersion(), expectedPayment);
    setAccessToken("next-session", 99);gate.resolve(json(closed(p)));
    await expect(request).rejects.toThrow();
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(p);
  });
  it("rechecks the session after asynchronous canonical hashing", async () => {
    const { p, response } = await committedFixture();seed(p);
    vi.stubGlobal("fetch", vi.fn(async () => json(response)));
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => {
      const result = await digest(...args);setAccessToken("next-session", 99);return result;
    });
    await expect(sellerCloseApi.resolve(p, getAuthSessionVersion(), expectedPayment)).rejects.toThrow(SellerCloseBlocked);
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(p);
  });
  it("never refreshes or replays an unauthorized resolver POST", async () => {
    const p = intent();seed(p);
    const transport = vi.fn(async () => json({ code: "UNAUTHORIZED" }, 401));vi.stubGlobal("fetch", transport);
    await expect(sellerCloseApi.resolve(p, getAuthSessionVersion(), expectedPayment)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(pendingSellerClose(sessionStorage, actorId)).toEqual(p);
  });
  it.each(["ORDER_CANNOT_CANCEL", "DELIVERY_STATE_CONFLICT"])("recognizes newly supported definitive rejection %s", (code) => {
    expect(closeDefiniteRejection(new ApiError("conflict", 409, code))).toBe(true);
  });
});
