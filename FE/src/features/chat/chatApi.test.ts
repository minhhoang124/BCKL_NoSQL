// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  chatApi,
  mergeMessages,
  parseHistory,
  parseInbox,
  parseMessage,
  type Message,
} from "./chatApi";
import {
  clearPending,
  loadPending,
  preparePending,
  type PendingMessage,
} from "./chatPending";
import { setAccessToken } from "../../services/apiClient";
const message: Message = {
  id: 10,
  conversationId: 7,
  sequence: 1,
  senderId: 2,
  senderType: "BUYER",
  content: "<b>text</b>",
  createdAt: "2026-10-24T00:00:00.000Z",
};
const pending: PendingMessage = {
  version: 1,
  actorId: 2,
  conversationId: 7,
  clientMessageId: "safe-key",
  content: "Text",
};
beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  setAccessToken("qa-only", 2);
});
describe("Chat runtime response boundary", () => {
  it("accepts literal text but does not interpret it as HTML", () =>
    expect(parseMessage(message, 7)).toEqual(message));
  it.each([
    { ...message, conversationId: 8 },
    { ...message, sequence: 0 },
    { ...message, senderType: "ADMIN" },
    { ...message, createdAt: "bad" },
    { ...message, content: "" },
    { ...message, payloadHash: "secret" },
  ])("rejects malformed or unbound Message %j", (value) =>
    expect(() => parseMessage(value, 7)).toThrow(),
  );
  it("validates history direction, monotonic order, IDs and exact cursor", () => {
    const page = {
      items: [message],
      highWatermark: 1,
      hasMore: false,
      nextBeforeSequence: null,
      nextAfterSequence: null,
    };
    expect(parseHistory(page, 7, false).items).toHaveLength(1);
    expect(() =>
      parseHistory({ ...page, highWatermark: 0 }, 7, false),
    ).toThrow();
    expect(() => parseHistory({ ...page, hasMore: true }, 7, false)).toThrow();
    expect(() =>
      parseHistory({ ...page, items: [message, message] }, 7, false),
    ).toThrow();
    expect(() =>
      parseHistory({ ...page, nextBeforeSequence: 1 }, 7, true),
    ).toThrow();
  });
  it("rejects impossible inbox metadata and unknown profile fields", () => {
    const row = {
      id: 7,
      context: "BUYER",
      store: { id: 4, name: "Shop" },
      buyer: { id: 2, fullName: null },
      lastSequence: 1,
      lastMessageAt: message.createdAt,
      lastMessage: message,
      lastReadSequence: 0,
      unreadCount: 0,
    };
    expect(parseInbox({ items: [row], nextCursor: null }).items).toHaveLength(
      1,
    );
    for (const value of [
      { ...row, unreadCount: 2 },
      { ...row, lastReadSequence: 2 },
      { ...row, lastMessage: null },
      { ...row, buyer: { ...row.buyer, email: "private@example.test" } },
    ])
      expect(() => parseInbox({ items: [value], nextCursor: null })).toThrow();
  });
  it("dedupes immutable messages by sequence and rejects identity/content collisions", () => {
    expect(mergeMessages([message], [message])).toEqual([message]);
    expect(() =>
      mergeMessages([message], [{ ...message, content: "changed" }]),
    ).toThrow();
    expect(() =>
      mergeMessages([message], [{ ...message, sequence: 2 }]),
    ).toThrow();
  });
  it("rejects malformed HTTP200 before acknowledging pending send and does not replay 401", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            message: { ...message, senderId: 99 },
            replay: false,
          }),
          { status: 200 },
        ),
      );
    await expect(chatApi.send(7, 2, "key", message.content)).rejects.toThrow();
    fetch.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(chatApi.send(7, 2, "key", message.content)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects a shaped HTTP200 that would silently skip a committed sequence", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ ...message, sequence: 2 }],
          highWatermark: 2,
          hasMore: false,
          nextBeforeSequence: null,
          nextAfterSequence: null,
        }),
        { status: 200 },
      ),
    );
    await expect(chatApi.history(7, { afterSequence: 0 })).rejects.toThrow();
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [],
          highWatermark: 3,
          hasMore: false,
          nextBeforeSequence: null,
          nextAfterSequence: null,
        }),
        { status: 200 },
      ),
    );
    await expect(chatApi.history(7, { afterSequence: 1 })).rejects.toThrow();
    await expect(chatApi.history(7)).rejects.toThrow();
  });
  it("rejects comma-joined missing open metadata and malformed canonical dates", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const value of [
      { id: 7, buyerId: 2, storeId: 4, "createdAt,lastMessageAt,lastSequence": null },
      { id: 7, buyerId: 2, storeId: 4, lastSequence: 0, lastMessageAt: null, createdAt: "bad" },
    ]) {
      fetch.mockResolvedValue(new Response(JSON.stringify(value), { status: 200 }));
      await expect(chatApi.open(4, 2)).rejects.toThrow();
    }
  });
  it("rejects impossible unread counts above the unread sequence interval", () => {
    expect(() => parseInbox({ items: [{
      id: 7, context: "BUYER", store: { id: 4, name: "Shop" },
      buyer: { id: 2, fullName: null }, lastSequence: 1,
      lastMessageAt: message.createdAt, lastMessage: message,
      lastReadSequence: 1, unreadCount: 1,
    }], nextCursor: null })).toThrow();
  });
  it("binds a read receipt to the displayed message at the same sequence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      lastReadMessageId: 99, lastReadSequence: message.sequence,
    }), { status: 200 }));
    await expect(chatApi.read(7, message)).rejects.toThrow();
  });
  it("rejects cross-conversation merges and corrupted previous identities", () => {
    expect(() => mergeMessages([message], [{ ...message, id: 11, conversationId: 8, sequence: 2 }])).toThrow();
    expect(() => mergeMessages([message, { ...message, sequence: 2 }], [])).toThrow();
  });
  it("compares immutable fields rather than object property insertion order", () => {
    const reordered = Object.fromEntries(Object.entries(message).reverse()) as Message;
    expect(mergeMessages([message], [reordered])).toEqual([message]);
  });
  it("accepts canonical open metadata and a read cursor advanced by another tab", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    fetch.mockResolvedValue(new Response(JSON.stringify({
      id: 7, buyerId: 2, storeId: 4, lastSequence: 0,
      lastMessageAt: null, createdAt: message.createdAt,
    }), { status: 200 }));
    await expect(chatApi.open(4, 2)).resolves.toEqual({ id: 7, buyerId: 2 });
    fetch.mockResolvedValue(new Response(JSON.stringify({
      lastReadMessageId: message.id, lastReadSequence: message.sequence,
    }), { status: 200 }));
    await expect(chatApi.read(7, message)).resolves.toBeUndefined();
    fetch.mockResolvedValue(new Response(JSON.stringify({
      lastReadMessageId: 99, lastReadSequence: message.sequence + 1,
    }), { status: 200 }));
    await expect(chatApi.read(7, message)).resolves.toBeUndefined();
  });
});
describe("Chat pending session journal", () => {
  it("persists before HTTP, isolates actor, and clears only matching raw receipt", () => {
    const saved = preparePending(pending);
    expect(loadPending(2)).toEqual(saved);
    expect(loadPending(3)).toBeNull();
    expect(() => preparePending(pending)).toThrow();
    expect(() => clearPending(2, "wrong")).toThrow();
    expect(loadPending(2)).toEqual(saved);
    clearPending(2, saved.raw);
    expect(loadPending(2)).toBeNull();
  });
  it("fails closed on silent writes and corrupted storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    expect(() => preparePending(pending)).toThrow("Không lưu");
    vi.restoreAllMocks();
    sessionStorage.setItem("chat-pending:v1:2", "bad");
    expect(() => loadPending(2)).toThrow();
  });
  it("preserves a newer journal instead of deleting it with an old completion", () => {
    const first = preparePending(pending);
    sessionStorage.setItem(
      "chat-pending:v1:2",
      JSON.stringify({ ...pending, clientMessageId: "new" }),
    );
    expect(() => clearPending(2, first.raw)).toThrow();
    expect(loadPending(2)?.value.clientMessageId).toBe("new");
  });
});
