import {
  fetchApi,
  getAuthSessionVersion,
  type ApiRequestOptions,
} from "../../services/apiClient";
export type Scope = "OWNER" | "ADMIN";
export type Action = "submit" | "edit" | "resubmit" | "review";
export type Status = "PENDING" | "ACTIVE" | "REJECTED" | "SUSPENDED" | "CLOSED";
export type Profile = {
  name: string;
  description: string;
  contactName: string;
  contactPhone: string;
  pickupAddress: string;
  returnAddress: string;
};
export type Body = Record<string, string | number | boolean>;
export type Summary = {
  id: number;
  ownerId: number;
  name: string;
  status: Status;
  revision: number;
};
export type View = {
  store: {
    id: number;
    name: string;
    description: string | null;
    status: Status;
  };
  ownerId: number;
  revision: number;
  profile: Omit<Profile, "name" | "description">;
  grant: { adminId: number; createdAt: string } | null;
  history: Array<{
    id: string;
    actorId: number;
    action: Action;
    fromRevision: number;
    toRevision: number;
    fromStatus: Status | null;
    toStatus: Status;
    reason: string;
    createdAt: string;
  }>;
  nextBeforeRevision: number | null;
};
export type Intent = {
  version: 1;
  actorId: number;
  scope: Scope;
  action: Action;
  targetId: number;
  commandId: string;
  requestHash: string;
  expected: {
    storeId: number | null;
    ownerId: number;
    revision: number;
    status: Status;
    grantCreated: boolean;
  };
};
export type Pending = { raw: string; value: Intent };
export type Receipt = {
  storeId: number;
  ownerId: number;
  revision: number;
  status: Status;
  auditId: string;
  grantCreated: boolean;
  reauthenticationRequired: boolean;
};
type Requester = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;
const states: Status[] = [
  "PENDING",
  "ACTIVE",
  "REJECTED",
  "SUSPENDED",
  "CLOSED",
];
const key = (actor: number) => `store-application-pending:v1:${actor}`;
export function invalid(): never {
  throw Error(
    "Dữ liệu hồ sơ hoặc biên nhận không hợp lệ; giữ nguyên mã để đối chiếu.",
  );
}
export function positive(x: unknown): number {
  if (typeof x !== "number" || !Number.isInteger(x) || x < 1 || x > 2147483647)
    return invalid();
  return x;
}
export function record(x: unknown, keys?: string[]): Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return invalid();
  if (keys && Object.keys(x).sort().join(",") !== [...keys].sort().join(","))
    return invalid();
  return x as Record<string, unknown>;
}
function text(x: unknown, min = 1, max = 1000): string {
  if (typeof x !== "string" || /[\p{Cc}\p{Cs}]/u.test(x)) return invalid();
  const value = x.normalize("NFC").trim();
  if ([...value].length < min || [...value].length > max) return invalid();
  return value;
}
function status(x: unknown): Status {
  if (typeof x !== "string" || !states.includes(x as Status)) return invalid();
  return x as Status;
}
function time(x: unknown) {
  if (
    typeof x !== "string" ||
    !/^\d{4}-\d\d-\d\dT/.test(x) ||
    !Number.isFinite(Date.parse(x))
  )
    return invalid();
  return x;
}
function bigintId(x: unknown) {
  if (
    typeof x !== "string" ||
    !/^[1-9][0-9]{0,18}$/.test(x) ||
    BigInt(x) > 9223372036854775807n
  )
    return invalid();
  return x;
}
function scopeAction(scope: Scope, action: Action) {
  if (
    !(scope === "ADMIN"
      ? action === "review"
      : scope === "OWNER" && ["submit", "edit", "resubmit"].includes(action))
  )
    invalid();
}
export function normalize(action: Action, value: unknown): Body {
  const profile = action === "submit" || action === "edit";
  const r = record(value, [
    "confirmed",
    "reason",
    ...(action === "submit" ? [] : ["expectedRevision"]),
    ...(profile
      ? [
          "name",
          "description",
          "contactName",
          "contactPhone",
          "pickupAddress",
          "returnAddress",
        ]
      : []),
    ...(action === "review" ? ["status"] : []),
  ]);
  if (r.confirmed !== true) return invalid();
  const body: Body = { confirmed: true, reason: text(r.reason, 10, 500) };
  if (action !== "submit") body.expectedRevision = positive(r.expectedRevision);
  if (profile) {
    body.name = text(r.name, 3, 120);
    body.description = text(r.description, 0, 1000);
    body.contactName = text(r.contactName, 2, 100);
    body.contactPhone = text(r.contactPhone, 9, 16);
    if (!/^\+?[0-9]{9,15}$/.test(body.contactPhone)) return invalid();
    body.pickupAddress = text(r.pickupAddress, 10, 500);
    body.returnAddress = text(r.returnAddress, 10, 500);
  }
  if (action === "review") {
    if (
      typeof r.status !== "string" ||
      !["ACTIVE", "REJECTED", "SUSPENDED"].includes(r.status)
    )
      return invalid();
    body.status = r.status;
  }
  return Object.freeze(body);
}
export async function fingerprint(
  scope: Scope,
  action: Action,
  targetId: number,
  body: Body,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ schemaVersion: 1, scope, action, targetId, body }),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function loadPending(actorId: number): Pending | null {
  positive(actorId);
  const raw = sessionStorage.getItem(key(actorId));
  if (raw === null) return null;
  if (raw.length > 1800) return invalid();
  const r = record(JSON.parse(raw), [
      "version",
      "actorId",
      "scope",
      "action",
      "targetId",
      "commandId",
      "requestHash",
      "expected",
    ]),
    e = record(r.expected, [
      "storeId",
      "ownerId",
      "revision",
      "status",
      "grantCreated",
    ]);
  if (
    r.version !== 1 ||
    r.actorId !== actorId ||
    !["OWNER", "ADMIN"].includes(r.scope as string) ||
    typeof r.commandId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      r.commandId,
    ) ||
    typeof r.requestHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(r.requestHash) ||
    typeof e.grantCreated !== "boolean"
  )
    return invalid();
  const scope = r.scope as Scope,
    action = r.action as Action;
  scopeAction(scope, action);
  const targetId = positive(r.targetId),
    ownerId = positive(e.ownerId),
    revision = positive(e.revision),
    expectedStatus = status(e.status),
    storeId = e.storeId === null ? null : positive(e.storeId);
  if (scope === "OWNER" && ownerId !== actorId) return invalid();
  if (
    action === "submit"
      ? targetId !== actorId ||
        storeId !== null ||
        revision !== 1 ||
        expectedStatus !== "PENDING" ||
        e.grantCreated
      : storeId !== targetId || revision < 2
  )
    return invalid();
  if (action === "resubmit" && expectedStatus !== "PENDING") return invalid();
  if (
    action === "edit" &&
    !["PENDING", "REJECTED", "ACTIVE"].includes(expectedStatus)
  )
    return invalid();
  if (
    action === "review" &&
    !["ACTIVE", "REJECTED", "SUSPENDED"].includes(expectedStatus)
  )
    return invalid();
  if (scope === "OWNER" && e.grantCreated) return invalid();
  if (e.grantCreated && (action !== "review" || expectedStatus !== "ACTIVE"))
    return invalid();
  return {
    raw,
    value: Object.freeze({
      version: 1,
      actorId,
      scope,
      action,
      targetId,
      commandId: r.commandId,
      requestHash: r.requestHash,
      expected: Object.freeze({
        storeId,
        ownerId,
        revision,
        status: expectedStatus,
        grantCreated: e.grantCreated,
      }),
    }),
  };
}
export async function prepare(
  actorId: number,
  scope: Scope,
  action: Action,
  targetId: number,
  input: unknown,
  view: View | null,
) {
  const session = getAuthSessionVersion();
  scopeAction(scope, action);
  positive(actorId);
  positive(targetId);
  if (loadPending(actorId))
    throw Error("Cần đối chiếu yêu cầu trước trước khi gửi mới.");
  const body = normalize(action, input),
    ownerId = action === "submit" ? actorId : positive(view?.ownerId),
    storeId = action === "submit" ? null : positive(view?.store.id);
  if (
    (scope === "OWNER" && ownerId !== actorId) ||
    (action === "submit"
      ? targetId !== actorId
      : targetId !== storeId || body.expectedRevision !== view?.revision)
  )
    return invalid();
  if (
    action === "edit" &&
    !["PENDING", "REJECTED", "ACTIVE"].includes(view!.store.status)
  )
    return invalid();
  if (action === "resubmit" && view!.store.status !== "REJECTED")
    return invalid();
  if (
    action === "review" &&
    !(
      (view!.store.status === "PENDING" &&
        ["ACTIVE", "REJECTED"].includes(body.status as string)) ||
      (view!.store.status === "ACTIVE" && body.status === "SUSPENDED") ||
      (view!.store.status === "SUSPENDED" && body.status === "ACTIVE")
    )
  )
    return invalid();
  const expectedStatus =
    action === "submit" || action === "resubmit"
      ? "PENDING"
      : action === "review"
        ? status(body.status)
        : status(view?.store.status);
  const expected = Object.freeze({
    storeId,
    ownerId,
    revision:
      action === "submit" ? 1 : positive(Number(body.expectedRevision) + 1),
    status: expectedStatus,
    grantCreated:
      action === "review" &&
      view?.store.status === "PENDING" &&
      body.status === "ACTIVE",
  });
  const commandId = crypto.randomUUID(),
    requestHash = await fingerprint(scope, action, targetId, body);
  if (
    getAuthSessionVersion() !== session ||
    sessionStorage.getItem(key(actorId)) !== null
  )
    throw Error("Phiên hoặc mã chờ đã đổi; chưa gửi yêu cầu.");
  const value: Intent = Object.freeze({
      version: 1,
      actorId,
      scope,
      action,
      targetId,
      commandId,
      requestHash,
      expected,
    }),
    raw = JSON.stringify(value);
  sessionStorage.setItem(key(actorId), raw);
  if (sessionStorage.getItem(key(actorId)) !== raw)
    throw Error("Không xác minh được lưu mã; chưa gửi.");
  return { pending: { raw, value }, body };
}
function parseView(
  value: unknown,
  actorId: number,
  scope: Scope,
  before?: number,
): View {
  const r = record(value, [
      "store",
      "ownerId",
      "revision",
      "profile",
      "grant",
      "history",
      "nextBeforeRevision",
    ]),
    s = record(r.store, ["id", "name", "description", "status"]),
    p = record(r.profile, [
      "contactName",
      "contactPhone",
      "pickupAddress",
      "returnAddress",
    ]);
  const ownerId = positive(r.ownerId),
    revision = positive(r.revision);
  if (scope === "OWNER" && ownerId !== actorId) return invalid();
  if (!Array.isArray(r.history) || r.history.length > 20) return invalid();
  let previous = before ?? 2147483648;
  const history = r.history.map((value) => {
    const h = record(value, [
        "id",
        "actorId",
        "action",
        "fromRevision",
        "toRevision",
        "fromStatus",
        "toStatus",
        "reason",
        "createdAt",
      ]),
      toRevision = positive(h.toRevision);
    if (
      !["submit", "edit", "resubmit", "review"].includes(h.action as string) ||
      toRevision >= previous ||
      toRevision > revision ||
      h.fromRevision !== toRevision - 1
    )
      return invalid();
    previous = toRevision;
    return {
      id: bigintId(h.id),
      actorId: positive(h.actorId),
      action: h.action as Action,
      fromRevision: toRevision - 1,
      toRevision,
      fromStatus: h.fromStatus === null ? null : status(h.fromStatus),
      toStatus: status(h.toStatus),
      reason: text(h.reason, 10, 500),
      createdAt: time(h.createdAt),
    };
  });
  const next =
    r.nextBeforeRevision === null ? null : positive(r.nextBeforeRevision);
  if (next !== null && (history.length !== 20 || next !== previous))
    return invalid();
  const g = r.grant === null ? null : record(r.grant, ["adminId", "createdAt"]);
  if (
    !before &&
    (!history.length ||
      history[0].toRevision !== revision ||
      history[0].toStatus !== s.status)
  )
    return invalid();
  if (
    ["ACTIVE", "SUSPENDED"].includes(s.status as string)
      ? g === null
      : ["PENDING", "REJECTED"].includes(s.status as string) && g !== null
  )
    return invalid();
  return {
    store: {
      id: positive(s.id),
      name: text(s.name, 3, 120),
      description: s.description === null ? null : text(s.description, 0, 1000),
      status: status(s.status),
    },
    ownerId,
    revision,
    profile: {
      contactName: text(p.contactName, 2, 100),
      contactPhone: text(p.contactPhone, 9, 16),
      pickupAddress: text(p.pickupAddress, 10, 500),
      returnAddress: text(p.returnAddress, 10, 500),
    },
    grant: g
      ? { adminId: positive(g.adminId), createdAt: time(g.createdAt) }
      : null,
    history,
    nextBeforeRevision: next,
  };
}
export function createApplicationApi(
  actorId: number,
  scope: Scope,
  requester: Requester = fetchApi,
) {
  const ownerRoot = "/account/store-application",
    adminRoot = "/admin/store-applications";
  const root = scope === "ADMIN" ? adminRoot : ownerRoot;
  async function send(pending: Pending, signal: AbortSignal, body?: Body) {
    const epoch = getAuthSessionVersion(),
      i = loadPending(actorId);
    if (
      !i ||
      i.raw !== pending.raw ||
      i.value.scope !== scope ||
      signal.aborted
    )
      return invalid();
    const snapshot = body ? normalize(i.value.action, body) : undefined;
    if (
      snapshot &&
      (await fingerprint(scope, i.value.action, i.value.targetId, snapshot)) !==
        i.value.requestHash
    )
      return invalid();
    signal.throwIfAborted();
    if (
      epoch !== getAuthSessionVersion() ||
      sessionStorage.getItem(key(actorId)) !== pending.raw
    )
      return invalid();
    const intent = i.value;
    const path = snapshot
      ? intent.action === "submit"
        ? ownerRoot
        : `${root}/${intent.targetId}/${intent.action}`
      : scope === "ADMIN"
        ? `${adminRoot}/${intent.targetId}/reconcile`
        : `${ownerRoot}/commands/${intent.action}/${intent.targetId}/reconcile`;
    const r = record(
      await requester(path, {
        method: "POST",
        signal,
        retryOnUnauthorized: false,
        body: JSON.stringify(
          snapshot
            ? { commandId: intent.commandId, ...snapshot }
            : {
                commandId: intent.commandId,
                requestHash: intent.requestHash,
                confirmed: true,
              },
        ),
      }),
      ["commandId", "outcome", "receipt"],
    );
    if (
      r.commandId !== intent.commandId ||
      !["APPLIED", "CLOSED"].includes(r.outcome as string)
    )
      return invalid();
    let receipt: Receipt | null = null;
    if (r.outcome === "CLOSED") {
      if (body || r.receipt !== null) return invalid();
    } else {
      const x = record(r.receipt, [
          "storeId",
          "ownerId",
          "revision",
          "status",
          "auditId",
          "grantCreated",
          "reauthenticationRequired",
        ]),
        e = intent.expected;
      const id = positive(x.storeId);
      if (
        (e.storeId !== null && e.storeId !== id) ||
        x.ownerId !== e.ownerId ||
        x.revision !== e.revision ||
        x.status !== e.status ||
        x.grantCreated !== e.grantCreated ||
        typeof x.reauthenticationRequired !== "boolean" ||
        (!e.grantCreated && x.reauthenticationRequired)
      )
        return invalid();
      receipt = {
        storeId: id,
        ownerId: positive(x.ownerId),
        revision: positive(x.revision),
        status: status(x.status),
        auditId: bigintId(x.auditId),
        grantCreated: e.grantCreated,
        reauthenticationRequired: x.reauthenticationRequired,
      };
    }
    if (
      epoch !== getAuthSessionVersion() ||
      sessionStorage.getItem(key(actorId)) !== pending.raw
    )
      return invalid();
    sessionStorage.removeItem(key(actorId));
    if (sessionStorage.getItem(key(actorId)) !== null)
      throw Error("Kết quả đã xác minh nhưng chưa xóa được mã chờ.");
    return { outcome: r.outcome as "APPLIED" | "CLOSED", receipt };
  }
  return {
    async mine(signal: AbortSignal, before?: number) {
      const envelope = record(
        await requester(
          `${ownerRoot}?limit=20${before ? `&beforeRevision=${positive(before)}` : ""}`,
          { cache: "no-store", signal },
        ),
        ["application"],
      );
      const data = envelope.application;
      return data === null ? null : parseView(data, actorId, scope, before);
    },
    async detail(id: number, signal: AbortSignal, before?: number) {
      const data = await requester(
        `${adminRoot}/${positive(id)}?limit=20${before ? `&beforeRevision=${positive(before)}` : ""}`,
        { cache: "no-store", signal },
      );
      const v = parseView(data, actorId, scope, before);
      if (v.store.id !== id) return invalid();
      return v;
    },
    async list(signal: AbortSignal, after?: number) {
      const r = record(
        await requester(
          `${adminRoot}?limit=20${after ? `&afterId=${positive(after)}` : ""}`,
          { cache: "no-store", signal },
        ),
        ["items", "nextAfterId"],
      );
      if (!Array.isArray(r.items) || r.items.length > 20) return invalid();
      let previous = after ?? 0;
      const items = r.items.map((value) => {
        const x = record(value, [
            "id",
            "ownerId",
            "name",
            "status",
            "revision",
          ]),
          id = positive(x.id);
        if (id <= previous) return invalid();
        previous = id;
        return {
          id,
          ownerId: positive(x.ownerId),
          name: text(x.name, 3, 120),
          status: status(x.status),
          revision: positive(x.revision),
        };
      });
      const next = r.nextAfterId === null ? null : positive(r.nextAfterId);
      if (next !== null && (items.length !== 20 || next !== previous))
        return invalid();
      return { items, nextAfterId: next };
    },
    execute(pending: Pending, body: Body, signal: AbortSignal) {
      if (body === undefined) return invalid();
      return send(pending, signal, body);
    },
    reconcile(pending: Pending, signal: AbortSignal, consent: boolean) {
      if (consent !== true) throw Error("Cần đồng ý đối chiếu mã yêu cầu.");
      return send(pending, signal);
    },
  };
}
export type ApplicationApi = ReturnType<typeof createApplicationApi>;
