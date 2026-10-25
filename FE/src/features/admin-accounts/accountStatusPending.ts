import { getAuthSessionVersion } from "../../services/apiClient";
import {
  normalizeStatusReason,
  type AccountStatus,
  type StatusIntent,
} from "./accountStatusApi";
const key = (actorId: number) => `admin-status-pending:v1:${actorId}`;
const id = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 2147483647;
export function loadStatusPending(
  actorId: number,
): { value: StatusIntent; raw: string } | null {
  const raw = sessionStorage.getItem(key(actorId));
  if (raw === null) return null;
  const fail = (): never => {
    throw Error(
      "Mã yêu cầu chờ bị hỏng; cần hỗ trợ đối chiếu, không tự xóa hoặc gửi mới.",
    );
  };
  if (raw.length > 1024) return fail();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail();
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !==
      "actorId,commandId,expectedRevision,isActive,reasonDigest,targetId" ||
    row.actorId !== actorId ||
    !id(row.actorId) ||
    !id(row.targetId) ||
    !id(row.expectedRevision) ||
    typeof row.isActive !== "boolean" ||
    typeof row.commandId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      row.commandId,
    ) ||
    typeof row.reasonDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(row.reasonDigest)
  )
    return fail();
  return {
    raw,
    value: {
      actorId,
      targetId: row.targetId,
      commandId: row.commandId,
      expectedRevision: row.expectedRevision,
      isActive: row.isActive,
      reasonDigest: row.reasonDigest,
    },
  };
}
export async function prepareStatusPending(
  actorId: number,
  account: AccountStatus,
  desired: boolean,
  reason: string,
) {
  const version = getAuthSessionVersion(),
    snapshot = Object.freeze({ ...account }),
    normalized = normalizeStatusReason(reason),
    commandId = crypto.randomUUID();
  if (
    !id(actorId) ||
    !id(snapshot.id) ||
    !id(snapshot.statusRevision) ||
    typeof desired !== "boolean" ||
    sessionStorage.getItem(key(actorId)) !== null
  )
    throw Error("Đã có yêu cầu chờ đối chiếu hoặc dữ liệu không hợp lệ.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  if (
    version !== getAuthSessionVersion() ||
    sessionStorage.getItem(key(actorId)) !== null
  )
    throw Error("Phiên hoặc mã chờ đã đổi; chưa gửi yêu cầu.");
  const value: StatusIntent = Object.freeze({
    actorId,
    targetId: snapshot.id,
    commandId,
    expectedRevision: snapshot.statusRevision,
    isActive: desired,
    reasonDigest: [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  });
  const raw = JSON.stringify(value);
  sessionStorage.setItem(key(actorId), raw);
  if (sessionStorage.getItem(key(actorId)) !== raw)
    throw Error("Không giữ được mã yêu cầu; chưa gửi.");
  return { value, raw, reason: normalized };
}
export function clearStatusPending(actorId: number, expectedRaw: string) {
  if (sessionStorage.getItem(key(actorId)) !== expectedRaw)
    throw Error("Mã chờ đã đổi; không xóa yêu cầu khác.");
  sessionStorage.removeItem(key(actorId));
}
