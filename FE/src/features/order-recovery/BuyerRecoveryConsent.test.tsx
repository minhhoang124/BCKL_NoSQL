// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BuyerRecoveryConsent,
  type BuyerRecoveryPhase,
} from "./BuyerRecoveryConsent";
import type { BuyerIntentV2 } from "./buyerIntentJournal";
import {
  getAuthSessionVersion,
  setAccessToken,
} from "../../services/apiClient";

const intent: BuyerIntentV2 = {
  schemaVersion: 2,
  actorId: 7,
  role: "USER",
  orderId: 101,
  command: "cancel",
  idempotencyKey: "original_buyer_request_key",
  createdAt: "2026-10-19T00:00:00.000Z",
  hashVersion: 1,
  requestHash: "a".repeat(64),
};
const session = () => ({
  actor: { id: 7, role: "USER" as const },
  isActive: true,
  version: getAuthSessionVersion(),
});
const action = () =>
  screen.getByRole("button", { name: "Đối chiếu / dừng yêu cầu cũ" });
function props() {
  return {
    intent,
    session: session(),
    phase: "confirm-resolution" as BuyerRecoveryPhase,
    connected: true,
    onResolve: vi.fn().mockResolvedValue(undefined),
  };
}
beforeEach(() => setAccessToken("qa-only", 7));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Buyer recovery consent preparation, not mounted HTTP UI", () => {
  it("does not call anything on mount and requires separate consent", () => {
    const p = props();
    render(<BuyerRecoveryConsent {...p} />);
    expect(p.onResolve).not.toHaveBeenCalled();
    expect(action()).toBeDisabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(
      screen.getByText(/Đóng mã không phải hủy đơn hoặc hoàn tất đơn/),
    ).toBeInTheDocument();
  });
  it("missing connection or callback keeps command disabled", () => {
    const p = props();
    const view = render(<BuyerRecoveryConsent {...p} connected={false} />);
    expect(action()).toBeDisabled();
    view.rerender(<BuyerRecoveryConsent {...p} onResolve={undefined} />);
    expect(action()).toBeDisabled();
  });
  it("double click invokes once with a frozen intent and no key/hash in visible text", async () => {
    const p = props();
    render(<BuyerRecoveryConsent {...p} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(action());
    fireEvent.click(action());
    await waitFor(() => expect(p.onResolve).toHaveBeenCalledTimes(1));
    expect(p.onResolve.mock.calls[0]![0]).toEqual(intent);
    expect(Object.isFrozen(p.onResolve.mock.calls[0]![0])).toBe(true);
    expect(document.body.textContent).not.toContain(intent.idempotencyKey);
    expect(document.body.textContent).not.toContain(intent.requestHash);
    expect(action()).toBeDisabled(); // no self-settlement on Promise resolution
  });
  it("failed callback keeps safe text and requires consent again before manual retry", async () => {
    const p = props();
    p.onResolve.mockRejectedValue(new Error("raw private error"));
    render(<BuyerRecoveryConsent {...p} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(action());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Giữ nguyên yêu cầu cũ",
    );
    expect(document.body.textContent).not.toContain("raw private error");
    expect(action()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(action());
    await waitFor(() => expect(p.onResolve).toHaveBeenCalledTimes(2));
  });
  it("pending identity changes reset consent; order or hash cannot reuse old approval", () => {
    const p = props(),
      view = render(<BuyerRecoveryConsent {...p} />);
    fireEvent.click(screen.getByRole("checkbox"));
    view.rerender(
      <BuyerRecoveryConsent
        {...p}
        intent={{ ...intent, requestHash: "b".repeat(64) }}
      />,
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(action()).toBeDisabled();
  });
  it.each(["committed-refresh-error", "closed-refresh-error"] as const)(
    "%s permits only GET retry, never resolution",
    async (phase) => {
      const p = props(),
        reload = vi.fn().mockRejectedValue(new Error("offline"));
      render(<BuyerRecoveryConsent {...p} phase={phase} onReload={reload} />);
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Tải lại đơn" });
      fireEvent.click(button);
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(p.onResolve).not.toHaveBeenCalled();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Đã biết kết quả lệnh cũ",
      );
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    },
  );
  it.each(["resolving", "committed", "closed", "blocked"] as const)(
    "%s cannot dispatch",
    (phase) => {
      const p = props();
      render(<BuyerRecoveryConsent {...p} phase={phase} />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(p.onResolve).not.toHaveBeenCalled();
    },
  );
  it("login changes after render block callback even without rerender", () => {
    const p = props();
    render(<BuyerRecoveryConsent {...p} />);
    fireEvent.click(screen.getByRole("checkbox"));
    setAccessToken("other", 8);
    fireEvent.click(action());
    expect(p.onResolve).not.toHaveBeenCalled();
  });
  it("an old async callback cannot update a remounted different account", async () => {
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((_, r) => {
      reject = r;
    });
    const p = props();
    p.onResolve.mockReturnValue(promise);
    const view = render(<BuyerRecoveryConsent {...p} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(action());
    view.unmount();
    setAccessToken("other", 8);
    render(
      <BuyerRecoveryConsent
        {...p}
        session={{
          actor: { id: 8, role: "USER" },
          isActive: true,
          version: getAuthSessionVersion(),
        }}
      />,
    );
    await act(async () => {
      reject(new Error("private"));
      await promise.catch(() => {});
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Phiên hoặc yêu cầu không hợp lệ",
    );
  });
  it.each([
    { ...intent, actorId: 8 },
    { ...intent, hashVersion: 2 },
    { ...intent, requestHash: "A".repeat(64) },
    { ...intent, idempotencyKey: "invalid\n" },
  ])("invalid metadata %# never renders actionable consent", (bad) => {
    const p = props();
    render(<BuyerRecoveryConsent {...p} intent={bad as BuyerIntentV2} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(p.onResolve).not.toHaveBeenCalled();
  });
});
