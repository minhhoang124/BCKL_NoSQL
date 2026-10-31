// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProductPurchase } from "./ProductPurchase";
import { cartApi } from "../../services/cartApi";
import type { CartResponse } from "../../types/cart";
import type { Product } from "../../types/marketplace";
const auth = vi.hoisted(() => ({
  user: { id: 1, role: "USER", isActive: true },
  loading: false,
}));
vi.mock("../../contexts/useAuth", () => ({ useAuth: () => auth }));
const product: Product = {
  id: 1,
  name: "Product",
  description: null,
  category: { id: 1, name: "Category", slug: "cat" },
  brand: null,
  images: [],
  optionGroups: [
    {
      id: 2,
      name: "Màu",
      position: 0,
      values: [
        { id: 10, value: "Đen", position: 0 },
        { id: 11, value: "Trắng", position: 1 },
      ],
    },
  ],
  variants: [
    { id: 20, price: "25000", inStock: true, optionValueIds: [10] },
    { id: 21, price: "30000", inStock: false, optionValueIds: [11] },
  ],
};
beforeEach(() => {
  auth.user = { id: 1, role: "USER", isActive: true };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("requires a complete available combination and never writes an out-of-stock SKU", () => {
  const put = vi.spyOn(cartApi, "put");
  render(
    <MemoryRouter>
      <ProductPurchase product={product} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: "Lưu vào giỏ" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Màu muốn mua"), {
    target: { value: "11" },
  });
  expect(screen.getByText(/Hết hàng/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Lưu vào giỏ" })).toBeDisabled();
  expect(put).not.toHaveBeenCalled();
});
it("sends only the selected SKU and desired quantity once; old-account responses cannot show success", async () => {
  let resolve!: (value: CartResponse) => void;
  const put = vi.spyOn(cartApi, "put").mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(
    <MemoryRouter>
      <ProductPurchase product={product} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Màu muốn mua"), {
    target: { value: "10" },
  });
  fireEvent.change(screen.getByLabelText("Số lượng trong giỏ"), {
    target: { value: "2" },
  });
  const form = screen
    .getByRole("button", { name: "Lưu vào giỏ" })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(put).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledWith(20, 2);
  auth.user = { id: 2, role: "USER", isActive: true };
  view.rerender(
    <MemoryRouter>
      <ProductPurchase product={product} />
    </MemoryRouter>,
  );
  await act(async () => resolve({} as CartResponse));
  expect(
    screen.queryByText("Đã lưu số lượng 2 vào giỏ."),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Màu muốn mua")).toHaveValue("");
});
it("does not retry an uncertain network outcome and directs the buyer to reconcile the cart", async () => {
  const put = vi
    .spyOn(cartApi, "put")
    .mockRejectedValue(new TypeError("network"));
  render(
    <MemoryRouter>
      <ProductPurchase product={product} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Màu muốn mua"), {
    target: { value: "10" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Lưu vào giỏ" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "kiểm tra giỏ hàng",
  );
  expect(put).toHaveBeenCalledTimes(1);
});

it('preserves current PDP location in state.from when guest clicks login prompt', async () => {
  const { Route, Routes, useLocation } = await import('react-router-dom');
  const put = vi.spyOn(cartApi, 'put');
  Object.assign(auth, { user: null });
  function LoginProbe() {
    const loc = useLocation();
    const from = (loc.state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from;
    return (
      <div data-testid="login-from">
        {from ? `${from.pathname ?? ''}${from.search ?? ''}${from.hash ?? ''}` : 'missing'}
      </div>
    );
  }
  render(
    <MemoryRouter initialEntries={['/products/1?ref=promo#buy']}>
      <Routes>
        <Route path="/products/:id" element={<ProductPurchase product={product} />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: 'Đăng nhập để chọn mua' });
  fireEvent.click(link);
  expect(screen.getByTestId('login-from')).toHaveTextContent('/products/1?ref=promo#buy');
  expect(put).not.toHaveBeenCalled();
});
