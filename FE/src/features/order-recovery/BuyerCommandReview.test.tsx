// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuyerCommandReview, type BuyerCommandReviewProps } from "./BuyerCommandReview";
import { BuyerRecoveryConsent } from "./BuyerRecoveryConsent";
import type { BuyerIntentV2 } from "./buyerIntentJournal";
import { getAuthSessionVersion, setAccessToken } from "../../services/apiClient";
import { detailFixture, deferred } from "../order-readiness/testFixtures";

function props(): BuyerCommandReviewProps {
  const version = getAuthSessionVersion();
  return {
    session: { actor: { id: 7, role: "USER" }, isActive: true, version },
    binding: { actorId: 7, sessionVersion: version, readKey: "buyer-read-19-v1" },
    order: detailFixture(), command: "cancel", phase: "confirm-new",
    fresh: true, pending: "clear", connected: true,
    onConfirm: vi.fn().mockResolvedValue(undefined), onDismiss: vi.fn(),
    onReload: vi.fn().mockResolvedValue(undefined),
  };
}
const send = (command = "cancel") => screen.getByRole("button", {
  name: command === "cancel" ? "Xác nhận hủy đơn" : "Xác nhận hoàn tất đơn",
});
function fill(text = "  Tôi đổi ý mua hàng  ") {
  fireEvent.change(screen.getByLabelText("Mô tả lý do hủy"), { target: { value: text } });
  fireEvent.click(screen.getByRole("checkbox"));
}
beforeEach(() => { setAccessToken("qa-only", 7); sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Buyer confirmation UI preparation — unmounted and no HTTP integration", () => {
  it("does not send on mount and defaults closed even with a callback", () => {
    const p = props();
    render(<BuyerCommandReview {...p} connected={undefined} />);
    fill();
    expect(send()).toBeDisabled();
    expect(p.onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Thao tác đơn hàng hiện chưa khả dụng/)).toBeInTheDocument();
  });
  it("without a callback never executes", () => {
    const p = props(); render(<BuyerCommandReview {...p} onConfirm={undefined} />);
    fill(); expect(send()).toBeDisabled();
  });
  it("requires separate consent and snapshots normalized body once on double click", async () => {
    const p = props(); render(<BuyerCommandReview {...p} />);
    fireEvent.change(screen.getByLabelText("Mô tả lý do hủy"), { target: { value: "  Tôi đổi ý mua hàng  " } });
    expect(send()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(send()); fireEvent.click(send());
    await waitFor(() => expect(p.onConfirm).toHaveBeenCalledTimes(1));
    const request = vi.mocked(p.onConfirm!).mock.calls[0]![0];
    expect(request).toEqual({ ...p.binding, orderId: 19, command: "cancel", expectedTotal: "20000.00",
      body: { reasonCode: "CHANGED_MIND", reasonText: "Tôi đổi ý mua hàng" } });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.body)).toBe(true);
    expect(send()).toBeDisabled();
    expect(screen.getByLabelText("Mô tả lý do hủy")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quay lại, chưa gửi" })).toBeDisabled();
    expect(screen.getByText(/chưa kết luận thành công/)).toBeInTheDocument();
  });
  it.each(["", "   ", "a".repeat(501), "😀".repeat(251)])("invalid canonical reason %# cannot dispatch", (text) => {
    render(<BuyerCommandReview {...props()} />); fill(text); expect(send()).toBeDisabled();
  });
  it("accepts 500 UTF16 code units after trim and does not truncate silently", () => {
    render(<BuyerCommandReview {...props()} />); fill(` ${"a".repeat(500)} `);
    expect(send()).toBeEnabled();
  });
  it("editing either reason field clears the old consent", () => {
    render(<BuyerCommandReview {...props()} />); fill(); expect(send()).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Lý do hủy"), { target: { value: "OTHER" } });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Mô tả lý do hủy"), { target: { value: "Lý do mới" } });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it("Enter in a textarea does not submit and drafts never enter storage", () => {
    const p = props(); render(<BuyerCommandReview {...p} />); fill("private reason");
    fireEvent.keyDown(screen.getByLabelText("Mô tả lý do hủy"), { key: "Enter", code: "Enter" });
    expect(p.onConfirm).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
  });
  it("dismisses before send without calling mutation", () => {
    const p = props(); render(<BuyerCommandReview {...p} />); fill();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại, chưa gửi" }));
    expect(p.onDismiss).toHaveBeenCalledTimes(1); expect(p.onConfirm).not.toHaveBeenCalled();
  });
  it.each(["CONFIRMED", "PACKING", "SHIPPING", "CANCELLED"] as const)("Buyer cannot cancel %s", (status) => {
    const p = props(); p.order.status = status;
    render(<BuyerCommandReview {...p} />); expect(send()).toBeDisabled();
    expect(screen.getByLabelText("Mô tả lý do hủy")).toBeDisabled();
  });
  it.each([
    { provider: "VNPAY" as const }, { status: "PAID" as const },
    { amount: "1.00" }, { paidAt: "2026-10-01T00:00:00.000Z" },
  ])("invalid cancel payment %# fails closed", (change) => {
    const p = props(); p.order.payment = { ...p.order.payment!, ...change };
    render(<BuyerCommandReview {...p} />); expect(send()).toBeDisabled();
  });
  it("does not guess COD for a missing payment", () => {
    const p = props(); p.order.payment = null;
    render(<BuyerCommandReview {...p} />); expect(send()).toBeDisabled();
  });
  it.each(["present", "blocked"] as const)("pending state %s blocks new requests for any order", (pending) => {
    render(<BuyerCommandReview {...props()} pending={pending} />); expect(send()).toBeDisabled();
  });
  it("stale read blocks confirmation", () => {
    render(<BuyerCommandReview {...props()} fresh={false} />); expect(send()).toBeDisabled();
  });
  it("complete has empty frozen body, received-goods consent and no cancellation draft", async () => {
    const p = props(); p.command = "complete"; p.order.status = "DELIVERED";
    p.order.payment = { ...p.order.payment!, status: "PAID", paidAt: "2026-10-22T00:00:00.000Z" };
    render(<BuyerCommandReview {...p} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(send("complete")).toBeDisabled(); fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(send("complete"));
    await waitFor(() => expect(p.onConfirm).toHaveBeenCalledTimes(1));
    expect(vi.mocked(p.onConfirm!).mock.calls[0]![0].body).toEqual({});
  });
  it.each(["UNPAID", "PENDING", "REFUNDED"] as const)("cannot complete payment %s", (status) => {
    const p = props(); p.command = "complete"; p.order.status = "DELIVERED";
    p.order.payment!.status = status;
    render(<BuyerCommandReview {...p} />); expect(send("complete")).toBeDisabled();
  });
  it.each([null, "bad-date", "2026-01-01"])("cannot complete with invalid paidAt %s", (paidAt) => {
    const p = props(); p.command = "complete"; p.order.status = "DELIVERED";
    p.order.payment = { ...p.order.payment!, status: "PAID", paidAt };
    render(<BuyerCommandReview {...p} />); expect(send("complete")).toBeDisabled();
  });
  it.each(["sending", "outcome-unknown", "acknowledged-refreshing", "blocked"] as const)("phase %s has no executable action", (phase) => {
    const p = props(); render(<BuyerCommandReview {...p} phase={phase} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(p.onConfirm).not.toHaveBeenCalled();
  });
  it.each(["read", "total", "status", "updatedAt", "command"])("changed %s discards reason and consent", (change) => {
    const p = props(), view = render(<BuyerCommandReview {...p} />); fill();
    const next = { ...p, binding: { ...p.binding }, order: { ...p.order } };
    if (change === "read") next.binding.readKey = "buyer-read-new";
    if (change === "total") next.order.total = "30000.00";
    if (change === "status") next.order.status = "CONFIRMED";
    if (change === "updatedAt") next.order.updatedAt = "2026-10-22T00:00:00.000Z";
    if (change === "command") next.command = "complete";
    view.rerender(<BuyerCommandReview {...next} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    if (change !== "command") expect(screen.getByLabelText("Mô tả lý do hủy")).toHaveValue("");
  });
  it.each(["missing", "actor", "role", "inactive", "generation", "money", "id"])("bad %s never exposes old order", (bad) => {
    const p = props();
    if (bad === "missing") p.session = null;
    if (bad === "actor") p.binding = { ...p.binding, actorId: 8 };
    if (bad === "role") p.session = { ...p.session!, actor: { id: 7, role: "SELLER" } };
    if (bad === "inactive") p.session = { ...p.session!, isActive: false };
    if (bad === "generation") p.binding = { ...p.binding, sessionVersion: p.binding.sessionVersion + 1 };
    if (bad === "money") p.order.total = "NaN";
    if (bad === "id") p.order.id = 0;
    render(<BuyerCommandReview {...p} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("FIXTURE-19");
  });
  it("session changes without a rerender cannot dispatch old consent or dismissal", () => {
    const p = props(); render(<BuyerCommandReview {...p} />); fill();
    setAccessToken("other-session", 8); fireEvent.click(send());
    fireEvent.click(screen.getByRole("button", { name: "Quay lại, chưa gửi" }));
    expect(p.onConfirm).not.toHaveBeenCalled(); expect(p.onDismiss).not.toHaveBeenCalled();
  });
  it.each([true, false])("dispatch failure (sync=%s) stays locked without showing raw errors", async (sync) => {
    const p = props(); p.onConfirm = vi.fn(() => {
      if (sync) throw new Error("private response");
      return Promise.reject(new Error("private response"));
    });
    render(<BuyerCommandReview {...p} />); fill(); fireEvent.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent("Giữ nguyên mã yêu cầu cũ");
    expect(send()).toBeDisabled(); expect(p.onConfirm).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("private response");
  });
  it("late old callback cannot update another account after unmount", async () => {
    const p = props(), d = deferred<void>(); p.onConfirm = vi.fn(() => d.promise);
    const view = render(<BuyerCommandReview {...p} />); fill(); fireEvent.click(send()); view.unmount();
    setAccessToken("other-session", 8);
    const next = props(); next.session = { ...next.session!, actor: { id: 8, role: "USER" } };
    next.binding = { ...next.binding, actorId: 8 }; next.order = detailFixture(20);
    render(<BuyerCommandReview {...next} />);
    await act(async () => { d.reject(new Error("private response")); await d.promise.catch(() => {}); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(send()).toBeDisabled();
    expect(screen.getByLabelText("Mô tả lý do hủy")).toHaveValue("");
    expect(document.body.textContent).not.toContain("FIXTURE-19");
  });
  it("known outcome/GET failure allows only latched GET retry and never mutation", async () => {
    const p = props(), d = deferred<void>(); p.onReload = vi.fn(() => d.promise);
    render(<BuyerCommandReview {...p} phase="acknowledged-refresh-error" />);
    const reload = screen.getByRole("button", { name: "Tải lại đơn" });
    fireEvent.click(reload); fireEvent.click(reload);
    expect(p.onReload).toHaveBeenCalledTimes(1); expect(reload).toBeDisabled();
    await act(async () => { d.reject(new Error("private GET failure")); await d.promise.catch(() => {}); });
    await waitFor(() => expect(reload).toBeEnabled());
    expect(p.onConfirm).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("private GET failure");
    expect(screen.getByText(/Kết quả lệnh cũ giữ nguyên/)).toBeInTheDocument();
  });
  it("stale session cannot GET retry", () => {
    const p = props(); render(<BuyerCommandReview {...p} phase="acknowledged-refresh-error" />);
    setAccessToken("other", 8); fireEvent.click(screen.getByRole("button", { name: "Tải lại đơn" }));
    expect(p.onReload).not.toHaveBeenCalled();
  });
});

describe("View composition with existing consent — mock metadata/callbacks, not live recovery", () => {
  it("simulated reload from pending metadata shows no reason, replay or automatic callback", () => {
    const p = props(), resolve = vi.fn();
    const pending: BuyerIntentV2 = { schemaVersion: 2, actorId: 7, role: "USER", orderId: 19,
      command: "cancel", idempotencyKey: "original_buyer_request_key", createdAt: "2026-10-22T00:00:00.000Z",
      hashVersion: 1, requestHash: "a".repeat(64) };
    const view = render(<BuyerCommandReview {...p} />); fill("private draft before reload"); view.unmount();
    render(<><BuyerCommandReview {...p} phase="outcome-unknown" pending="present" />
      <BuyerRecoveryConsent session={p.session} intent={pending} phase="confirm-resolution" connected onResolve={resolve} />
    </>);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xác nhận hủy đơn" })).not.toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled(); expect(p.onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Đối chiếu / dừng yêu cầu cũ" })).toBeDisabled();
    expect(document.body.textContent).not.toContain("private draft before reload");
    expect(document.body.textContent).not.toContain(pending.idempotencyKey);
    expect(document.body.textContent).not.toContain(pending.requestHash);
  });
});
