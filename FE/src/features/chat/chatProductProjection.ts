import { API_URL } from "../../services/apiClient";
export type Card = { name: string; image: string | null; price: string | null };
export function parseChatProduct(
  value: unknown,
  productId: number,
  storeId: number,
): Card {
  if (!value || typeof value !== "object") throw Error("Invalid product");
  const row = value as Record<string, unknown>;
  const store = row.store as { id?: unknown } | null;
  if (
    row.id !== productId ||
    store?.id !== storeId ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    !Array.isArray(row.images) ||
    row.images.some((v) => !v || typeof v !== "object" || Array.isArray(v)) ||
    (row.minPrice !== null &&
      (typeof row.minPrice !== "string" ||
        !/^\d+(\.\d{1,2})?$/.test(row.minPrice)))
  )
    throw Error("Invalid product");
  const primary = row.images.find((v) => v.isPrimary === true) ?? row.images[0];
  let image: string | null = null;
  if (primary) {
    if (typeof primary.url !== "string") throw Error("Invalid image");
    const decoded = decodeURIComponent(primary.url);
    const url = new URL(primary.url, API_URL);
    if (
      decoded.includes("\\") ||
      decoded.split("/").some((s) => s === "." || s === "..") ||
      url.origin !== new URL(API_URL).origin ||
      !url.pathname.startsWith("/uploads/products/") ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      !["http:", "https:"].includes(url.protocol)
    )
      throw Error("Invalid image");
    image = url.href;
  }
  return { name: row.name, price: row.minPrice as string | null, image };
}
