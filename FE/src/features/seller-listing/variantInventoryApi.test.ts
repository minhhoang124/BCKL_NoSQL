// @vitest-environment jsdom
// Real FE adapter, mocked HTTP only; not DB/CAS/outbox acceptance.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthSessionVersion, setAccessToken } from "../../services/apiClient";
import { deferred } from "../order-readiness/testFixtures";
import { inventoryMoney, variantInventoryApi, type VariantEdit } from "./variantInventoryApi";

const body: VariantEdit = { expectedProductVersion: 3, expectedPrice: "10000.00", expectedStock: 5, price: "20000", stock: 6, reason: "Kiểm kê" };
const projection = () => ({ productId: 11, variantId: 71, version: 4, price: "20000.00", stock: 6 });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => setAccessToken("fixture-token", 8));
afterEach(() => { setAccessToken(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("inventoryMoney input boundary", () => {
  it.each(["1", " 25000 ", "999999999999.00"])("accepts whole positive VND %s", (value) => {
    expect(inventoryMoney(value)).toBe(value.trim().replace(/\.00$/, "") + ".00");
  });
  it.each(["", "0", "0.00", "-1", "1.01", "1.0", "1e3", "1,000", "01", "+1", "1000000000000", "NaN"])("rejects invalid or overflowing price %s", (value) => {
    expect(() => inventoryMoney(value)).toThrow();
  });
});

describe("variant inventory adapter and projection binding", () => {
  it("sends exact CAS data once and binds returned product, SKU, version, money and stock", async () => {
    const transport = vi.fn(async () => json(projection()));vi.stubGlobal("fetch", transport);
    await expect(variantInventoryApi.edit(11, 71, body, getAuthSessionVersion())).resolves.toEqual(projection());
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/seller\/products\/11\/variants\/71$/);
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body as string)).toEqual(body);
  });
  it.each([
    { productId: 12 }, { variantId: 72 }, { version: 3 }, { version: 5 },
    { price: "20000" }, { price: "1.00" }, { stock: 5 }, { stock: "6" },
    { unexpected: "field" },
  ])("rejects a well-formed projection that is not the confirmed mutation", async (change) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...projection(), ...change })));
    await expect(variantInventoryApi.edit(11, 71, body, getAuthSessionVersion())).rejects.toThrow();
  });
  it.each([null, [], {}, { productId: 11, variantId: 71, version: 4, price: "20000.00" }])("rejects missing/invalid projection fields", async (raw) => {
    vi.stubGlobal("fetch", vi.fn(async () => json(raw)));
    await expect(variantInventoryApi.edit(11, 71, body, getAuthSessionVersion())).rejects.toThrow();
  });
  it("reads the selected product with no-store and never performs a mutation", async () => {
    const transport = vi.fn(async () => json({ id: 11, variants: [] }));vi.stubGlobal("fetch", transport);
    await variantInventoryApi.read(11);
    const [url, options] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/seller\/products\/11$/);
    expect(options.cache).toBe("no-store");
    expect(options.method ?? "GET").toBe("GET");
  });
  it("rejects a stale session before PATCH dispatch", async () => {
    const epoch = getAuthSessionVersion(), transport = vi.fn();vi.stubGlobal("fetch", transport);
    setAccessToken("new-account", 9);
    await expect(variantInventoryApi.edit(11, 71, body, epoch)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects a late success from the previous session", async () => {
    const gate = deferred<Response>();vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    const request = variantInventoryApi.edit(11, 71, body, getAuthSessionVersion());
    setAccessToken("new-account", 9);gate.resolve(json(projection()));
    await expect(request).rejects.toThrow();
  });
  it("does not refresh or retry an unauthorized PATCH", async () => {
    const transport = vi.fn(async () => json({ code: "UNAUTHORIZED" }, 401));vi.stubGlobal("fetch", transport);
    await expect(variantInventoryApi.edit(11, 71, body, getAuthSessionVersion())).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("propagates uncertain transport failure after one PATCH", async () => {
    const transport = vi.fn(async () => { throw new TypeError("response lost"); });vi.stubGlobal("fetch", transport);
    await expect(variantInventoryApi.edit(11, 71, body, getAuthSessionVersion())).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
