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
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
    { id: 20, price: "25000", inStock: true, optionValueIds: [10], stock: 15 },
    { id: 21, price: "30000", inStock: false, optionValueIds: [11], stock: 0 },
  ],
};

beforeEach(() => {
  auth.user = { id: 1, role: "USER", isActive: true };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("requires a complete available combination and disables both AddToCart and BuyNow for out-of-stock SKU", () => {
  const put = vi.spyOn(cartApi, "put");
  render(
    <MemoryRouter>
      <ProductPurchase product={product} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: "Thêm vào giỏ hàng" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Mua ngay" })).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Màu muốn mua"), {
    target: { value: "11" },
  });
  expect(screen.getAllByText(/Hết hàng/).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Thêm vào giỏ hàng" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Mua ngay" })).toBeDisabled();
  expect(put).not.toHaveBeenCalled();
});

it("sends only the selected SKU and desired quantity once via AddToCart", async () => {
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

  // Verify quantity stepper increments and decrements
  const plusBtn = screen.getByRole("button", { name: "Tăng số lượng" });
  const minusBtn = screen.getByRole("button", { name: "Giảm số lượng" });
  expect(minusBtn).toBeDisabled(); // at 1, cannot decrement

  fireEvent.click(plusBtn);
  expect(screen.getByLabelText("Số lượng")).toHaveValue(2);
  expect(minusBtn).not.toBeDisabled();

  const form = screen.getByRole("button", { name: "Thêm vào giỏ hàng" }).closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form); // duplicate submit prevented
  expect(put).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledWith(20, 2);

  auth.user = { id: 2, role: "USER", isActive: true };
  view.rerender(
    <MemoryRouter>
      <ProductPurchase product={product} />
    </MemoryRouter>,
  );
  await act(async () => resolve({} as CartResponse));
  expect(screen.queryByText("Đã lưu số lượng 2 vào giỏ.")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Màu muốn mua")).toHaveValue("");
});

it("BUY-03: Mua ngay puts desired SKU and quantity to cart, then navigates to cart with selectVariant", async () => {
  const put = vi.spyOn(cartApi, "put").mockResolvedValue({} as CartResponse);

  function CartProbe() {
    const loc = useLocation();
    return <div data-testid="cart-probe">{loc.pathname}{loc.search}</div>;
  }

  render(
    <MemoryRouter initialEntries={["/products/1"]}>
      <Routes>
        <Route path="/products/:id" element={<ProductPurchase product={product} />} />
        <Route path="/cart" element={<CartProbe />} />
      </Routes>
    </MemoryRouter>,
  );

  fireEvent.change(screen.getByLabelText("Màu muốn mua"), {
    target: { value: "10" },
  });
  const plusBtn = screen.getByRole("button", { name: "Tăng số lượng" });
  fireEvent.click(plusBtn);
  fireEvent.click(plusBtn); // count = 3

  const buyNow = screen.getByRole("button", { name: "Mua ngay" });
  await act(async () => {
    fireEvent.click(buyNow);
  });

  expect(put).toHaveBeenCalledWith(20, 3);
  expect(await screen.findByTestId("cart-probe")).toHaveTextContent("/cart?selectVariant=20");
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
  fireEvent.click(screen.getByRole("button", { name: "Thêm vào giỏ hàng" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "kiểm tra giỏ hàng",
  );
  expect(put).toHaveBeenCalledTimes(1);
});

it("preserves current PDP location in state.from when guest clicks login prompt", async () => {
  const put = vi.spyOn(cartApi, "put");
  Object.assign(auth, { user: null });
  function LoginProbe() {
    const loc = useLocation();
    const from = (loc.state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from;
    return (
      <div data-testid="login-from">
        {from ? `${from.pathname ?? ""}${from.search ?? ""}${from.hash ?? ""}` : "missing"}
      </div>
    );
  }
  render(
    <MemoryRouter initialEntries={["/products/1?ref=promo#buy"]}>
      <Routes>
        <Route path="/products/:id" element={<ProductPurchase product={product} />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: "Đăng nhập để chọn mua" });
  fireEvent.click(link);
  expect(screen.getByTestId("login-from")).toHaveTextContent("/products/1?ref=promo#buy");
  expect(put).not.toHaveBeenCalled();
});

it("double-clicking Mua ngay while the cart write is pending sends one PUT with the exact SKU/quantity", async () => {
  let resolve!: (value: CartResponse) => void;
  const put = vi.spyOn(cartApi, "put").mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  function CartProbe() {
    const loc = useLocation();
    return <div data-testid="cart-probe">{loc.pathname}{loc.search}</div>;
  }
  render(
    <MemoryRouter initialEntries={["/products/1"]}>
      <Routes>
        <Route path="/products/:id" element={<ProductPurchase product={product} />} />
        <Route path="/cart" element={<CartProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Màu muốn mua"), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: "Tăng số lượng" }));
  const buyNow = screen.getByRole("button", { name: "Mua ngay" });
  fireEvent.click(buyNow);
  fireEvent.click(buyNow);
  fireEvent.click(screen.getByRole("button", { name: "Thêm vào giỏ hàng" }));
  expect(put).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledWith(20, 2);
  await act(async () => resolve({} as CartResponse));
  expect(await screen.findByTestId("cart-probe")).toHaveTextContent("/cart?selectVariant=20");
  expect(put).toHaveBeenCalledTimes(1);
});
