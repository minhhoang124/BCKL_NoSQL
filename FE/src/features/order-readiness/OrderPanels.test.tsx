// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { OrderListPanel, OrderDetailPanel } from "./OrderPanels";
import type { OrderActionContext } from "./orderPolicy";
import {
  detailFixture,
  summaryFixture,
  seller,
  buyer,
  deferred,
} from "./testFixtures";

afterEach(cleanup);
const context: OrderActionContext = {
  scope: "seller",
  user: seller,
  store: { id: 4, status: "ACTIVE" },
  fresh: true,
  busy: false,
  outcomeUnknown: false,
};
const ready = () => ({ status: "ready" as const, data: detailFixture() });
describe("Prepared panels — fixture/component tests, NOT live Web transactions", () => {
  it("separates address, payment, snapshot items and actual history without enabling commands", () => {
    render(
      <OrderDetailPanel
        source="api"
        context={context}
        readKey="layout"
        state={ready()}
      />,
    );
    for (const name of [
      "Địa chỉ nhận hàng",
      "Thanh toán",
      "Sản phẩm trong đơn",
      "Lịch sử đơn",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Chat với shop" }),
    ).not.toBeInTheDocument();
  });
  it("labels fixture data, lists only summary fields and uses numeric IDs for selection/cursor", () => {
    const select = vi.fn(),
      next = vi.fn();
    render(
      <OrderListPanel
        source="fixture"
        scope="buyer"
        state={{
          status: "ready",
          data: { items: [summaryFixture()], nextCursor: 19 },
        }}
        onSelect={select}
        onNextPage={next}
      />,
    );
    expect(screen.getByText(/DỮ LIỆU MẪU/)).toBeInTheDocument();
    expect(screen.queryByText("Tên sản phẩm lúc mua")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Xem chi tiết/ }));
    expect(select).toHaveBeenCalledWith(19);
    fireEvent.click(screen.getByRole("button", { name: "Trang tiếp theo" }));
    expect(next).toHaveBeenCalledWith(19);
  });
  it("announces loading, safe errors/retry, empty results and lack of access", () => {
    const retry = vi.fn();
    const props = {
      source: "api" as const,
      scope: "buyer" as const,
      onSelect: vi.fn(),
      onRetry: retry,
    };
    const { rerender } = render(
      <OrderListPanel {...props} state={{ status: "loading" }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải");
    rerender(
      <OrderListPanel
        {...props}
        state={{
          status: "error",
          message: "Không tìm thấy đơn hàng hoặc bạn không có quyền truy cập.",
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Không tìm thấy");
    fireEvent.click(screen.getByRole("button", { name: "Tải lại đơn" }));
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(
      <OrderListPanel
        {...props}
        state={{ status: "ready", data: { items: [], nextCursor: null } }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Chưa có đơn");
    expect(
      screen.queryByRole("button", { name: "Trang tiếp theo" }),
    ).not.toBeInTheDocument();
    rerender(<OrderListPanel {...props} state={{ status: "idle" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("đúng tài khoản");
  });
  it("uses snapshot fields only, treats API reads as not yet accepted and does not invent legacy payment", () => {
    const d = detailFixture();
    d.payment = null;
    render(
      <OrderDetailPanel
        source="api"
        context={context}
        readKey="r1"
        state={{ status: "ready", data: d }}
      />,
    );
    expect(screen.getByText(/chưa nghiệm thu toàn luồng/)).toBeInTheDocument();
    expect(screen.getByText("Tên sản phẩm lúc mua")).toBeInTheDocument();
    expect(screen.getByText(/SKU-SNAPSHOT/)).toHaveTextContent("Đen / M");
    expect(screen.getByText(/Địa chỉ đã lưu/)).toBeInTheDocument();
    expect(screen.getByText(/không tự suy đoán COD/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeDisabled();
  });
  it("requires a caller to connect commands; no callback means disabled buttons", () => {
    render(
      <OrderDetailPanel
        source="fixture"
        context={context}
        readKey="r1"
        state={ready()}
      />,
    );
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeDisabled();
  });
  it("latches rapid clicks until a new read, and never optimistically advances status", () => {
    const action = vi.fn();
    const props = {
      source: "fixture" as const,
      context,
      state: ready(),
      onAction: action,
    };
    const { rerender } = render(<OrderDetailPanel {...props} readKey="r1" />);
    const button = screen.getByRole("button", { name: "Xác nhận đơn" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(action).toHaveBeenCalledExactlyOnceWith("confirm");
    expect(button).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Bắt đầu đóng gói" }),
    ).not.toBeInTheDocument();
    rerender(<OrderDetailPanel {...props} readKey="r2" />);
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đơn" }));
    expect(action).toHaveBeenCalledTimes(2);
  });
  it("a dispatch exception stays locked instead of offering a new transaction", () => {
    render(
      <OrderDetailPanel
        source="fixture"
        context={context}
        readKey="r1"
        state={ready()}
        onAction={() => {
          throw new Error("internal");
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đơn" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Giữ yêu cầu cũ");
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeDisabled();
  });
  it("handles a rejected asynchronous callback without unhandled rejection or unlocking", async () => {
    const pending = deferred<void>();
    render(
      <OrderDetailPanel
        source="fixture"
        context={context}
        readKey="r1"
        state={ready()}
        onAction={() => pending.promise}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đơn" }));
    await act(async () => pending.reject(new Error("private")));
    expect(screen.getByRole("alert")).toHaveTextContent("Giữ yêu cầu cũ");
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeDisabled();
  });
  it("does not attach a late command error to a newer read/action", async () => {
    const pending = deferred<void>(),
      action = vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockReturnValueOnce(undefined);
    const props = {
      source: "fixture" as const,
      context,
      state: ready(),
      onAction: action,
    };
    const { rerender } = render(<OrderDetailPanel {...props} readKey="r1" />);
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đơn" }));
    rerender(<OrderDetailPanel {...props} readKey="r2" />);
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đơn" }));
    await act(async () => pending.reject(new Error("old response")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(2);
  });
  it.each([{ busy: true }, { fresh: false }, { outcomeUnknown: true }])(
    "blocks actions with %j",
    (overrides) => {
      render(
        <OrderDetailPanel
          source="fixture"
          context={{ ...context, ...overrides }}
          readKey="r1"
          state={ready()}
          onAction={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Xác nhận đơn" }),
      ).toBeDisabled();
    },
  );
  it("allows old-order preparation for suspended Store but explains no new sales", () => {
    render(
      <OrderDetailPanel
        source="fixture"
        context={{ ...context, store: { id: 4, status: "SUSPENDED" } }}
        readKey="r1"
        state={ready()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText(/chỉ xử lý đơn cũ/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xác nhận đơn" })).toBeEnabled();
  });
  it("does not leak audit IDs or give a Buyer a Seller command", () => {
    const d = detailFixture();
    d.timeline[0].actorId = 888888;
    d.status = "DELIVERED";
    render(
      <OrderDetailPanel
        source="fixture"
        context={{ ...context, scope: "buyer", user: buyer }}
        readKey="r1"
        state={{ status: "ready", data: d }}
        onAction={vi.fn()}
      />,
    );
    expect(screen.queryByText(/888888/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Xác nhận đơn" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Xác nhận đã nhận hàng" }),
    ).toBeDisabled();
  });
});
