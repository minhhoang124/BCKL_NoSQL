export type PendingMessage = {
  version: 1;
  actorId: number;
  conversationId: number;
  clientMessageId: string;
  content: string;
  contextProductId?: number;
  contextOrderId?: number;
};
const key = (actorId: number) => `chat-pending:v1:${actorId}`;
export function loadPending(
  actorId: number,
): { value: PendingMessage; raw: string } | null {
  const raw = sessionStorage.getItem(key(actorId));
  if (raw === null) return null;
  const value = JSON.parse(raw) as PendingMessage;
  if (
    !value ||
    Object.keys(value).sort().join() !==
      [
        "version",
        "actorId",
        "conversationId",
        "clientMessageId",
        "content",
        ...(Object.hasOwn(value, "contextProductId")
          ? ["contextProductId"]
          : []),
        ...(Object.hasOwn(value, "contextOrderId") ? ["contextOrderId"] : []),
      ]
        .sort()
        .join() ||
    value.version !== 1 ||
    value.actorId !== actorId ||
    !Number.isInteger(value.conversationId) ||
    value.conversationId < 1 ||
    value.conversationId > 2147483647 ||
    typeof value.clientMessageId !== "string" ||
    !/^[!-~]{1,128}$/.test(value.clientMessageId) ||
    typeof value.content !== "string" ||
    !value.content.trim() ||
    [...value.content].length > 2000 ||
    (Object.hasOwn(value, "contextProductId") &&
      (!Number.isInteger(value.contextProductId) ||
        value.contextProductId! < 1 ||
        value.contextProductId! > 2147483647 ||
        value.content !== "Đã chia sẻ sản phẩm")) ||
    (Object.hasOwn(value, "contextOrderId") &&
      (Object.hasOwn(value, "contextProductId") ||
        !Number.isInteger(value.contextOrderId) ||
        value.contextOrderId! < 1 ||
        value.contextOrderId! > 2147483647 ||
        value.content !== "Đã chia sẻ đơn hàng"))
  )
    throw Error("Dữ liệu tin chờ không hợp lệ; chưa gửi thêm tin.");
  return { value, raw };
}
export function preparePending(value: PendingMessage) {
  if (loadPending(value.actorId)) throw Error("Còn tin chờ xác minh.");
  const raw = JSON.stringify(value);
  sessionStorage.setItem(key(value.actorId), raw);
  if (sessionStorage.getItem(key(value.actorId)) !== raw)
    throw Error("Không lưu được mã gửi, chưa gửi tin.");
  return { value: { ...value }, raw };
}
export function clearPending(actorId: number, raw: string) {
  if (sessionStorage.getItem(key(actorId)) !== raw)
    throw Error("Tin chờ đã đổi; không xóa yêu cầu khác.");
  sessionStorage.removeItem(key(actorId));
  if (sessionStorage.getItem(key(actorId)) !== null)
    throw Error("Chưa xóa được mã chờ; chỉ gửi lại cùng mã.");
}
