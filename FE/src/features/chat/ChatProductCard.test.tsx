// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatProductCard } from "./ChatProductCard";
import { parseChatProduct } from "./chatProductProjection";
import { parseMessage, mergeMessages, chatApi, type Message } from "./chatApi";
import { loadPending, preparePending } from "./chatPending";
import { setAccessToken } from "../../services/apiClient";

const product = {
  id: 8,
  store: { id: 4 },
  name: "<script>plain</script>",
  minPrice: "10000",
  images: [{ isPrimary: true, url: "/uploads/products/qa.png" }],
};
const message: Message = {
  id: 1,
  conversationId: 7,
  sequence: 1,
  senderId: 2,
  senderType: "BUYER",
  content: "Đã chia sẻ sản phẩm",
  createdAt: "2026-10-24T00:00:00.000Z",
  productContext: { productId: 8, storeId: 4 },
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  sessionStorage.clear();
});
describe("Product card boundary and same-key pending", () => {
  it("accepts only bound public projection and safe image schemes", () => {
    expect(parseChatProduct(product, 8, 4).name).toBe(product.name);
    for (const raw of [
      { ...product, id: 99 },
      { ...product, store: { id: 9 } },
      { ...product, images: [{ url: "javascript:alert(1)" }] },
      { ...product, images: [{ url: "/uploads/products/../../private" }] },
      { ...product, images: [{ url: "/uploads/products/%2e%2e/private" }] },
      { ...product, images: [{ url: "https://tracking.example/a.png" }] },
      { ...product, images: [null] },
      { ...product, minPrice: Infinity },
    ])
      expect(() => parseChatProduct(raw, 8, 4)).toThrow();
  });
  it("validates context reference shape and immutable identity independently of TEXT", () => {
    expect(parseMessage(message, 7)).toEqual(message);
    for (const raw of [
      { ...message, productContext: { productId: 0, storeId: 4 } },
      {
        ...message,
        productContext: { ...message.productContext, draft: "PRIVATE" },
      },
      { ...message, content: "Fake snapshot" },
    ])
      expect(() => parseMessage(raw, 7)).toThrow();
    expect(() =>
      mergeMessages(
        [message],
        [{ ...message, productContext: { productId: 99, storeId: 4 } }],
      ),
    ).toThrow();
  });
  it("preserves product reference through reload storage without storing a snapshot", () => {
    const saved = preparePending({
      version: 1,
      actorId: 2,
      conversationId: 7,
      clientMessageId: "qa-key",
      content: message.content,
      contextProductId: 8,
    });
    expect(loadPending(2)).toEqual(saved);
    expect(saved.raw).not.toContain("10000");
    expect(saved.raw).not.toContain("script");
  });
  it("sends PRODUCT_CONTEXT and rejects a receipt for another product", async () => {
    setAccessToken("qa", 2);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ message, replay: false }), {
          status: 201,
        }),
      );
    await expect(
      chatApi.send(7, 2, "qa-key", message.content, 8),
    ).resolves.toEqual(message);
    const options = fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      type: "PRODUCT_CONTEXT",
      contextProductId: 8,
      clientMessageId: "qa-key",
    });
    await expect(
      chatApi.send(7, 2, "qa-key", message.content, 99),
    ).rejects.toThrow();
  });
  it("renders a public title as text then removes the card when public access is lost", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(product), { status: 200 }),
      );
    await act(async () => {
      render(
        <MemoryRouter>
          <ChatProductCard productId={8} storeId={4} />
        </MemoryRouter>,
      );
    });
    expect(screen.getByRole("link").textContent).toBe(product.name);
    expect(document.querySelector("script")).toBeNull();
    fetch.mockResolvedValue(new Response("{}", { status: 404 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/không còn khả dụng/)).toBeTruthy();
  });
  it("does not attach an old title to a new product while its request is pending", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(product), { status: 200 }),
      );
    const tree = render(
      <MemoryRouter>
        <ChatProductCard productId={8} storeId={4} />
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(screen.getByRole("link").textContent).toBe(product.name);
    fetch.mockImplementation(() => new Promise(() => {}));
    tree.rerender(
      <MemoryRouter>
        <ChatProductCard productId={99} storeId={4} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
