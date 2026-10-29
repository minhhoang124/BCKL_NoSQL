import { analyticsToken } from "./searchAnalyticsClient";
import { API_URL, ApiError } from "./apiClient";
import type { Product, SearchResponse } from "../types/marketplace";

export const IMAGE_QUERY_MAX_BYTES = 5 * 1024 * 1024;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const TOP_K = 24;

export class ImageSearchError extends ApiError {
  public readonly retryAfterSeconds: number;
  constructor(message: string, status?: number, retryAfterSeconds = 0) {
    super(message, status);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function validateQueryFile(file: File) {
  if (!["image/jpeg", "image/png"].includes(file.type))
    throw new ImageSearchError("Chỉ chọn ảnh JPEG hoặc PNG.");
  if (!file.size)
    throw new ImageSearchError("Ảnh đang rỗng. Vui lòng chọn ảnh khác.");
  if (file.size > IMAGE_QUERY_MAX_BYTES)
    throw new ImageSearchError("Ảnh tối đa 5 MiB.");
}

const invalid = (): never => {
  throw new ImageSearchError(
    "Dữ liệu tìm ảnh không hợp lệ. Vui lòng thử lại sau.",
    502,
  );
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
const id = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647
    ? v
    : invalid();
const text = (v: unknown, max = 500): string =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : invalid();
const bool = (v: unknown): boolean => (typeof v === "boolean" ? v : invalid());
const price = (v: unknown): string =>
  typeof v === "string" && /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(v)
    ? v
    : invalid();
function imageUrl(value: unknown): string {
  const url = text(value, 2048);
  if (
    [...url].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return invalid();
  try {
    const parsed = new URL(url, "https://image-query.invalid");
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      return invalid();
    if (
      !/^https?:\/\//i.test(url) &&
      (!url.startsWith("/uploads/") || !parsed.pathname.startsWith("/uploads/"))
    )
      return invalid();
  } catch {
    return invalid();
  }
  return url;
}

/** Explicit display projection; never spread arbitrary upstream Product fields. */
function product(raw: unknown, expectedId: number): Product {
  const p = record(raw),
    category = record(p.category),
    store = record(p.store);
  if (
    id(p.id) !== expectedId ||
    !Array.isArray(p.images) ||
    p.images.length > 100 ||
    !Array.isArray(p.variants) ||
    p.variants.length < 1 ||
    p.variants.length > 2000
  )
    return invalid();
  const brand = p.brand === null ? null : record(p.brand);
  return {
    id: expectedId,
    name: text(p.name),
    description: null,
    store: { id: id(store.id), name: text(store.name) },
    category: {
      id: id(category.id),
      name: text(category.name),
      slug: text(category.slug),
    },
    brand: brand
      ? { id: id(brand.id), name: text(brand.name), slug: text(brand.slug) }
      : null,
    images: p.images.map((rawImage) => {
      const image = record(rawImage);
      if (
        typeof image.sortOrder !== "number" ||
        !Number.isSafeInteger(image.sortOrder) ||
        image.sortOrder < 0
      )
        return invalid();
      return {
        id: id(image.id),
        url: imageUrl(image.url),
        isPrimary: bool(image.isPrimary),
        sortOrder: image.sortOrder,
      };
    }),
    variants: p.variants.map((rawVariant) => {
      const v = record(rawVariant);
      return { id: id(v.id), price: price(v.price), inStock: bool(v.inStock) };
    }),
    minPrice: p.minPrice === null ? null : price(p.minPrice),
    maxPrice: p.maxPrice === null ? null : price(p.maxPrice),
    inStock: bool(p.inStock),
  };
}

export function parseImageSearchResults(raw: unknown): SearchResponse {
  const response = record(raw);
  if (
    Object.keys(response).some(k=>!["items","responseTimeMs","analytics"].includes(k)) ||
    !Array.isArray(response.items) ||
    response.items.length > TOP_K ||
    typeof response.responseTimeMs !== "number" ||
    !Number.isFinite(response.responseTimeMs) ||
    response.responseTimeMs < 0
  )
    return invalid();
  const seen = new Set<number>();
  let previousRank = 0;
  return {
    ...(analyticsToken(response.analytics) ? {analytics:analyticsToken(response.analytics)} : {}),
    responseTimeMs: response.responseTimeMs,
    items: response.items.map((rawItem) => {
      const item = record(rawItem),
        productId = id(item.productId),
        rank = id(item.rank);
      if (
        Object.keys(item).length !== 4 ||
        rank <= previousRank ||
        rank > TOP_K ||
        seen.has(productId) ||
        typeof item.score !== "number" ||
        !Number.isFinite(item.score)
      )
        return invalid();
      previousRank = rank;
      seen.add(productId);
      return {
        productId,
        rank,
        score: item.score,
        product: product(item.product, productId),
      };
    }),
  };
}

export async function searchImage(
  file: File,
  cancel: AbortSignal,
): Promise<SearchResponse> {
  validateQueryFile(file);
  const form = new FormData();
  form.set(
    "image",
    file,
    file.type === "image/jpeg" ? "query.jpeg" : "query.png",
  );
  form.set("topK", String(TOP_K));
  form.set("candidateK", "100");
  const deadline = AbortSignal.timeout(50000);
  const signal = AbortSignal.any([cancel, deadline]);
  try {
    const response = await fetch(`${API_URL}/search/image`, {
      method: "POST",
      body: form,
      signal,
      credentials: "include",
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      const seconds = response.headers.get("Retry-After") ?? "";
      const retry = /^(?:[1-9]\d{0,3})$/.test(seconds)
        ? Math.min(Number(seconds), 3600)
        : 0;
      const message =
        response.status === 429
          ? "Bạn tìm ảnh quá nhanh. Vui lòng chờ rồi thử lại."
          : response.status === 413
            ? "Ảnh tối đa 5 MiB."
            : response.status === 400 || response.status === 415
              ? "Ảnh không hợp lệ. Hãy chọn JPEG hoặc PNG khác."
              : response.status === 404
                ? "Tìm ảnh chưa được bật trên Backend này."
                : "Dịch vụ tìm ảnh tạm thời không khả dụng. Bạn có thể thử lại.";
      throw new ImageSearchError(message, response.status, retry);
    }
    if (
      response.headers
        .get("Content-Type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json" ||
      !response.body
    ) {
      await response.body?.cancel();
      return invalid();
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > MAX_RESULT_BYTES) return invalid();
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return parseImageSearchResults(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } catch (error) {
    if (cancel.aborted) throw error;
    if (error instanceof ImageSearchError) throw error;
    if (deadline.aborted)
      throw new ImageSearchError(
        "Tìm ảnh quá thời gian chờ. Vui lòng thử lại.",
        503,
      );
    throw new ImageSearchError(
      "Không thể đọc kết quả tìm ảnh. Kiểm tra kết nối rồi thử lại.",
    );
  }
}
