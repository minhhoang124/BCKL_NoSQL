import { ApiError, fetchApi } from "../../services/apiClient";

export type Message = {
  id: number;
  conversationId: number;
  sequence: number;
  senderId: number;
  senderType: "BUYER" | "SELLER";
  content: string;
  createdAt: string;
  productContext?: { productId: number; storeId: number };
};
export type InboxItem = {
  id: number;
  context: "BUYER" | "SELLER";
  store: { id: number; name: string };
  buyer: { id: number; fullName: string | null };
  lastSequence: number;
  lastMessageAt: string | null;
  lastMessage: Message | null;
  lastReadSequence: number;
  unreadCount: number;
};
export type History = {
  items: Message[];
  highWatermark: number;
  hasMore: boolean;
  nextBeforeSequence: number | null;
  nextAfterSequence: number | null;
};
const bad = (): never => {
  throw new ApiError(
    "Phản hồi Chat không hợp lệ. Giữ nguyên mã gửi để kiểm tra lại.",
    502,
    "CHAT_RESPONSE_INVALID",
  );
};
function shape(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    return bad();
  return value as Record<string, unknown>;
}
function integer(value: unknown, zero = false): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < (zero ? 0 : 1) ||
    value > 2147483647
  )
    return bad();
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string") return bad();
  return value;
}
function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    return bad();
  return value;
}
export function parseMessage(value: unknown, conversationId: number): Message {
  const hasContext =
    !!value &&
    typeof value === "object" &&
    Object.hasOwn(value, "productContext");
  const row = shape(value, [
    "id",
    "conversationId",
    "sequence",
    "senderId",
    "senderType",
    "content",
    "createdAt",
    ...(hasContext ? ["productContext"] : []),
  ]);
  if (
    integer(row.conversationId) !== conversationId ||
    !["BUYER", "SELLER"].includes(String(row.senderType))
  )
    return bad();
  const content = text(row.content);
  if (!content.trim() || [...content].length > 2000) return bad();
  let productContext: Message["productContext"];
  if (hasContext) {
    const context = shape(row.productContext, ["productId", "storeId"]);
    if (content !== "Đã chia sẻ sản phẩm") return bad();
    productContext = {
      productId: integer(context.productId),
      storeId: integer(context.storeId),
    };
  }
  return {
    id: integer(row.id),
    conversationId,
    sequence: integer(row.sequence),
    senderId: integer(row.senderId),
    senderType: row.senderType as Message["senderType"],
    content,
    createdAt: date(row.createdAt),
    ...(productContext ? { productContext } : {}),
  };
}
export function parseHistory(
  value: unknown,
  conversationId: number,
  after: boolean,
): History {
  const row = shape(value, [
    "items",
    "highWatermark",
    "hasMore",
    "nextBeforeSequence",
    "nextAfterSequence",
  ]);
  if (
    !Array.isArray(row.items) ||
    row.items.length > 100 ||
    typeof row.hasMore !== "boolean"
  )
    return bad();
  const items = row.items.map((item) => parseMessage(item, conversationId));
  const highWatermark = integer(row.highWatermark, true);
  if (
    items.some(
      (m, i) =>
        m.sequence > highWatermark ||
        (i > 0 &&
          (m.sequence !== items[i - 1].sequence + 1 ||
            items.slice(0, i).some((p) => p.id === m.id))),
    )
  )
    return bad();
  const nextBeforeSequence =
    row.nextBeforeSequence === null ? null : integer(row.nextBeforeSequence);
  const nextAfterSequence =
    row.nextAfterSequence === null ? null : integer(row.nextAfterSequence);
  const expected = row.hasMore
    ? after
      ? items.at(-1)?.sequence
      : items[0]?.sequence
    : null;
  if (
    (after ? nextBeforeSequence !== null : nextAfterSequence !== null) ||
    (after ? nextAfterSequence : nextBeforeSequence) !== expected
  )
    return bad();
  return {
    items,
    highWatermark,
    hasMore: row.hasMore,
    nextBeforeSequence,
    nextAfterSequence,
  };
}
export function parseInbox(value: unknown): {
  items: InboxItem[];
  nextCursor: string | null;
} {
  const row = shape(value, ["items", "nextCursor"]);
  if (
    !Array.isArray(row.items) ||
    row.items.length > 100 ||
    (row.nextCursor !== null &&
      (typeof row.nextCursor !== "string" ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(row.nextCursor)))
  )
    return bad();
  const seen = new Set<number>();
  const items = row.items.map((raw) => {
    const item = shape(raw, [
      "id",
      "context",
      "store",
      "buyer",
      "lastSequence",
      "lastMessageAt",
      "lastMessage",
      "lastReadSequence",
      "unreadCount",
    ]);
    const id = integer(item.id);
    if (seen.has(id)) return bad();
    seen.add(id);
    const store = shape(item.store, ["id", "name"]),
      buyer = shape(item.buyer, ["id", "fullName"]);
    if (
      !["BUYER", "SELLER"].includes(String(item.context)) ||
      (buyer.fullName !== null && typeof buyer.fullName !== "string")
    )
      return bad();
    const lastSequence = integer(item.lastSequence, true),
      lastReadSequence = integer(item.lastReadSequence, true),
      unreadCount = integer(item.unreadCount, true);
    const lastMessage =
      item.lastMessage === null ? null : parseMessage(item.lastMessage, id);
    const lastMessageAt =
      item.lastMessageAt === null ? null : date(item.lastMessageAt);
    if (
      lastReadSequence > lastSequence ||
      unreadCount > lastSequence - lastReadSequence ||
      (!lastMessage && (lastSequence !== 0 || lastMessageAt !== null)) ||
      (lastMessage &&
        (lastMessage.sequence !== lastSequence ||
          lastMessage.createdAt !== lastMessageAt ||
          (lastMessage.productContext &&
            lastMessage.productContext.storeId !== store.id)))
    )
      return bad();
    return {
      id,
      context: item.context as InboxItem["context"],
      store: { id: integer(store.id), name: text(store.name) },
      buyer: {
        id: integer(buyer.id),
        fullName: buyer.fullName as string | null,
      },
      lastSequence,
      lastReadSequence,
      unreadCount,
      lastMessage,
      lastMessageAt,
    };
  });
  return { items, nextCursor: row.nextCursor as string | null };
}
async function call(path: string, body?: unknown) {
  return fetchApi<unknown>("/chat/conversations" + path, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    retryOnUnauthorized: body === undefined,
  });
}
export const chatApi = {
  async inbox(cursor?: string) {
    return parseInbox(
      await call(cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
  },
  async open(storeId: number, actorId: number) {
    const row = shape(await call("", { storeId }), [
      "id",
      "buyerId",
      "storeId",
      "lastSequence",
      "lastMessageAt",
      "createdAt",
    ]);
    if (row.storeId !== storeId || row.buyerId !== actorId) return bad();
    const lastSequence = integer(row.lastSequence, true);
    date(row.createdAt);
    if (row.lastMessageAt !== null) date(row.lastMessageAt);
    if ((lastSequence === 0) !== (row.lastMessageAt === null)) return bad();
    return { id: integer(row.id), buyerId: integer(row.buyerId) };
  },
  async history(
    id: number,
    page: { beforeSequence?: number; afterSequence?: number } = {},
  ) {
    const query = new URLSearchParams({
      limit: "30",
      ...Object.fromEntries(
        Object.entries(page).map(([k, v]) => [k, String(v)]),
      ),
    });
    const result = parseHistory(
      await call(`/${id}/messages?${query}`),
      id,
      page.afterSequence !== undefined,
    );
    if (
      result.items.some(
        (m) =>
          (page.afterSequence !== undefined &&
            m.sequence <= page.afterSequence) ||
          (page.beforeSequence !== undefined &&
            m.sequence >= page.beforeSequence),
      )
    )
      return bad();
    if (page.afterSequence !== undefined) {
      if (
        result.highWatermark < page.afterSequence ||
        (result.items[0] &&
          result.items[0].sequence !== page.afterSequence + 1) ||
        result.hasMore !==
          (result.items.at(-1)?.sequence ?? page.afterSequence) <
            result.highWatermark
      )
        return bad();
    } else {
      const last = Math.min(
        result.highWatermark,
        page.beforeSequence === undefined
          ? result.highWatermark
          : page.beforeSequence - 1,
      );
      if (
        (result.items.at(-1)?.sequence ?? 0) !== last ||
        result.hasMore !== (result.items[0]?.sequence ?? 0) > 1
      )
        return bad();
    }
    return result;
  },
  async send(
    id: number,
    actorId: number,
    clientMessageId: string,
    content: string,
    contextProductId?: number,
  ) {
    const row = shape(
      await call(
        `/${id}/messages`,
        contextProductId === undefined
          ? { clientMessageId, type: "TEXT", content }
          : { clientMessageId, type: "PRODUCT_CONTEXT", contextProductId },
      ),
      ["message", "replay"],
    );
    if (typeof row.replay !== "boolean") return bad();
    const message = parseMessage(row.message, id);
    if (
      message.senderId !== actorId ||
      message.content !==
        (contextProductId === undefined
          ? content.trim()
          : "Đã chia sẻ sản phẩm")
    )
      return bad();
    if (message.productContext?.productId !== contextProductId) return bad();
    return message;
  },
  async read(id: number, message: Message) {
    if (message.conversationId !== id) return bad();
    const row = shape(
      await call(`/${id}/read`, { lastReadMessageId: message.id }),
      ["lastReadMessageId", "lastReadSequence"],
    );
    const sequence = integer(row.lastReadSequence);
    const messageId = integer(row.lastReadMessageId);
    if (
      sequence < message.sequence ||
      (sequence === message.sequence && messageId !== message.id)
    )
      return bad();
  },
};

export function mergeMessages(
  previous: Message[],
  incoming: Message[],
): Message[] {
  const result = new Map<number, Message>();
  const identities = new Map<number, number>();
  const conversationId =
    previous[0]?.conversationId ?? incoming[0]?.conversationId;
  for (const message of [...previous, ...incoming]) {
    const old = result.get(message.sequence);
    if (
      message.conversationId !== conversationId ||
      (old &&
        (old.id !== message.id ||
          old.senderId !== message.senderId ||
          old.senderType !== message.senderType ||
          old.content !== message.content ||
          old.createdAt !== message.createdAt ||
          old.productContext?.productId !== message.productContext?.productId ||
          old.productContext?.storeId !== message.productContext?.storeId)) ||
      (identities.has(message.id) &&
        identities.get(message.id) !== message.sequence)
    )
      return bad();
    result.set(message.sequence, message);
    identities.set(message.id, message.sequence);
  }
  return [...result.values()].sort((a, b) => a.sequence - b.sequence);
}
