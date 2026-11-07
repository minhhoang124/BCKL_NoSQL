// @vitest-environment jsdom
// Component state with mocked API; no actual stock mutation or transaction proof.
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextType } from "../../contexts/useAuth";
import { ApiError, setAccessToken } from "../../services/apiClient";
import type { Product } from "../../types/marketplace";
import { deferred, seller } from "../order-readiness/testFixtures";
import { VariantInventoryEditor } from "./VariantInventoryEditor";
import { variantInventoryApi } from "./variantInventoryApi";

function fixture(id = 11): Product {
  return { id, name: `Product-${id}`, description: null, version: 3, sellerStatus: "ACTIVE", moderationStatus: "APPROVED",
    category: { id: 1, name: "Category", slug: "cat" }, brand: null, images: [],
    variants: [{ id: 71, sellerSku: "SKU-71", price: "10000.00", stock: 5 }, { id: 72, sellerSku: "SKU-72", price: "30000.00", stock: 9 }],
  };
}
let auth: AuthContextType;
function tree(product = fixture(), busy = false, onChanged = vi.fn()) {
  return <AuthContext.Provider value={auth}><VariantInventoryEditor product={product} busy={busy} onChanged={onChanged} /></AuthContext.Provider>;
}
async function ready() { await screen.findByLabelText("Giá mới của SKU (đồng)");await waitFor(() => expect(screen.getByRole("button", { name: "Kiểm tra thay đổi SKU" })).toBeEnabled()); }
function fill(price = "20000", stock = "6", reason = "Kiểm kê") {
  fireEvent.change(screen.getByLabelText("Giá mới của SKU (đồng)"), { target: { value: price } });
  fireEvent.change(screen.getByLabelText("Tồn kho mới của SKU"), { target: { value: stock } });
  fireEvent.change(screen.getByLabelText("Lý do điều chỉnh SKU"), { target: { value: reason } });
}
function review() { fireEvent.submit(screen.getByLabelText("Lý do điều chỉnh SKU").closest("form")!); }
function agree() { fireEvent.click(screen.getByRole("checkbox")); }
beforeEach(() => {
  setAccessToken("fixture-token", seller.id);
  auth = { user: seller, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() };
  vi.spyOn(variantInventoryApi, "read").mockResolvedValue(fixture());
  vi.spyOn(variantInventoryApi, "edit").mockResolvedValue({ productId: 11, variantId: 71, version: 4, price: "20000.00", stock: 6 });
});
afterEach(() => { cleanup();setAccessToken(null);vi.restoreAllMocks(); });

