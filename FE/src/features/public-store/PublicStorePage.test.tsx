// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { PublicStorePage } from "./PublicStorePage";
import { readStorePage, type PublicStorePageData } from "./publicStoreApi";
vi.mock("./publicStoreApi", () => ({ readStorePage: vi.fn() }));
const read = vi.mocked(readStorePage);
const profile = (id = 4): PublicStorePageData => ({
  store: {
    id,
    name: "QA Shop " + id,
    description: "<script>literal text only</script>",
  },
  items: [],
  nextCursor: null,
});
beforeEach(() => read.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
function View() {
  const go = useNavigate();
  return (
    <>
      <button onClick={() => go("/stores/5")}>Next Shop</button>
      <Routes>
        <Route path="/stores/:storeId" element={<PublicStorePage />} />
      </Routes>
    </>
  );
}
const show = (url = "/stores/4") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <View />
    </MemoryRouter>,
  );
it("renders public profile safely with empty-state and no auto-send", async () => {
  read.mockResolvedValue(profile());
  show();
  expect(
    await screen.findByRole("heading", { name: "QA Shop 4" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("<script>literal text only</script>"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Cửa hàng chưa có sản phẩm đang bán công khai."),
  ).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
});
it.each(["/stores/0", "/stores/01", "/stores/2147483648", "/stores/nope"])(
  "rejects invalid route %s before HTTP",
  (url) => {
    show(url);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Mã cửa hàng không hợp lệ",
    );
    expect(read).not.toHaveBeenCalled();
  },
);
it("ignores delayed results from the previous Store route", async () => {
  let resolve!: (p: PublicStorePageData) => void;
  read
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce(profile(5));
  show();
  fireEvent.click(screen.getByRole("button", { name: "Next Shop" }));
  await screen.findByRole("heading", { name: "QA Shop 5" });
  await act(async () => resolve(profile(4)));
  expect(screen.queryByRole("heading", { name: "QA Shop 4" })).toBeNull();
});
it("follows an empty scan cursor once despite same-tick double click and clears stale profile on 404", async () => {
  let reject!: (e: Error) => void;
  read
    .mockResolvedValueOnce({ ...profile(), nextCursor: 200 })
    .mockReturnValueOnce(
      new Promise((_, r) => {
        reject = r;
      }),
    );
  show();
  const more = await screen.findByRole("button", { name: "Tải thêm sản phẩm" });
  act(() => {
    more.click();
    more.click();
  });
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[1][1]).toBe(200);
  await act(async () =>
    reject(new Error("Không tìm thấy cửa hàng đang hoạt động.")),
  );
  expect(screen.queryByRole("heading", { name: "QA Shop 4" })).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("Không tìm thấy");
});
it("only retries after explicit action", async () => {
  read
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(profile());
  show();
  await screen.findByRole("alert");
  expect(read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Thử tải lại cửa hàng" }));
  await screen.findByRole("heading", { name: "QA Shop 4" });
  expect(read).toHaveBeenCalledTimes(2);
});
it("survives StrictMode effect cleanup without a stuck loading latch", async () => {
  read.mockResolvedValue(profile());
  render(
    <StrictMode>
      <MemoryRouter initialEntries={["/stores/4"]}>
        <View />
      </MemoryRouter>
    </StrictMode>,
  );
  await screen.findByRole("heading", { name: "QA Shop 4" });
  expect(screen.queryByRole("status")).toBeNull();
});
it("chat link only navigates and never sends a message", async () => {
  vi.stubEnv("VITE_CHAT_ENABLED", "true");
  read.mockResolvedValue(profile());
  show();
  await screen.findByRole("heading", { name: "QA Shop 4" });
  expect(
    screen.getByRole("link", { name: "Chat với cửa hàng" }),
  ).toHaveAttribute("href", "/messages?storeId=4");
  expect(read).toHaveBeenCalledTimes(1);
});
