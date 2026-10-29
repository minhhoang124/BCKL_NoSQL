// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SearchResultCard } from "./searchTelemetry";
import { analyticsToken } from "./searchAnalyticsClient";
import type { Product } from "../types/marketplace";
const token = "a".repeat(43);
const product = {
  id: 1,
  name: "QA product",
  category: { id: 1, name: "QA", slug: "qa" },
  brand: null,
  description: null,
  images: [],
  variants: [{ id: 1, price: "10000" }],
} as Product;
describe("Viewport telemetry, dedupe and non-blocking product navigation", () => {
  let callback: IntersectionObserverCallback,
    observer: {
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    };
  beforeEach(() => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    observer = { observe: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(fn: IntersectionObserverCallback) {
          callback = fn;
        }
        observe = observer.observe;
        disconnect = observer.disconnect;
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const show = (t: string | undefined = token) =>
    render(
      <MemoryRouter>
        <SearchResultCard product={product} token={t} />
      </MemoryRouter>,
    );
  const intersect = (visible: boolean) =>
    act(() =>
      callback(
        [{ isIntersecting: visible } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
  it("validates optional capability without trusting extra fields", () => {
    expect(analyticsToken({ token })).toEqual({ token });
    for (const v of [null, "x", { token: "bad" }, { token, storeId: 2 }])
      expect(analyticsToken(v)).toBeUndefined();
  });
  it("only acknowledges the first viewport intersection and disconnects on unmount", () => {
    const view = show();
    expect(fetch).not.toHaveBeenCalled();
    intersect(false);
    intersect(true);
    intersect(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string),
    ).toEqual({ token, productId: 1, event: "IMPRESSION" });
    view.unmount();
    expect(observer.disconnect).toHaveBeenCalled();
  });
  it("waits for document visibility rather than counting a background tab", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    show();
    intersect(true);
    expect(fetch).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("uses keepalive for keyboard/click and middle-click while leaving links usable", () => {
    show();
    const link = screen.getByRole("link", { name: "QA product" });
    fireEvent.click(link);
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({
      keepalive: true,
      credentials: "include",
    });
    expect(link).toHaveAttribute("href", "/products/1");
  });
  it("does not track catalog cards without search proof", () => {
    render(
      <MemoryRouter>
        <SearchResultCard product={product} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "QA product" }));
    expect(fetch).not.toHaveBeenCalled();
    expect(observer.observe).not.toHaveBeenCalled();
  });
  it("does not make analytics failure a navigation error", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    show();
    fireEvent.click(screen.getByRole("link", { name: "QA product" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("link", { name: "QA product" })).toHaveAttribute(
      "href",
      "/products/1",
    );
  });
});