describe("SKU inventory editor — consent and recovery", () => {
  it("loads current state read-only and requires review plus explicit consent", async () => {
    render(tree());await ready();
    expect(variantInventoryApi.edit).not.toHaveBeenCalled();
    fill();review();
    const save = screen.getByRole("button", { name: "Lưu giá/kho SKU" });
    expect(save).toBeDisabled();expect(screen.getByRole("checkbox")).not.toBeChecked();
    agree();expect(save).toBeEnabled();
    const updated = fixture();updated.version = 4;updated.variants[0] = { ...updated.variants[0], price: "20000.00", stock: 6 };
    vi.mocked(variantInventoryApi.read).mockResolvedValue(updated);
    fireEvent.click(save);
    await waitFor(() => expect(variantInventoryApi.edit).toHaveBeenCalledTimes(1));
    expect(vi.mocked(variantInventoryApi.edit).mock.calls[0].slice(0, 3)).toEqual([11, 71, { expectedProductVersion: 3, expectedPrice: "10000.00", expectedStock: 5, price: "20000.00", stock: 6, reason: "Kiểm kê" }]);
    await screen.findByText("Đã lưu điều chỉnh giá/kho. Các đơn đã đặt giữ nguyên giá lúc mua.");
  });
  it("synchronously fences two save clicks into one mutation", async () => {
    const gate = deferred<Awaited<ReturnType<typeof variantInventoryApi.edit>>>();vi.mocked(variantInventoryApi.edit).mockReturnValue(gate.promise);
    render(tree());await ready();fill();review();agree();
    const save = screen.getByRole("button", { name: "Lưu giá/kho SKU" });
    act(() => { save.click();save.click(); });
    expect(variantInventoryApi.edit).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve({ productId: 11, variantId: 71, version: 4, price: "20000.00", stock: 6 }); });
  });
  it.each([
    ["0", "6", "Kiểm kê", "Giá phải"], ["1.50", "6", "Kiểm kê", "Giá phải"],
    ["1000000000000", "6", "Kiểm kê", "Giá phải"], ["20000", "-1", "Kiểm kê", "Tồn kho phải"],
    ["20000", "1.5", "Kiểm kê", "Tồn kho phải"], ["20000", "2147483648", "Kiểm kê", "Tồn kho phải"],
    ["20000", "6", " ", "Nhập lý do"], ["10000", "5", "Kiểm kê", "chưa thay đổi"],
  ])("refuses invalid/no-op price-stock-reason without dispatch", async (price, stock, reason, message) => {
    render(tree());await ready();fill(price, stock, reason);review();
    expect(screen.getByRole("alert").textContent).toContain(message);
    expect(variantInventoryApi.edit).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("allows stock zero and resets consent when returning to edit", async () => {
    render(tree());await ready();fill("10000", "0");review();agree();
    fireEvent.click(screen.getByRole("button", { name: "Sửa lại thay đổi" }));
    review();expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Lưu giá/kho SKU" })).toBeDisabled();
  });
  it("does not automatically resend or read after uncertain PATCH; explicit reload starts a new review", async () => {
    vi.mocked(variantInventoryApi.edit).mockRejectedValue(new TypeError("lost response"));
    render(tree());await ready();fill();review();agree();fireEvent.click(screen.getByRole("button", { name: "Lưu giá/kho SKU" }));
    await screen.findByRole("alert");
    expect(variantInventoryApi.edit).toHaveBeenCalledTimes(1);expect(variantInventoryApi.read).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Kiểm tra thay đổi SKU" })).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại giá/kho" }));await ready();
    expect(variantInventoryApi.read).toHaveBeenCalledTimes(2);expect(variantInventoryApi.edit).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Lý do điều chỉnh SKU")).toHaveValue("");
  });
  it("409 conflict requires explicit fresh read, never retries stale values", async () => {
    vi.mocked(variantInventoryApi.edit).mockRejectedValue(new ApiError("stale", 409, "PRODUCT_VARIANT_CHANGED"));
    render(tree());await ready();fill();review();agree();fireEvent.click(screen.getByRole("button", { name: "Lưu giá/kho SKU" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Giá hoặc kho đã thay đổi");
    expect(variantInventoryApi.edit).toHaveBeenCalledTimes(1);expect(variantInventoryApi.read).toHaveBeenCalledTimes(1);
  });
  it("keeps edits locked when a post-success refresh fails until explicit reload", async () => {
    vi.mocked(variantInventoryApi.read).mockResolvedValueOnce(fixture()).mockRejectedValue(new Error("read down"));
    render(tree());await ready();fill();review();agree();fireEvent.click(screen.getByRole("button", { name: "Lưu giá/kho SKU" }));
    await screen.findByText("Đã lưu nhưng chưa tải lại được giá/kho. Bấm tải lại để kiểm tra.");
    expect(screen.getByRole("button", { name: "Kiểm tra thay đổi SKU" })).toBeDisabled();
    expect(variantInventoryApi.edit).toHaveBeenCalledTimes(1);
  });
  it("late success from an old session cannot change parent data or show saved state", async () => {
    const gate = deferred<Awaited<ReturnType<typeof variantInventoryApi.edit>>>(), changed = vi.fn();
    vi.mocked(variantInventoryApi.edit).mockReturnValue(gate.promise);
    const view = render(tree(fixture(), false, changed));await ready();fill();review();agree();fireEvent.click(screen.getByRole("button", { name: "Lưu giá/kho SKU" }));
    setAccessToken("another-seller", 99);auth = { ...auth, user: { ...seller, id: 99 } };view.rerender(tree(fixture(), false, changed));
    await act(async () => gate.resolve({ productId: 11, variantId: 71, version: 4, price: "20000.00", stock: 6 }));
    expect(changed).not.toHaveBeenCalled();expect(screen.queryByText("Đã lưu điều chỉnh giá/kho. Các đơn đã đặt giữ nguyên giá lúc mua.")).not.toBeInTheDocument();
  });
  it("late read for the old Product cannot replace the new selected Product", async () => {
    const gate = deferred<Product>();vi.mocked(variantInventoryApi.read).mockImplementation(id => id === 11 ? gate.promise : Promise.resolve(fixture(12)));
    const view = render(tree());view.rerender(tree(fixture(12)));await ready();
    await act(async () => gate.resolve(fixture(11)));
    expect(screen.getByText(/Product-12:/)).toBeInTheDocument();expect(screen.queryByText(/Product-11:/)).not.toBeInTheDocument();
  });
  it.each(["PENDING", "FROZEN"] as const)("blocks changes while Product moderation is %s", async moderationStatus => {
    vi.mocked(variantInventoryApi.read).mockResolvedValue({ ...fixture(), moderationStatus });
    render(tree());await screen.findByLabelText("Giá mới của SKU (đồng)");
    expect(screen.getByRole("button", { name: "Kiểm tra thay đổi SKU" })).toBeDisabled();
    expect(variantInventoryApi.edit).not.toHaveBeenCalled();
  });
  it("rejects a foreign Product response before rendering an editable form", async () => {
    vi.mocked(variantInventoryApi.read).mockResolvedValue(fixture(12));render(tree());
    await screen.findByRole("alert");expect(screen.queryByLabelText("Giá mới của SKU (đồng)")).not.toBeInTheDocument();
    expect(variantInventoryApi.edit).not.toHaveBeenCalled();
  });
});
