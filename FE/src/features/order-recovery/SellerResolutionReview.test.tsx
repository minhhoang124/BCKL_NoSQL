// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthSessionVersion,
  setAccessToken,
} from "../../services/apiClient";
import { SellerResolutionReview } from "./SellerResolutionReview";
import { createOrderIntentJournal } from "./orderIntentJournal";
import type { VerifiedOrderSession } from "./orderCommandCoordinator";
import type { SellerResolutionPhase } from "./sellerResolutionFlow";
let session: VerifiedOrderSession;
const getIntent = () =>
  createOrderIntentJournal(
    sessionStorage,
    () => "original-ui-pending-key",
  ).prepare({ id: 8, role: "SELLER" }, 19, "confirm");
beforeEach(() => {
  sessionStorage.clear();
  setAccessToken("test-seller", 8);
  session = {
    actor: { id: 8, role: "SELLER" },
    isActive: true,
    version: getAuthSessionVersion(),
  };
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  expect(fetch).not.toHaveBeenCalled();
  setAccessToken(null);
  vi.unstubAllGlobals();
});
describe("Resolver confirmation view — NOT mounted / no HTTP", () => {
  it("an old confirmation cannot dispatch after same-account login changes before React rerenders", () => {
    const resolve = vi.fn();
    render(
      <SellerResolutionReview
        session={session}
        intent={getIntent()}
        orderNumber="QA-19"
        phase="confirm-resolution"
        onResolve={resolve}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    setAccessToken("same-actor-new-login", 8);
    fireEvent.click(screen.getByRole("button"));
    expect(resolve).not.toHaveBeenCalled();
  });
  it("explains closing is not cancellation and stays disabled without a callback", () => {
    const intent = getIntent();
    render(
      <SellerResolutionReview
        session={session}
        intent={intent}
        orderNumber="QA-19"
        phase="confirm-resolution"
      />,
    );
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText(/không phải hủy đơn hàng/)).toBeVisible();
    expect(screen.getByText(/BẢN CHUẨN BỊ/)).toBeVisible();
    expect(document.body.textContent).not.toContain(intent.idempotencyKey);
  });
  it("requires explicit consent and dispatches only once on double click", () => {
    const resolve = vi.fn(),
      intent = getIntent();
    render(
      <SellerResolutionReview
        session={session}
        intent={intent}
        orderNumber="QA-19"
        phase="confirm-resolution"
        onResolve={resolve}
      />,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(button);
    fireEvent.click(button);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(intent);
  });
  it.each([
    "resolving",
    "committed-refreshing",
    "closed-refreshing",
    "blocked",
  ] as SellerResolutionPhase[])("%s cannot send", (phase) => {
    const resolve = vi.fn();
    render(
      <SellerResolutionReview
        session={session}
        intent={getIntent()}
        orderNumber="QA-19"
        phase={phase}
        onResolve={resolve}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });
  it.each(["committed-refresh-error", "closed-refresh-error"] as const)(
    "%s offers only GET retry and latches repeated clicks",
    (phase) => {
      const resolve = vi.fn(),
        reload = vi.fn();
      render(
        <SellerResolutionReview
          session={session}
          intent={getIntent()}
          orderNumber="QA-19"
          phase={phase}
          onResolve={resolve}
          onReload={reload}
        />,
      );
      const button = screen.getByRole("button", { name: "Tải lại đơn" });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(resolve).not.toHaveBeenCalled();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    },
  );
  it("callback rejection cannot silently enable a new submission", async () => {
    const resolve = vi.fn().mockRejectedValue(new Error("lost response"));
    render(
      <SellerResolutionReview
        session={session}
        intent={getIntent()}
        orderNumber="QA-19"
        phase="confirm-resolution"
        onResolve={resolve}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Giữ nguyên mã/),
    );
    expect(screen.getByRole("button")).toBeDisabled();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("checkbox")).toBeEnabled();
  });
  it("GET retry failure permits another explicit GET without claiming settlement is unknown", async () => {
    const reload = vi.fn().mockRejectedValue(new Error("GET failed")),
      resolve = vi.fn();
    render(
      <SellerResolutionReview
        session={session}
        intent={getIntent()}
        orderNumber="QA-19"
        phase="closed-refresh-error"
        onResolve={resolve}
        onReload={reload}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tải lại đơn" }));
    await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
    expect(screen.getByRole("status")).toHaveTextContent(/Đã đóng yêu cầu/);
    expect(
      screen.queryByText(/Chưa xác minh được kết quả/),
    ).not.toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("changing key resets consent instead of resolving a replacement intent with old consent", () => {
    const intent = getIntent(),
      resolve = vi.fn();
    const view = render(
      <SellerResolutionReview
        session={session}
        intent={intent}
        orderNumber="QA-19"
        phase="confirm-resolution"
        onResolve={resolve}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toBeChecked();
    view.rerender(
      <SellerResolutionReview
        session={session}
        intent={{ ...intent, idempotencyKey: "replacement-ui-pending-key" }}
        orderNumber="QA-19"
        phase="confirm-resolution"
        onResolve={resolve}
      />,
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button")).toBeDisabled();
  });
  it.each(["other-actor", "inactive", "stale", "buyer"] as const)(
    "hides old order for %s",
    (kind) => {
      const invalid =
        kind === "other-actor"
          ? { ...session, actor: { id: 99, role: "SELLER" as const } }
          : kind === "inactive"
            ? { ...session, isActive: false }
            : kind === "stale"
              ? { ...session, version: session.version - 1 }
              : { ...session, actor: { id: 8, role: "USER" as const } };
      render(
        <SellerResolutionReview
          session={invalid}
          intent={getIntent()}
          orderNumber="PRIVATE-ORDER"
          phase="confirm-resolution"
          onResolve={vi.fn()}
        />,
      );
      expect(document.body.textContent).not.toContain("PRIVATE-ORDER");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );
});
