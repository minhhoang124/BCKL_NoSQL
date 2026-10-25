// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatOrderCard } from "./ChatOrderCard";
import { chatApi, type OrderCard } from "./chatApi";
import { ApiError, setAccessToken } from "../../services/apiClient";
const card: OrderCard = {
  orderId: 8,
  storeId: 4,
  orderNumber: "COD-008",
  status: "CONFIRMED",
  total: "20000.00",
  currency: "VND",
  createdAt: "2026-10-24T00:00:00.000Z",
  viewer: "BUYER",
  lineCount: 1,
  items: [{ name: "<script>Purchased</script>", quantity: 2 }],
};
const view = (orderId = 8) => (
  <MemoryRouter>
    <ChatOrderCard
      conversationId={7}
      messageId={10}
      orderId={orderId}
      storeId={4}
    />
  </MemoryRouter>
);
beforeEach(() => setAccessToken("qa-only", 2));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("Chat private Order card lifecycle", () => {
  it("clears an already rendered card when polling receives a session-invalidating 401", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const read = vi
      .spyOn(chatApi, "orderCard")
      .mockResolvedValueOnce(card)
      .mockImplementationOnce(async () => {
        setAccessToken(null);
        throw new ApiError("Expired", 401);
      });
    render(view());
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole("article", { name: "Đơn hàng 8" }),
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("article")).toBeNull();
    expect(
      screen.getByText("Đơn hàng không còn khả dụng hoặc chưa tải được."),
    ).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("uses scoped minimal API, renders snapshots as text and links to correct owner route", async () => {
    const read = vi.spyOn(chatApi, "orderCard").mockResolvedValue(card);
    const { container } = render(view());
    expect(
      await screen.findByRole("link", { name: "Đơn COD-008" }),
    ).toHaveAttribute("href", "/account/orders/8");
    expect(read).toHaveBeenCalledWith(7, 10, 8, 4, expect.any(AbortSignal));
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>Purchased</script> × 2")).toBeVisible();
  });
  it("Seller route determined by server viewer, not assumed from browser role", async () => {
    vi.spyOn(chatApi, "orderCard").mockResolvedValue({
      ...card,
      viewer: "SELLER",
    });
    render(view());
    expect(
      await screen.findByRole("link", { name: "Đơn COD-008" }),
    ).toHaveAttribute("href", "/seller/orders/8");
  });
  it("denied card has no old snapshot or link", async () => {
    vi.spyOn(chatApi, "orderCard").mockRejectedValue(
      new ApiError("Denied", 404),
    );
    render(view());
    await screen.findByText("Đơn hàng không còn khả dụng hoặc chưa tải được.");
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("late old-account response cannot expose a card", async () => {
    let done!: (value: OrderCard) => void;
    vi.spyOn(chatApi, "orderCard").mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    render(view());
    setAccessToken("other-account", 3);
    await act(async () => done(card));
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("resource prop change resets old card and ignores its late response", async () => {
    let done!: (value: OrderCard) => void;
    vi.spyOn(chatApi, "orderCard")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            done = resolve;
          }),
      )
      .mockResolvedValue({ ...card, orderId: 9, orderNumber: "COD-009" });
    const mounted = render(view());
    mounted.rerender(view(9));
    await screen.findByRole("link", { name: "Đơn COD-009" });
    await act(async () => done(card));
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Đơn COD-008" })).toBeNull(),
    );
  });
});
