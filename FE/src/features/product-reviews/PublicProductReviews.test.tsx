// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "./reviewClient";
import { PublicProductReviews } from "./PublicProductReviews";
const stamp = "2026-10-26T00:00:00.000Z";
const data = (
  productId: number,
  body = "Synthetic public review",
): client.PublicPage => ({
  productId,
  count: 1,
  average: 5,
  counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
  items: [
    {
      id: 7,
      rating: 5,
      body,
      author: "Người mua đã xác minh",
      createdAt: stamp,
      updatedAt: stamp,
      reply: null,
      isRefunded: false,
    },
  ],
  nextBeforeId: null,
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("Public Review display and stale Product isolation", () => {
  it("renders review content as text and never executes supplied HTML", async () => {
    vi.spyOn(client, "readPublic").mockResolvedValue(
      data(3, "<img src=x onerror=alert(1)>"),
    );
    const r = render(<PublicProductReviews productId={3} />);
    await screen.findByText("<img src=x onerror=alert(1)>");
    expect(r.container.querySelector("img")).toBeNull();
    expect(screen.getByText("5/5 từ 1 đánh giá")).toBeInTheDocument();
  });
  it("late result from a previous Product cannot replace current reviews", async () => {
    let release!: (p: client.PublicPage) => void;
    vi.spyOn(client, "readPublic").mockImplementation((id) =>
      id === 3
        ? new Promise((r) => {
            release = r;
          })
        : Promise.resolve(data(4, "New product review")),
    );
    const r = render(<PublicProductReviews productId={3} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    r.rerender(<PublicProductReviews productId={4} />);
    await screen.findByText("New product review");
    await act(async () => {
      release(data(3, "Old product review"));
    });
    expect(screen.queryByText("Old product review")).not.toBeInTheDocument();
  });
  it("failed public refresh clears old content and offers a read retry", async () => {
    vi.spyOn(client, "readPublic")
      .mockResolvedValueOnce(data(3))
      .mockRejectedValueOnce(Error("Public read denied"));
    render(<PublicProductReviews productId={3} />);
    await screen.findByText("Synthetic public review");
    fireEvent.click(
      screen.getByRole("button", { name: "Tải lại đánh giá sản phẩm" }),
    );
    await screen.findByRole("alert");
    expect(
      screen.queryByText("Synthetic public review"),
    ).not.toBeInTheDocument();
  });
});
