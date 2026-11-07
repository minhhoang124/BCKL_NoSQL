// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BuyerPreviewLayout } from "./BuyerPreviewLayout";
import {
  BuyerOrderDetailPreviewPage,
  BuyerOrdersPreviewPage,
  CheckoutPreviewPage,
  CheckoutResultPreviewPage,
} from "./BuyerPreviewPages";
import { displayMoney } from "./fixtures";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Preview must not call API");
    }),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  cleanup();
  vi.unstubAllGlobals();
});
function show(path = "/dev/buyer-flow/checkout") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dev/buyer-flow" element={<BuyerPreviewLayout />}>
          <Route path="checkout" element={<CheckoutPreviewPage />} />
          <Route path="result" element={<CheckoutResultPreviewPage />} />
          <Route path="orders" element={<BuyerOrdersPreviewPage />} />
          <Route
            path="orders/:demoId"
            element={<BuyerOrderDetailPreviewPage />}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
it("labels the preview and navigates to a simulated multi-store receipt without a write", () => {
  show();
  expect(
    screen.getByText("BẢN MINH HỌA — KHÔNG ĐẶT ĐƠN THẬT"),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Xem kết quả đặt hàng mẫu" }),
  );
  expect(screen.getByText("Đã tạo 2 đơn minh họa")).toBeInTheDocument();
});
it.each(["price-changed", "stock-short", "unknown"])(
  "blocks advancing checkout and hides the payable total in %s",
  (state) => {
    show();
    fireEvent.change(screen.getByLabelText("Tình huống minh họa"), {
      target: { value: state },
    });
    expect(
      screen.getByRole("button", { name: "Xem kết quả đặt hàng mẫu" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tổng thanh toán chưa được xác nhận",
    );
    expect(screen.queryByText("Tổng cộng")).not.toBeInTheDocument();
  },
);
it("shows loading and recovers the error state explicitly", () => {
  show();
  fireEvent.change(screen.getByLabelText("Tình huống minh họa"), {
    target: { value: "loading" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("Đang tải");
  fireEvent.change(screen.getByLabelText("Tình huống minh họa"), {
    target: { value: "error" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Chưa tải được thông tin",
  );
  fireEvent.click(screen.getByRole("button", { name: "Thử lại dữ liệu mẫu" }));
  expect(
    screen.getByRole("button", { name: "Xem kết quả đặt hàng mẫu" }),
  ).toBeEnabled();
});
it("handles an empty order filter and resets the filter when returning to fixtures", () => {
  show("/dev/buyer-flow/orders");
  fireEvent.change(screen.getByLabelText("Trạng thái đơn"), {
    target: { value: "COMPLETED" },
  });
  expect(
    screen.getByRole("heading", { name: "Chưa có dữ liệu" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Xem dữ liệu mẫu" }));
  expect(
    screen.getAllByRole("link", { name: "Xem chi tiết đơn mẫu" }),
  ).toHaveLength(2);
});
it("navigates to a detail with immutable snapshot and no premature completion control", () => {
  show("/dev/buyer-flow/orders");
  fireEvent.click(
    screen.getAllByRole("link", { name: "Xem chi tiết đơn mẫu" })[0],
  );
  expect(
    screen.getByRole("heading", { name: "Địa chỉ lúc đặt hàng" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /đã nhận hàng/i }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Xem hướng dẫn hủy đơn" }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("không hủy đơn");
});
it("handles an invalid demo ID without inventing a real order", () => {
  show("/dev/buyer-flow/orders/125");
  expect(
    screen.getByRole("heading", { name: "Không tìm thấy đơn mẫu" }),
  ).toBeInTheDocument();
});
it("does not equate lost response with failed checkout or generate a new attempt", () => {
  show("/dev/buyer-flow/result");
  fireEvent.click(
    screen.getByRole("button", { name: "Minh họa mất phản hồi" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Giữ nguyên yêu cầu và mã lần gửi",
  );
  expect(
    screen.queryByRole("button", { name: /đặt lại/i }),
  ).not.toBeInTheDocument();
});
it("formats whole VND without floating point arithmetic and rejects noncanonical decimals", () => {
  expect(displayMoney("999999999999.00")).toBe("999.999.999.999 đ");
  expect(() => displayMoney("1.25")).toThrow();
  expect(() => displayMoney("1e3")).toThrow();
});
it('makes the unconnected Cart handoff explicit without inventing a working Cart link', () => {
  show();
  expect(screen.getByRole('region', { name: 'Điểm chuyển từ Cart' })).toHaveTextContent('chưa lấy từ Cart thật');
  expect(screen.getByRole('region', { name: 'Điểm chuyển từ Cart' })).toHaveTextContent('Variant được chọn');
});
