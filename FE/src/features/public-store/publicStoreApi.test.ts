import { afterEach, expect, it, vi } from "vitest";
import { readStorePage, validateStorePage } from "./publicStoreApi";
afterEach(() => vi.unstubAllGlobals());
const product = (id = 1, storeId = 4) => ({
  id,
  name: "Public item",
  description: null,
  store: { id: storeId, name: "QA Shop" },
  category: { id: 1, name: "QA", slug: "qa" },
  brand: null,
  images: [],
  variants: [{ id: 1, price: "10000", inStock: true }],
  minPrice: "10000",
  maxPrice: "10000",
  inStock: true,
});
const page = () => ({
  store: { id: 4, name: "QA Shop", description: null },
  items: [product()],
  nextCursor: null,
});
it("accepts same-Store public projection and empty continuing page", () => {
  expect(validateStorePage(page(), 4)).toEqual(page());
  expect(
    validateStorePage({ ...page(), items: [], nextCursor: 200 }, 4).nextCursor,
  ).toBe(200);
});
it.each([
  () => ({ ...page(), store: { ...page().store, sellerId: 123 } }),
  () => ({ ...page(), store: { ...page().store, id: 9 } }),
  () => ({ ...page(), items: [product(1, 9)] }),
  () => ({ ...page(), items: [product(2), product(1)] }),
  () => ({ ...page(), items: [product(1), product(1)] }),
  () => ({ ...page(), nextCursor: 0 }),
  () => ({ ...page(), nextCursor: "1" }),
  () => ({
    ...page(),
    items: [{ ...product(), name: { private: "not text" } }],
  }),
  () => ({
    ...page(),
    items: [{ ...product(), images: [{ url: 1, isPrimary: true }] }],
  }),
])("rejects mixed/private/malformed page %#", (make) =>
  expect(() => validateStorePage(make(), 4)).toThrow(),
);
it("rejects a nonadvancing cursor and oversized page", () => {
  expect(() =>
    validateStorePage({ ...page(), items: [], nextCursor: 20 }, 4, 20),
  ).toThrow();
  expect(() =>
    validateStorePage(
      {
        ...page(),
        items: Array.from({ length: 25 }, (_, i) => product(i + 1)),
      },
      4,
    ),
  ).toThrow();
});
it("makes a bounded anonymous GET without credentials, writes or automatic retries", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(page()), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  await readStorePage(4, undefined, new AbortController().signal);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toContain("/stores/4?limit=24");
  expect(options.method).toBe("GET");
  expect(options.credentials).toBe("omit");
  expect(options.cache).toBe("no-store");
  expect(options.headers).not.toHaveProperty("Authorization");
});
it("preserves 404 and does not automatically retry failures", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(
    readStorePage(4, undefined, new AbortController().signal),
  ).rejects.toMatchObject({ status: 404 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["NaN", "-1", "100.123", {}, undefined])(
  "rejects malformed aggregate prices %j",
  (value) => {
    for (const field of ["minPrice", "maxPrice"])
      expect(() =>
        validateStorePage(
          { ...page(), items: [{ ...product(), [field]: value }] },
          4,
        ),
      ).toThrow();
  },
);

it("rejects public Product without variants", () =>
  expect(() =>
    validateStorePage(
      {
        ...page(),
        items: [{ ...product(), variants: [], minPrice: null, maxPrice: null }],
      },
      4,
    ),
  ).toThrow());
