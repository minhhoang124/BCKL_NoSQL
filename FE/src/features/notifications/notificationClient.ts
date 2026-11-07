import {
  AuthSessionChangedError,
  fetchApi,
  getAuthSessionVersion,
  type ApiRequestOptions,
} from "../../services/apiClient";
export type Notice = {
  id: string;
  title: string;
  text: string;
  link: string;
  eventAt: string;
  createdAt: string;
  readAt: string | null;
};
export type NoticePage = {
  items: Notice[];
  nextBeforeId: string | null;
  unreadCount: number;
  throughId: string | null;
  syncPending: boolean;
};
type Requester = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;
const invalid = (): never => {
  throw new Error("Dữ liệu thông báo không hợp lệ. Vui lòng tải lại.");
};
const object = (v: unknown, keys: string[]): Record<string, unknown> =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === [...keys].sort().join(",")
    ? (v as Record<string, unknown>)
    : invalid();
export const noticeId = (v: unknown): string =>
  typeof v === "string" &&
  /^[1-9]\d{0,18}$/.test(v) &&
  BigInt(v) <= 9223372036854775807n
    ? v
    : invalid();
const count = (v: unknown): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : invalid();
const date = (v: unknown): string =>
  typeof v === "string" &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v
    ? v
    : invalid();
const text = (v: unknown, max: number): string =>
  typeof v === "string" &&
  v.trim() === v &&
  v.length > 0 &&
  [...v].length <= max &&
  !/[\p{Cc}\p{Cs}]/u.test(v)
    ? v
    : invalid();
function link(v: unknown): string {
  if (typeof v !== "string" || v.length > 200) return invalid();
  const match =
    /^(?:\/account\/(?:orders\/[1-9]\d*|aftersales|reviews\?itemId=[1-9]\d*|store-application)|\/seller(?:\/orders\/[1-9]\d*|\/aftersales|\/reviews)?|\/admin\/(?:products|stores|returns|store-applications\?storeId=[1-9]\d*)|\/messages\/[1-9]\d*)$/.test(
      v,
    );
  if (
    !match ||
    [...v.matchAll(/\d+/g)].some(([id]) => BigInt(id) > 2147483647n)
  )
    return invalid();
  return v;
}
export function parseNoticePage(value: unknown): NoticePage {
  const p = object(value, [
    "items",
    "nextBeforeId",
    "unreadCount",
    "throughId",
    "syncPending",
  ]);
  if (
    !Array.isArray(p.items) ||
    p.items.length > 50 ||
    typeof p.syncPending !== "boolean"
  )
    return invalid();
  const items = p.items.map((value) => {
    const n = object(value, [
      "id",
      "title",
      "text",
      "link",
      "eventAt",
      "createdAt",
      "readAt",
    ]);
    const item: Notice = {
      id: noticeId(n.id),
      title: text(n.title, 160),
      text: text(n.text, 400),
      link: link(n.link),
      eventAt: date(n.eventAt),
      createdAt: date(n.createdAt),
      readAt: n.readAt === null ? null : date(n.readAt),
    };
    if (item.readAt && item.readAt < item.createdAt) return invalid();
    return item;
  });
  const nextBeforeId =
    p.nextBeforeId === null ? null : noticeId(p.nextBeforeId);
  const throughId = p.throughId === null ? null : noticeId(p.throughId);
  if (
    items.some(
      (n, i) =>
        (i > 0 && BigInt(n.id) >= BigInt(items[i - 1].id)) ||
        !throughId ||
        BigInt(n.id) > BigInt(throughId),
    )
  )
    return invalid();
  if (nextBeforeId && nextBeforeId !== items.at(-1)?.id) return invalid();
  return {
    items,
    nextBeforeId,
    throughId,
    unreadCount: count(p.unreadCount),
    syncPending: p.syncPending,
  };
}
export function createNotificationApi(request: Requester = fetchApi) {
  const epoch = getAuthSessionVersion();
  const check = () => {
    if (getAuthSessionVersion() !== epoch) throw new AuthSessionChangedError();
  };
  const call = async (path: string, options: ApiRequestOptions) => {
    check();
    const result = await request<unknown>(path, options);
    check();
    return result;
  };
  return {
    async list(
      beforeId: string | null = null,
      unread: boolean | null = null,
      signal?: AbortSignal,
    ) {
      const query = new URLSearchParams({ limit: "20" });
      if (beforeId) query.set("beforeId", noticeId(beforeId));
      if (unread !== null) query.set("unread", String(unread));
      const p = parseNoticePage(
        await call(`/account/notifications?${query}`, {
          signal,
          cache: "no-store",
        }),
      );
      if (
        p.items.some(
          (n) =>
            (beforeId && BigInt(n.id) >= BigInt(beforeId)) ||
            (unread !== null && (n.readAt === null) !== unread),
        )
      )
        return invalid();
      return p;
    },
    async read(id: string, signal?: AbortSignal) {
      id = noticeId(id);
      const r = object(
        await call(`/account/notifications/${id}/read`, {
          method: "POST",
          body: JSON.stringify({ confirmed: true }),
          retryOnUnauthorized: false,
          signal,
        }),
        ["id", "readAt"],
      );
      if (noticeId(r.id) !== id) return invalid();
      return { id, readAt: date(r.readAt) };
    },
    async readAll(throughId: string, signal?: AbortSignal) {
      throughId = noticeId(throughId);
      const r = object(
        await call("/account/notifications/read-all", {
          method: "POST",
          body: JSON.stringify({ confirmed: true, throughId }),
          retryOnUnauthorized: false,
          signal,
        }),
        ["throughId", "changed"],
      );
      if (noticeId(r.throughId) !== throughId) return invalid();
      return { throughId, changed: count(r.changed) };
    },
  };
}
