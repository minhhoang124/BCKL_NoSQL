import { fetchApi, getAuthSessionVersion } from "../../services/apiClient";
import type { Product } from "../../types/marketplace";

export type VariantEdit = {
  expectedProductVersion: number;
  expectedPrice: string;
  expectedStock: number;
  price: string;
  stock: number;
  reason: string;
};
export function inventoryMoney(value: string) {
  const text = value.trim();
  if (!/^[1-9][0-9]{0,11}(?:\.00)?$/.test(text)) throw Error("Giá phải là số đồng nguyên dương, tối đa 12 chữ số.");
  return text.replace(/\.00$/, "") + ".00";
}
export const variantInventoryApi = {
  read: (id: number) => fetchApi<Product>(`/seller/products/${id}`, { cache: "no-store", signal: AbortSignal.timeout(15000) }),
  async edit(productId: number, variantId: number, body: VariantEdit, epoch: number) {
    if (epoch !== getAuthSessionVersion()) throw Error("Phiên đăng nhập đã thay đổi.");
    const r = await fetchApi<unknown>(`/seller/products/${productId}/variants/${variantId}`, {
      method: "PATCH", body: JSON.stringify(body), retryOnUnauthorized: false, signal: AbortSignal.timeout(30000),
    });
    if (epoch !== getAuthSessionVersion()) throw Error("Phiên đăng nhập đã thay đổi.");
    if (!r || typeof r !== "object" || Array.isArray(r) ||
      Object.keys(r).sort().join(",") !== "price,productId,stock,variantId,version") throw Error("Chưa xác minh được kết quả lưu.");
    const result = r as { productId: number; variantId: number; version: number; price: string; stock: number };
    if (result.productId !== productId || result.variantId !== variantId || result.version !== body.expectedProductVersion + 1 ||
      result.price !== inventoryMoney(body.price) || result.stock !== body.stock) throw Error("Kết quả không khớp thay đổi đã xác nhận.");
    return result;
  },
};
