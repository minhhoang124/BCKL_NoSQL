// @vitest-environment jsdom
// Mocked HTTP + browser state only; not live PostgreSQL acceptance evidence.
import "@testing-library/jest-dom/vitest";
// @ts-expect-error Vitest-only Node WebCrypto; browser app intentionally excludes Node globals.
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextType } from "../../contexts/useAuth";
import { setAccessToken } from "../../services/apiClient";
import { buyer, createdAt, deferred, detailFixture, seller } from "../order-readiness/testFixtures";
import { SellerClosePage } from "./SellerClosePage";
import { createOrderIntentJournal } from "./orderIntentJournal";
import { closeBody, closeHash, pendingSellerClose, prepareClose, sellerCloseKey, type CloseBody } from "./sellerCloseClient";

let auth: AuthContextType;
let order = detailFixture();
let transport: ReturnType<typeof vi.fn>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const writes = () => transport.mock.calls.filter(([, options]) => options.method === "POST");
const requestKey = (index = 0) => (writes()[index][1].headers as Headers).get("Idempotency-Key");
function receipt(body: CloseBody, replayed = false) {
  const returned = body.restockable !== undefined;
  const timeline = {
    fromStatus: returned ? "DELIVERY_FAILED" : "PENDING_CONFIRMATION",
    toStatus: "CANCELLED", actorType: "SELLER", actorId: seller.id,
    reasonCode: body.reasonCode, reasonText: body.reasonText,
    ...(returned ? { restockable: body.restockable, receiptReference: body.receiptReference, deliveryAttempt: 1, trackingReference: "QA-TRACK-1" } : {}),
    createdAt,
  };
  return { orderId: 19, commandId: 99, command: returned ? "confirm-returned" : "cancel", replayed,
    result: { status: "CANCELLED", payment: { ...detailFixture().payment!, status: "CANCELLED" },
      cancellation: { cancelledBy: { type: "SELLER", id: seller.id }, reasonCode: body.reasonCode, reasonText: body.reasonText, cancelledAt: createdAt },
      ...(returned ? { restockable: body.restockable, receiptReference: body.receiptReference,
        delivery: { deliveryAttempt: 1, retryCount: 0, trackingReference: "QA-TRACK-1" } } : {}), timeline: [timeline] } };
}
function tree(id = "19") {
  return <AuthContext.Provider value={auth}><MemoryRouter initialEntries={[`/seller/orders/${id}/close`]}>
    <Routes><Route path="/seller/orders/:orderId/close" element={<SellerClosePage />} /></Routes>
  </MemoryRouter></AuthContext.Provider>;
}
async function ready() { await screen.findByRole("heading", { name: "Đơn FIXTURE-19" }); }
function fill(reason = "Không thể thực hiện") {
  fireEvent.change(screen.getByLabelText("Mô tả lý do"), { target: { value: reason } });
}
function consent() { fireEvent.click(screen.getByRole("checkbox")); }
function submit() { fireEvent.submit(screen.getByLabelText("Mô tả lý do").closest("form")!); }
async function seedPending(orderId = 19, reason = "Không thể thực hiện") {
  const body = closeBody("cancel", "CANNOT_FULFIL", reason);
  return prepareClose(sessionStorage, { actorId: seller.id, orderId, command: "cancel", requestHash: await closeHash(seller.id, orderId, "cancel", body) });
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  setAccessToken("qa-token", seller.id);
  auth = { user: seller, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() };
  order = detailFixture();
  transport = vi.fn(async (url: string, options: RequestInit) => {
    if (options.method === "POST") return json(receipt(JSON.parse(options.body as string)));
    return json(url.endsWith("/seller/store") ? { id: 4, sellerId: seller.id, status: "ACTIVE" } : order);
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => {
  cleanup(); setAccessToken(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("Seller close page — consent, journal and session boundaries", () => {
  it("uses explicit separate consent and the original key to close an unexecuted intent without sending its body", async () => {
    const p = await seedPending();
    transport.mockImplementation(async (url: string, options: RequestInit) => options.method === "POST"
      ? json({ outcome: "CLOSED_WITHOUT_EXECUTION", resolutionId: 8, orderId: p.orderId, command: p.command, hashVersion: 1, requestHash: p.requestHash, actorId: p.actorId, resolvedAt: createdAt })
      : json(url.endsWith("/seller/store") ? { id: 4, sellerId: seller.id, status: "ACTIVE" } : order));
    render(tree()); await ready();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Mở đối chiếu mã yêu cầu" }));
    const button = screen.getByRole("button", { name: "Đối chiếu / dừng mã yêu cầu" });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Tôi đồng ý đối chiếu/ }));
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await screen.findByText(/Đã đóng mã yêu cầu chưa thực hiện/);
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toMatch(/\/resolve-close-command$/);
    expect(requestKey()).toBe(p.idempotencyKey);
    expect(JSON.parse(writes()[0][1].body as string)).toEqual({ command: p.command, hashVersion: 1, requestHash: p.requestHash });
    expect(pendingSellerClose(sessionStorage, seller.id)).toBeNull();
  });

  it("recovers a committed receipt without remembering or entering the original reason", async () => {
    const p = await seedPending();
    transport.mockImplementation(async (url: string, options: RequestInit) => options.method === "POST"
      ? json({ outcome: "COMMITTED", receipt: receipt(closeBody("cancel", "CANNOT_FULFIL", "Không thể thực hiện"), true) })
      : json(url.endsWith("/seller/store") ? { id: 4, sellerId: seller.id, status: "ACTIVE" } : order));
    render(tree()); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Mở đối chiếu mã yêu cầu" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Tôi đồng ý đối chiếu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Đối chiếu / dừng mã yêu cầu" }));
    await screen.findByText(/Đã đối chiếu biên nhận đã thực hiện/);
    expect(writes()).toHaveLength(1); expect(requestKey()).toBe(p.idempotencyKey);
    expect(pendingSellerClose(sessionStorage, seller.id)).toBeNull();
  });

  it("keeps the pending key when the close resolution acknowledges a different fingerprint", async () => {
    const p = await seedPending();
    transport.mockImplementation(async (url: string, options: RequestInit) => options.method === "POST"
      ? json({ outcome: "CLOSED_WITHOUT_EXECUTION", resolutionId: 8, orderId: p.orderId, command: p.command, hashVersion: 1, requestHash: "b".repeat(64), actorId: p.actorId, resolvedAt: createdAt })
      : json(url.endsWith("/seller/store") ? { id: 4, sellerId: seller.id, status: "ACTIVE" } : order));
    render(tree()); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Mở đối chiếu mã yêu cầu" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Tôi đồng ý đối chiếu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Đối chiếu / dừng mã yêu cầu" }));
    await screen.findByRole("alert");
    expect(pendingSellerClose(sessionStorage, seller.id)).toEqual(p);
    expect(screen.queryByText(/Đã đóng mã yêu cầu chưa thực hiện/)).not.toBeInTheDocument();
  });

  it("does not POST on mount/StrictMode or without consent, and acknowledges only a validated matching receipt", async () => {
    render(<StrictMode>{tree()}</StrictMode>); await ready();
    expect(writes()).toHaveLength(0);
    fill(); submit();
    expect(writes()).toHaveLength(0);
    consent(); submit();
    await screen.findByText(/Đã xác minh biên nhận hủy\/nhận hoàn/);
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toMatch(/\/seller\/orders\/19\/cancel$/);
    expect(JSON.parse(writes()[0][1].body as string)).toEqual({ reasonCode: "CANNOT_FULFIL", reasonText: "Không thể thực hiện" });
    expect(requestKey()).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(pendingSellerClose(sessionStorage, seller.id)).toBeNull();
  });

  it("holds a synchronous double submit behind the same single-flight latch", async () => {
    const late = deferred<Response>();
    transport.mockImplementation(async (url: string, options: RequestInit) => options.method === "POST" ? late.promise : json(url.endsWith("/seller/store") ? { id: 4, sellerId: seller.id, status: "ACTIVE" } : order));
    render(tree()); await ready(); fill(); consent();
    act(() => { submit(); submit(); });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(pendingSellerClose(sessionStorage, seller.id)).not.toBeNull();
    await act(async () => late.resolve(json(receipt(closeBody("cancel", "CANNOT_FULFIL", "Không thể thực hiện")))));
    await screen.findByText(/Đã xác minh biên nhận/);
    expect(writes()).toHaveLength(1);
  });

  it("retains a lost-response journal through reload, refuses changed body locally, then replays the exact old key", async () => {
    let attempts = 0;
    transport.mockImplementation(async (url: string, options: RequestInit) => {
      if (options.method === "POST") {
        if (++attempts === 1) throw Error("lost-after-commit");
        return json(receipt(JSON.parse(options.body as string), true));
      }
      return json(url.endsWith("/seller/store") ? { id: 4, sellerId: seller.id, status: "ACTIVE" } : order);
    });
    const view = render(tree()); await ready(); fill(); consent(); submit();
    await screen.findByRole("alert");
    const original = pendingSellerClose(sessionStorage, seller.id)!;
    expect(original).not.toBeNull(); expect(writes()).toHaveLength(1);
    expect(JSON.stringify(original)).not.toContain("Không thể thực hiện");
    view.unmount(); render(tree()); await ready();
    expect(writes()).toHaveLength(1); // Never auto re-POST during remount/read.
    fill("Nội dung khác"); consent(); submit();
    await screen.findByRole("alert");
    expect(writes()).toHaveLength(1);
    expect(pendingSellerClose(sessionStorage, seller.id)).toEqual(original);
    fill(); consent(); submit();
    await screen.findByText(/Đã xác minh biên nhận/);
    expect(writes()).toHaveLength(2);
    expect(requestKey(0)).toBe(original.idempotencyKey);
    expect(requestKey(1)).toBe(original.idempotencyKey);
    expect(writes()[1][1].body).toBe(writes()[0][1].body);
    expect(pendingSellerClose(sessionStorage, seller.id)).toBeNull();
  });

  it("blocks a close request for another order without auto POST or replacing that intent", async () => {
    const pending = await seedPending(20);
    render(tree()); await ready();
    expect(screen.getByRole("link", { name: "Đối chiếu đơn 20" })).toHaveAttribute("href", "/seller/orders/20/close");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    expect(pendingSellerClose(sessionStorage, seller.id)).toEqual(pending);
  });

  it("blocks close while a Seller preparation command remains unresolved", async () => {
    const pending = createOrderIntentJournal(sessionStorage).prepare({ id: seller.id, role: "SELLER" }, 19, "confirm");
    render(tree()); await ready();
    expect(screen.getByRole("link", { name: "Đối chiếu lệnh chuẩn bị đơn" })).toHaveAttribute("href", "/seller/orders/19");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    expect(createOrderIntentJournal(sessionStorage).pending({ id: seller.id, role: "SELLER" })).toEqual(pending);
  });

  it("does not replace a preparation command added after initial read", async () => {
    render(tree()); await ready();
    createOrderIntentJournal(sessionStorage).prepare({ id: seller.id, role: "SELLER" }, 19, "confirm");
    fill(); consent(); submit();
    await screen.findByRole("alert");
    expect(writes()).toHaveLength(0);
    expect(sessionStorage.getItem(sellerCloseKey(seller.id))).toBeNull();
  });

  it("fails closed for a corrupt persisted intent without deleting it", async () => {
    sessionStorage.setItem(sellerCloseKey(seller.id), "{broken");
    render(tree()); await ready();
    expect(screen.getByRole("alert")).toHaveTextContent("Không đọc được journal");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(sellerCloseKey(seller.id))).toBe("{broken");
    expect(writes()).toHaveLength(0);
  });

  it("does not dispatch if storage fails to persist before send", async () => {
    render(tree()); await ready(); fill(); consent();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
    submit(); await screen.findByRole("alert");
    expect(writes()).toHaveLength(0);
  });

  it("keeps the pending journal when a success-shaped response has the wrong order identity", async () => {
    transport.mockImplementation(async (url: string, options: RequestInit) => options.method === "POST" ? json({ ...receipt(JSON.parse(options.body as string)), orderId: 20 }) : json(url.endsWith("/seller/store") ? { id: 4, sellerId: seller.id, status: "ACTIVE" } : order));
    render(tree()); await ready(); fill(); consent(); submit();
    await screen.findByRole("alert");
    expect(pendingSellerClose(sessionStorage, seller.id)).not.toBeNull();
    expect(screen.queryByText(/Đã xác minh biên nhận/)).not.toBeInTheDocument();
  });

  it.each(["amount", "provider"])("does not settle on a well-shaped receipt whose payment %s differs from the loaded order", async (field) => {
    transport.mockImplementation(async (url: string, options: RequestInit) => {
      if (options.method === "POST") {
        const response = receipt(JSON.parse(options.body as string));
        if (field === "amount") response.result.payment.amount = "40000.00";
        else response.result.payment.provider = "VNPAY";
        return json(response);
      }
      return json(url.endsWith("/seller/store") ? { id: 4, sellerId: seller.id, status: "ACTIVE" } : order);
    });
    render(tree()); await ready(); fill(); consent(); submit();
    await screen.findByRole("alert");
    expect(writes()).toHaveLength(1);
    expect(pendingSellerClose(sessionStorage, seller.id)).not.toBeNull();
    expect(screen.queryByText(/Đã xác minh biên nhận/)).not.toBeInTheDocument();
  });

  it("accepts damaged returned goods with explicit false and a receipt, without exposing LOST", async () => {
    order = { ...detailFixture(), status: "DELIVERY_FAILED" };
    render(tree()); await ready();
    expect(screen.queryByRole("option", { name: /LOST/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tình trạng hàng đã nhận"), { target: { value: "damaged" } });
    fireEvent.change(screen.getByLabelText("Biên nhận hàng quay về"), { target: { value: " QA-RETURN-1 " } });
    fill(" Hàng đã kiểm tra bị hỏng "); consent(); submit();
    await screen.findByText(/Đã xác minh biên nhận/);
    expect(writes()[0][0]).toMatch(/\/confirm-returned$/);
    expect(JSON.parse(writes()[0][1].body as string)).toEqual({ reasonCode: "DAMAGED", reasonText: "Hàng đã kiểm tra bị hỏng", receiptReference: "QA-RETURN-1", restockable: false });
    expect(pendingSellerClose(sessionStorage, seller.id)).toBeNull();
  });

  it("late old-session success cannot clear a replacement journal in the new session", async () => {
    const late = deferred<Response>();
    transport.mockImplementation(async (url: string, options: RequestInit) => options.method === "POST" ? late.promise : json(url.endsWith("/seller/store") ? { id: 4, sellerId: seller.id, status: "ACTIVE" } : order));
    render(tree()); await ready(); fill(); consent(); submit();
    await waitFor(() => expect(writes()).toHaveLength(1));
    setAccessToken("new-login", seller.id);
    const old = pendingSellerClose(sessionStorage, seller.id)!;
    const replacement = { ...old, idempotencyKey: "replacement_key_12345678", orderId: 20 };
    sessionStorage.setItem(sellerCloseKey(seller.id), JSON.stringify(replacement));
    await act(async () => late.resolve(json(receipt(closeBody("cancel", "CANNOT_FULFIL", "Không thể thực hiện")))));
    expect(pendingSellerClose(sessionStorage, seller.id)).toEqual(replacement);
    expect(writes()).toHaveLength(1);
    expect(screen.queryByText(/Đã xác minh biên nhận/)).not.toBeInTheDocument();
  });

  it("settles a matching validated receipt after unmount when the auth session is unchanged", async () => {
    const late = deferred<Response>();
    transport.mockImplementation(async (url: string, options: RequestInit) => options.method === "POST" ? late.promise : json(url.endsWith("/seller/store") ? { id: 4, sellerId: seller.id, status: "ACTIVE" } : order));
    const view = render(tree()); await ready(); fill(); consent(); submit();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(pendingSellerClose(sessionStorage, seller.id)).not.toBeNull();
    view.unmount();
    await act(async () => late.resolve(json(receipt(closeBody("cancel", "CANNOT_FULFIL", "Không thể thực hiện")))));
    await waitFor(() => expect(pendingSellerClose(sessionStorage, seller.id)).toBeNull());
    expect(writes()).toHaveLength(1);
  });

  it.each([400, 409])("settles a fresh definitive %s rejection after unmount without writing another command", async (status) => {
    const late = deferred<Response>();
    transport.mockImplementation(async (url: string, options: RequestInit) => options.method === "POST" ? late.promise : json(url.endsWith("/seller/store") ? { id: 4, sellerId: seller.id, status: "ACTIVE" } : order));
    const view = render(tree()); await ready(); fill(); consent(); submit();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(pendingSellerClose(sessionStorage, seller.id)).not.toBeNull();
    view.unmount();
    await act(async () => late.resolve(json({ code: status === 409 ? "INVALID_ORDER_TRANSITION" : "VALIDATION_ERROR", message: "Rejected before execution" }, status)));
    await waitFor(() => expect(pendingSellerClose(sessionStorage, seller.id)).toBeNull());
    expect(writes()).toHaveLength(1);
  });

  it.each([400, 409])("keeps an already-uncertain intent after retry receives %s, including after unmount", async (status) => {
    const original = await seedPending();
    const late = deferred<Response>();
    transport.mockImplementation(async (url: string, options: RequestInit) => options.method === "POST" ? late.promise : json(url.endsWith("/seller/store") ? { id: 4, sellerId: seller.id, status: "ACTIVE" } : order));
    const view = render(tree()); await ready(); fill(); consent(); submit();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(requestKey()).toBe(original.idempotencyKey);
    view.unmount();
    await act(async () => late.resolve(json({ code: status === 409 ? "INVALID_ORDER_TRANSITION" : "VALIDATION_ERROR", message: "Retry rejected; original outcome still uncertain" }, status)));
    expect(pendingSellerClose(sessionStorage, seller.id)).toEqual(original);
    expect(writes()).toHaveLength(1);
  });

  it.each(["PAID", "REFUNDED"])("does not offer cancel for a VNPAY %s order", async (status) => {
    order = { ...detailFixture(), payment: { ...detailFixture().payment!, provider: "VNPAY", status: status as "PAID", paidAt: createdAt } };
    render(tree()); await ready();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it.each(["SHIPPING", "COMPLETED"])("does not offer cancel/returned in %s", async (status) => {
    order = { ...detailFixture(), status: status as "SHIPPING" };
    render(tree()); await ready();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("rejects inactive/wrong actor and invalid route before reading any order", () => {
    auth.user = buyer; const view = render(tree());
    expect(screen.getByRole("alert")).toHaveTextContent("Cần Seller");
    expect(transport).not.toHaveBeenCalled();
    auth.user = { ...seller, isActive: false }; view.rerender(tree());
    expect(screen.getByRole("alert")).toHaveTextContent("Cần Seller");
    view.unmount(); auth.user = seller; render(tree("00"));
    expect(screen.getByRole("alert")).toHaveTextContent("Mã đơn không hợp lệ");
    expect(transport).not.toHaveBeenCalled();
  });
});
