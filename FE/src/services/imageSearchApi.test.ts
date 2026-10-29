// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseImageSearchResults,
  searchImage,
  validateQueryFile,
} from "./imageSearchApi";

const p = {
  id: 1,
  name: "QA headset",
  description: "not copied",
  category: { id: 2, name: "Audio", slug: "audio" },
  store: { id: 3, name: "Shop" },
  brand: null,
  images: [
    { id: 1, url: "/uploads/products/1/a.png", isPrimary: true, sortOrder: 0 },
  ],
  variants: [{ id: 4, price: "10000", inStock: true }],
  minPrice: "10000",
  maxPrice: "10000",
  inStock: true,
};
const response = {
  items: [{ productId: 1, rank: 2, score: -0.1, product: p }],
  responseTimeMs: 5,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("public image API trust boundary", () => {
  it("accepts canonical hydrated products, keeps rank gaps/negative cosine, projects display fields", () => {
    const value = structuredClone(response);
    const extra = { ...value.items[0].product, passwordHash: "must-not-copy" };
    const parsed = parseImageSearchResults({
      ...value,
      items: [{ ...value.items[0], product: extra }],
    });
    expect(parsed.items[0]).toMatchObject({
      rank: 2,
      score: -0.1,
      product: { id: 1, description: null },
    });
    expect(JSON.stringify(parsed)).not.toContain("must-not-copy");
  });
  it.each([
    null,
    [],
    { ...response, extra: true },
    { ...response, responseTimeMs: NaN },
    { ...response, items: [{ ...response.items[0], productId: "1" }] },
    { ...response, items: [{ ...response.items[0], rank: 0 }] },
    { ...response, items: [{ ...response.items[0], rank: 25 }] },
    { ...response, items: [{ ...response.items[0], score: Infinity }] },
    {
      ...response,
      items: [...response.items, { ...response.items[0], rank: 3 }],
    },
    ...[
      null,
      { ...p, id: 9 },
      { ...p, category: null },
      { ...p, brand: {} },
      { ...p, variants: [{ id: 4, price: 10000, inStock: true }] },
      { ...p, minPrice: "NaN" },
      { ...p, images: [{ ...p.images[0], url: "javascript:alert(1)" }] },
      { ...p, images: [{ ...p.images[0], url: "/uploads/../../private" }] },
      {
        ...p,
        images: [
          { ...p.images[0], url: "https://user:password@example.test/x" },
        ],
      },
    ].map((product) => ({
      ...response,
      items: [{ ...response.items[0], product }],
    })),
  ])("rejects malformed response %#", (value) =>
    expect(() => parseImageSearchResults(value)).toThrow(),
  );
  it.each([
    new File([], "empty.png", { type: "image/png" }),
    new File(["x"], "x.svg", { type: "image/svg+xml" }),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", {
      type: "image/png",
    }),
  ])("rejects invalid local file before HTTP", async (file) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(() => validateQueryFile(file)).toThrow();
    await expect(
      searchImage(file, new AbortController().signal),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses multipart boundary generation, a generated filename, anonymous cookie only, no Authorization/header and no retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(response), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await searchImage(
      new File(["png"], "my-private-filename.png", { type: "image/png" }),
      new AbortController().signal,
    );
    const options = fetcher.mock.calls[0][1];
    expect(options.credentials).toBe("include");
    expect(options.headers).toBeUndefined();
    expect(options.redirect).toBe("error");
    expect(options.body.get("image").name).toBe("query.png");
    expect(options.body.get("topK")).toBe("24");
    expect(options.body.get("candidateK")).toBe("100");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("preserves safe Retry-After and does not copy an upstream error body", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response("PRIVATE_UPSTREAM_DETAIL", {
          status: 429,
          headers: { "Retry-After": "12" },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      searchImage(
        new File(["png"], "x.png", { type: "image/png" }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: 12 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    new Response("{}", { headers: { "Content-Type": "text/html" } }),
    new Response("not-json", {
      headers: { "Content-Type": "application/json" },
    }),
    new Response(" ".repeat(2 * 1024 * 1024 + 1), {
      headers: { "Content-Type": "application/json" },
    }),
  ])("rejects invalid HTTP200 without returning products", async (http) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(http));
    await expect(
      searchImage(
        new File(["png"], "x.png", { type: "image/png" }),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it("passes cancellation through to fetch without retrying", async () => {
    const cancel = new AbortController();
    cancel.abort();
    const fetcher = vi.fn((_url, options) =>
      Promise.reject(options.signal.reason),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      searchImage(
        new File(["png"], "x.png", { type: "image/png" }),
        cancel.signal,
      ),
    ).rejects.toThrow();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
