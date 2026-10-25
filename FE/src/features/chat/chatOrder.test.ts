// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatApi,
  mergeMessages,
  parseMessage,
  parseOrderCard,
} from "./chatApi";
import { clearPending, loadPending, preparePending } from "./chatPending";
import { setAccessToken } from "../../services/apiClient";
const message = {
  id: 10,
  conversationId: 7,
  sequence: 1,
  senderId: 2,
  senderType: "BUYER",
  content: "Đã chia sẻ đơn hàng",
  createdAt: "2026-10-24T00:00:00.000Z",
  orderContext: { orderId: 8, storeId: 4 },
};
const card = {
  orderId: 8,
  storeId: 4,
  orderNumber: "COD-008",
  status: "PENDING_CONFIRMATION",
  total: "20000.00",
  currency: "VND",
  createdAt: message.createdAt,
  viewer: "BUYER",
  lineCount: 1,
  items: [{ name: "<script>snapshot</script>", quantity: 2 }],
};
beforeEach(() => {
  sessionStorage.clear();
  setAccessToken("qa-only", 2);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Order Chat response/journal privacy and identity boundaries", () => {
  it("rejects an opening response swapped from Buyer to Seller context when launched from Buyer Order UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              id: 7,
              buyerId: 99,
              storeId: 4,
              lastSequence: 0,
              lastMessageAt: null,
              createdAt: message.createdAt,
              orderId: 8,
              viewer: "SELLER",
            }),
            { status: 201 },
          ),
        ),
    );
    await expect(chatApi.openOrder(8, 2, "BUYER")).rejects.toThrow();
  });
  it("typed reference, strict card and Unicode snapshots accepted without interpreting HTML", () => {
    expect(parseMessage(message, 7).orderContext).toEqual({
      orderId: 8,
      storeId: 4,
    });
    expect(parseOrderCard(card, 8, 4).items[0].name).toBe(
      "<script>snapshot</script>",
    );
  });
  it.each([
    { ...message, productContext: { productId: 8, storeId: 4 } },
    { ...message, content: "Private data" },
    { ...message, orderContext: { orderId: 0, storeId: 4 } },
    { ...message, orderContext: { orderId: 8, storeId: 4, buyerId: 2 } },
  ])("rejects malformed Order reference %#", (value) =>
    expect(() => parseMessage(value, 7)).toThrow(),
  );
  it.each([
    { ...card, orderId: 9 },
    { ...card, storeId: 5 },
    { ...card, total: 20000 },
    { ...card, total: "NaN" },
    { ...card, total: "2e4" },
    { ...card, total: "-1.00" },
    { ...card, status: "OTHER" },
    { ...card, viewer: "ADMIN" },
    { ...card, shippingAddress: {} },
    { ...card, items: [{ name: "Name", quantity: 2, phone: "private" }] },
    { ...card, lineCount: 2 },
    { ...card, items: [{ name: "", quantity: 1 }] },
    { ...card, items: [{ name: "Item", quantity: 0 }] },
  ])("rejects unbound, private, malformed or lossy card %#", (value) =>
    expect(() => parseOrderCard(value, 8, 4)).toThrow(),
  );
  it("immutable merge cannot replace an Order reference on the same message", () => {
    const parsed = parseMessage(message, 7);
    expect(() =>
      mergeMessages(
        [parsed],
        [{ ...parsed, orderContext: { orderId: 9, storeId: 4 } }],
      ),
    ).toThrow();
  });
  it("persists only Order identity/key, retries exactly, CAS clear cannot erase another intent", () => {
    const pending = preparePending({
      version: 1,
      actorId: 2,
      conversationId: 7,
      clientMessageId: "order-key",
      content: message.content,
      contextOrderId: 8,
    });
    expect(loadPending(2)).toEqual(pending);
    expect(() => clearPending(2, "different")).toThrow();
    expect(loadPending(2)).toEqual(pending);
    clearPending(2, pending.raw);
    expect(loadPending(2)).toBeNull();
  });
  it("rejects mixed Product/Order journal and keeps it fail-closed", () => {
    sessionStorage.setItem(
      "chat-pending:v1:2",
      JSON.stringify({
        version: 1,
        actorId: 2,
        conversationId: 7,
        clientMessageId: "bad",
        content: message.content,
        contextOrderId: 8,
        contextProductId: 9,
      }),
    );
    expect(() => loadPending(2)).toThrow();
  });
  it("send validates receipt identity before caller may clear its pending key", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message, replay: true }), {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await chatApi.send(7, 2, "key", message.content, undefined, 8);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      clientMessageId: "key",
      type: "ORDER_CONTEXT",
      contextOrderId: 8,
    });
    await expect(
      chatApi.send(7, 2, "key", message.content, undefined, 9),
    ).rejects.toThrow();
    await expect(
      chatApi.send(7, 2, "key", message.content, 8),
    ).rejects.toThrow();
  });
});
