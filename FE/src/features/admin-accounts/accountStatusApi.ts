import {
  ApiError,
  AuthSessionChangedError,
  fetchApi,
  getAuthSessionVersion,
} from "../../services/apiClient";
export type AccountStatus = {
  id: number;
  isActive: boolean;
  statusRevision: number;
};
export type StatusIntent = {
  actorId: number;
  targetId: number;
  commandId: string;
  expectedRevision: number;
  isActive: boolean;
  reasonDigest: string;
};
export type StatusReceipt = {
  account: AccountStatus;
  auditId: string | null;
  searchReconciliation: { jobId: string; status: string } | null;
};
export type StatusResolution = {
  commandId: string;
  outcome: "APPLIED" | "NOOP" | "CLOSED";
  current: AccountStatus;
  receipt: StatusReceipt | null;
};
export type StatusAudit = {
  id: string;
  actorId: number;
  targetId: number;
  beforeActive: boolean;
  afterActive: boolean;
  fromRevision: number;
  toRevision: number;
  reason: string;
  createdAt: string;
};
export type StatusHistory = {
  account: AccountStatus;
  items: StatusAudit[];
  nextBeforeRevision: number | null;
};
const invalid = (): never => {
  throw new ApiError(
    "Phản hồi trạng thái tài khoản không hợp lệ; cần đối chiếu.",
    502,
  );
};
const integer = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 2147483647;
const bigintId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[1-9][0-9]{0,18}$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;
function shape(value: unknown, keys: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== keys
  )
    return invalid();
  return value as Record<string, unknown>;
}
export function parseAccountStatus(
  raw: unknown,
  targetId: number,
): AccountStatus {
  const row = shape(raw, "id,isActive,statusRevision");
  if (
    row.id !== targetId ||
    !integer(row.id) ||
    typeof row.isActive !== "boolean" ||
    !integer(row.statusRevision)
  )
    return invalid();
  return {
    id: row.id,
    isActive: row.isActive,
    statusRevision: row.statusRevision,
  };
}
function receipt(
  raw: unknown,
  intent: StatusIntent,
  withId: boolean,
): StatusReceipt {
  const row = shape(
    raw,
    withId
      ? "account,auditId,commandId,searchReconciliation"
      : "account,auditId,searchReconciliation",
  );
  if (withId && row.commandId !== intent.commandId) return invalid();
  const account = parseAccountStatus(row.account, intent.targetId);
  if (
    account.isActive !== intent.isActive ||
    (row.auditId !== null && !bigintId(row.auditId)) ||
    account.statusRevision !==
      intent.expectedRevision + (row.auditId === null ? 0 : 1)
  )
    return invalid();
  let searchReconciliation: StatusReceipt["searchReconciliation"] = null;
  if (row.searchReconciliation !== null) {
    const job = shape(row.searchReconciliation, "jobId,status");
    if (
      row.auditId === null ||
      !bigintId(job.jobId) ||
      !["PENDING", "PROCESSING", "FAILED", "SUCCEEDED", "DEAD"].includes(
        String(job.status),
      )
    )
      return invalid();
    searchReconciliation = { jobId: job.jobId, status: job.status as string };
  }
  return {
    account,
    auditId: row.auditId as string | null,
    searchReconciliation,
  };
}
export function parseStatusResolution(
  raw: unknown,
  intent: StatusIntent,
): StatusResolution {
  const row = shape(raw, "commandId,current,outcome,receipt");
  if (
    row.commandId !== intent.commandId ||
    !["APPLIED", "NOOP", "CLOSED"].includes(String(row.outcome))
  )
    return invalid();
  const current = parseAccountStatus(row.current, intent.targetId);
  const recorded =
    row.outcome === "CLOSED" ? null : receipt(row.receipt, intent, false);
  if (
    row.outcome === "CLOSED"
      ? row.receipt !== null
      : !recorded ||
        current.statusRevision < recorded.account.statusRevision ||
        (row.outcome === "APPLIED"
          ? recorded.auditId === null
          : recorded.auditId !== null)
  )
    return invalid();
  return {
    commandId: intent.commandId,
    outcome: row.outcome as StatusResolution["outcome"],
    current,
    receipt: recorded,
  };
}
export function parseStatusHistory(
  raw: unknown,
  targetId: number,
  beforeRevision?: number,
): StatusHistory {
  const row = shape(raw, "account,items,nextBeforeRevision"),
    account = parseAccountStatus(row.account, targetId);
  if (!Array.isArray(row.items) || row.items.length > 20) return invalid();
  let previous = beforeRevision ?? 2147483648;
  const items = row.items.map((value) => {
    const audit = shape(
      value,
      "actorId,afterActive,beforeActive,createdAt,fromRevision,id,reason,targetId,toRevision",
    );
    if (
      !bigintId(audit.id) ||
      !integer(audit.actorId) ||
      audit.targetId !== targetId ||
      !integer(audit.fromRevision) ||
      !integer(audit.toRevision) ||
      audit.toRevision !== audit.fromRevision + 1 ||
      audit.toRevision >= previous ||
      audit.toRevision > account.statusRevision ||
      typeof audit.beforeActive !== "boolean" ||
      typeof audit.afterActive !== "boolean" ||
      audit.beforeActive === audit.afterActive ||
      typeof audit.reason !== "string" ||
      [...audit.reason].length < 10 ||
      [...audit.reason].length > 500 ||
      typeof audit.createdAt !== "string" ||
      !Number.isFinite(Date.parse(audit.createdAt)) ||
      new Date(audit.createdAt).toISOString() !== audit.createdAt
    )
      return invalid();
    previous = audit.toRevision;
    return {
      id: audit.id,
      actorId: audit.actorId,
      targetId,
      beforeActive: audit.beforeActive,
      afterActive: audit.afterActive,
      fromRevision: audit.fromRevision,
      toRevision: audit.toRevision,
      reason: audit.reason,
      createdAt: audit.createdAt,
    };
  });
  if (
    row.nextBeforeRevision !== null &&
    (!integer(row.nextBeforeRevision) ||
      items.length !== 20 ||
      row.nextBeforeRevision !== previous)
  )
    return invalid();
  return {
    account,
    items,
    nextBeforeRevision: row.nextBeforeRevision as number | null,
  };
}
async function call(path: string, method = "GET", body?: unknown) {
  const version = getAuthSessionVersion();
  try {
    const raw = await fetchApi<unknown>(path, {
      method,
      cache: "no-store",
      retryOnUnauthorized: false,
      signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (version !== getAuthSessionVersion())
      throw new AuthSessionChangedError();
    return raw;
  } catch (error) {
    if (version !== getAuthSessionVersion())
      throw new AuthSessionChangedError();
    throw error;
  }
}
const path = (id: number) => {
  if (!integer(id)) throw new ApiError("ID tài khoản không hợp lệ.", 400);
  return `/admin/accounts/${id}/status`;
};
export const accountStatusApi = {
  async status(id: number) {
    return parseAccountStatus(await call(path(id)), id);
  },
  async history(id: number, beforeRevision?: number) {
    if (beforeRevision !== undefined && !integer(beforeRevision))
      return invalid();
    return parseStatusHistory(
      await call(
        path(id) +
          "/history?limit=20" +
          (beforeRevision === undefined
            ? ""
            : `&beforeRevision=${beforeRevision}`),
      ),
      id,
      beforeRevision,
    );
  },
  async write(intent: StatusIntent, reason: string) {
    const version = getAuthSessionVersion(),
      snapshot = Object.freeze({ ...intent }),
      normalized = normalizeStatusReason(reason);
    if ((await statusReasonDigest(normalized)) !== snapshot.reasonDigest)
      throw new ApiError("Lý do không khớp mã yêu cầu đã giữ; chưa gửi.", 400);
    if (version !== getAuthSessionVersion())
      throw new AuthSessionChangedError();
    return receipt(
      await call(path(snapshot.targetId), "PATCH", {
        commandId: snapshot.commandId,
        expectedRevision: snapshot.expectedRevision,
        isActive: snapshot.isActive,
        reason: normalized,
      }),
      snapshot,
      true,
    );
  },
  async reconcile(intent: StatusIntent) {
    const snapshot = Object.freeze({ ...intent });
    return parseStatusResolution(
      await call(path(snapshot.targetId) + "/reconcile", "POST", {
        commandId: snapshot.commandId,
        expectedRevision: snapshot.expectedRevision,
        isActive: snapshot.isActive,
        reasonDigest: snapshot.reasonDigest,
      }),
      snapshot,
    );
  },
};
export function normalizeStatusReason(reason: string) {
  const value = reason.normalize("NFC").trim();
  if (
    [...value].length < 10 ||
    [...value].length > 500 ||
    [...value].some((c) => {
      const n = c.codePointAt(0)!;
      return (
        (n < 32 && ![9, 10, 13].includes(n)) ||
        (n >= 127 && n <= 159) ||
        (n >= 0xd800 && n <= 0xdfff)
      );
    })
  )
    throw new ApiError(
      "Lý do cần 10–500 ký tự, không có ký tự điều khiển.",
      400,
    );
  return value;
}
export type AccountStatusApi = typeof accountStatusApi;
export async function statusReasonDigest(reason: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizeStatusReason(reason)),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
