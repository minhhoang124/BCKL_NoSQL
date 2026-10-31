// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen, waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageSearchPage } from "./ImageSearchPage";
import * as api from "../services/imageSearchApi";
import type { SearchResponse } from "../types/marketplace";
const primer=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));
vi.mock('../services/searchAnalyticsClient',async original=>({...await original<typeof import('../services/searchAnalyticsClient')>(),prepareSearchTelemetry:primer}));
const auth = vi.hoisted(() => ({
  user: null as { id: number; isActive: boolean } | null,
  loading: false,
}));
vi.mock("../contexts/useAuth", () => ({ useAuth: () => auth }));
const result = (id = 1): SearchResponse => ({
  responseTimeMs: 10,
  items: [
    {
      productId: id,
      rank: 1,
      score: 0.1,
      product: {
        id,
        name: `Product ${id}`,
        description: null,
        category: { id: 1, name: "Audio", slug: "audio" },
        brand: null,
        images: [],
        variants: [{ id: 1, price: "10000" }],
      },
    },
  ],
});
function view() {
  return (
    <MemoryRouter>
      <ImageSearchPage />
    </MemoryRouter>
  );
}
function choose(name = "x.png", type = "image/png", load = true) {
  fireEvent.change(screen.getByLabelText("Ảnh JPEG hoặc PNG, tối đa 5 MiB"), {
    target: { files: [new File(["png"], name, { type })] },
  });
  if (load) {
    const image = screen.getByAltText("Ảnh đang dùng để tìm kiếm");
    Object.defineProperties(image, {
      naturalWidth: { value: 8, configurable: true },
      naturalHeight: { value: 8, configurable: true },
    });
    fireEvent.load(image);
  }
}
beforeEach(() => {
  primer.mockReset().mockResolvedValue(undefined);
  auth.user = null;
  auth.loading = false;
  let sequence = 0;
  const OriginalURL = URL;
  vi.stubGlobal(
    "URL",
    class extends OriginalURL {
      static createObjectURL = vi.fn(() => `blob:query-${++sequence}`);
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("image query page lifecycle", () => {
  it('stops before upload when cancelled during anonymous session preparation',async()=>{
    let release!:()=>void;primer.mockReturnValue(new Promise<void>(r=>{release=r;}));
    const search=vi.spyOn(api,'searchImage');render(view());choose();fireEvent.click(screen.getByRole('button',{name:'Tìm bằng ảnh'}));
    fireEvent.click(screen.getByRole('button',{name:'Dừng chờ kết quả'}));await act(async()=>{release();});expect(search).not.toHaveBeenCalled();
  });
  it("never sends on mount or selection; waits for preview and explicit submit", async () => {
    const search = vi.spyOn(api, "searchImage").mockResolvedValue(result());
    render(view());
    choose("x.png", "image/png", false);
    expect(screen.getByRole("button", { name: "Tìm bằng ảnh" })).toBeDisabled();
    expect(search).not.toHaveBeenCalled();
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Tìm bằng ảnh" }));
    await screen.findByRole("link", { name: "Product 1" });
    expect(search).toHaveBeenCalledOnce();
  });
  it("blocks same-tick submits under StrictMode and exposes stop", async () => {
    let resolve!: (value: SearchResponse) => void;
    const search = vi.spyOn(api, "searchImage").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<StrictMode>{view()}</StrictMode>);
    choose();
    const form = screen
      .getByRole("button", { name: "Tìm bằng ảnh" })
      .closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(()=>expect(search).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Dừng chờ kết quả" }));
    expect(search.mock.calls[0][1].aborted).toBe(true);
    await act(async () => resolve(result(9)));
    expect(
      screen.queryByRole("link", { name: "Product 9" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Đã dừng chờ/)).toBeInTheDocument();
  });
  it("ignores old finally/response after image changes and a second request starts", async () => {
    let resolve!: (value: SearchResponse) => void;
    const search = vi
      .spyOn(api, "searchImage")
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(result(2));
    render(view());
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Tìm bằng ảnh" }));
    await waitFor(()=>expect(search).toHaveBeenCalledOnce());
    choose("new.png");
    fireEvent.click(screen.getByRole("button", { name: "Tìm bằng ảnh" }));
    await screen.findByRole("link", { name: "Product 2" });
    await act(async () => resolve(result(1)));
    expect(
      screen.queryByRole("link", { name: "Product 1" }),
    ).not.toBeInTheDocument();
    expect(search.mock.calls[0][1].aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:query-1");
  });
  it("clears the query photo and aborts on account boundary, not only on HTTP completion", async () => {
    let resolve!: (value: SearchResponse) => void;
    const search = vi.spyOn(api, "searchImage").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const ui = render(view());
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Tìm bằng ảnh" }));
    await waitFor(()=>expect(search).toHaveBeenCalledOnce());
    auth.user = { id: 2, isActive: true };
    ui.rerender(view());
    expect(
      screen.queryByAltText("Ảnh đang dùng để tìm kiếm"),
    ).not.toBeInTheDocument();
    expect(search.mock.calls[0][1].aborted).toBe(true);
    await act(async () => resolve(result(1)));
    expect(
      screen.queryByRole("link", { name: "Product 1" }),
    ).not.toBeInTheDocument();
  });
  it("rejects unsupported or undecodable preview without an API call", () => {
    const search = vi.spyOn(api, "searchImage");
    render(view());
    choose("x.svg", "image/svg+xml", false);
    expect(screen.getByRole("alert")).toHaveTextContent("JPEG");
    choose("bad.png", "image/png", false);
    fireEvent.error(screen.getByAltText("Ảnh đang dùng để tìm kiếm"));
    expect(screen.getByRole("button", { name: "Tìm bằng ảnh" })).toBeDisabled();
    expect(search).not.toHaveBeenCalled();
  });
  it("preserves a manual retry after errors; cooldown never auto-sends", async () => {
    vi.useFakeTimers();
    const search = vi
      .spyOn(api, "searchImage")
      .mockRejectedValueOnce(new api.ImageSearchError("Chờ một chút", 429, 2))
      .mockResolvedValue({ items: [], responseTimeMs: 1 });
    render(view());
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Tìm bằng ảnh" }));
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("Chờ một chút");
    expect(screen.getByRole("button", { name: "Tìm bằng ảnh" })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001);
    });
    expect(search).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Tìm bằng ảnh" }));
    await act(async () => {});
    expect(
      screen.getByText(/Không có kết quả phù hợp/),
    ).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });
  it("revokes local URLs on clear and unmount without a duplicate revoke", () => {
    const ui = render(view());
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ ảnh" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    ui.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
