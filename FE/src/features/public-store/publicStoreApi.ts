import { API_URL, ApiError } from "../../services/apiClient";
import type { Product } from "../../types/marketplace";
export type PublicStorePageData = {
  store: { id: number; name: string; description: string | null };
  items: Product[];
  nextCursor: number | null;
};
const id = (x: unknown): x is number =>
  typeof x === "number" && Number.isInteger(x) && x > 0 && x <= 2147483647;
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const price = (x: unknown) =>
  typeof x === "string" && /^\d+(?:\.\d{1,2})?$/.test(x);
const bad = (): never => {
  throw new ApiError(
    "Chưa xác minh được dữ liệu cửa hàng.",
    502,
    "PUBLIC_STORE_INVALID_RESPONSE",
  );
};
export function validateStorePage(
  x: unknown,
  storeId: number,
  afterId = 0,
): PublicStorePageData {
  if (
    !object(x) ||
    Object.keys(x).sort().join(",") !== "items,nextCursor,store" ||
    !object(x.store) ||
    Object.keys(x.store).sort().join(",") !== "description,id,name" ||
    x.store.id !== storeId ||
    typeof x.store.name !== "string" ||
    !(
      x.store.description === null || typeof x.store.description === "string"
    ) ||
    !Array.isArray(x.items) ||
    x.items.length > 24
  )
    return bad();
  let last = afterId;
  for (const p of x.items) {
    if (
      !object(p) ||
      !id(p.id) ||
      p.id <= last ||
      typeof p.name !== "string" ||
      !object(p.store) ||
      p.store.id !== storeId ||
      typeof p.store.name !== "string" ||
      !object(p.category) ||
      typeof p.category.name !== "string" ||
      !(
        p.brand === null ||
        (object(p.brand) && typeof p.brand.name === "string")
      ) ||
      !Array.isArray(p.images) ||
      !p.images.every(
        (i) =>
          object(i) &&
          typeof i.url === "string" &&
          typeof i.isPrimary === "boolean",
      ) ||
      !Array.isArray(p.variants) ||
      p.variants.length === 0 ||
      !p.variants.every(
        (v) =>
          object(v) &&
          id(v.id) &&
          typeof v.price === "string" &&
          /^\d+(?:\.\d{1,2})?$/.test(v.price),
      ) ||
      typeof p.inStock !== "boolean" ||
      !(p.minPrice === null || price(p.minPrice)) ||
      !(p.maxPrice === null || price(p.maxPrice))
    )
      return bad();
    last = p.id;
  }
  if (
    x.nextCursor !== null &&
    (!id(x.nextCursor) || x.nextCursor <= afterId || x.nextCursor < last)
  )
    return bad();
  return x as PublicStorePageData;
}
export async function readStorePage(
  storeId: number,
  afterId: number | undefined,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ limit: "24" });
  if (afterId !== undefined) query.set("afterId", String(afterId));
  // Public reads carry neither an access token nor refresh cookies; no Auth bootstrap retry.
  const r = await fetch(`${API_URL}/stores/${storeId}?${query}`, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!r.ok)
    throw new ApiError(
      r.status === 404
        ? "Không tìm thấy cửa hàng đang hoạt động."
        : "Chưa tải được cửa hàng. Vui lòng thử lại.",
      r.status,
    );
  return validateStorePage(await r.json(), storeId, afterId);
}
