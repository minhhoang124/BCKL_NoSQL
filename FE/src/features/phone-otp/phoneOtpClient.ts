import {
  ApiError,
  fetchApi,
  getAuthSessionVersion,
  type ApiRequestOptions,
} from "../../services/apiClient";
export interface PhoneStatus {
  channel: "SANDBOX";
  ownershipVerified: false;
  version: number;
  contact: null | {
    phoneNumber: string;
    sandboxConfirmedAt: string;
    lastChallengeId: string;
  };
  pending: null | {
    challengeId: string;
    phoneNumber: string;
    expiresAt: string;
    attemptsRemaining: number;
  };
  resendAfter: string;
}
export interface PhoneIssue {
  challengeId: string;
  phoneNumber: string;
  expiresAt: string;
  resendAfter: string;
  channel: "SANDBOX";
  demoCode: string;
  smsSent: false;
  ownershipVerified: false;
}
export interface PhoneReceipt {
  outcome: "APPLIED";
  challengeId: string;
  phoneNumber: string;
  version: number;
  sandboxConfirmedAt: string;
  channel: "SANDBOX";
  ownershipVerified: false;
  isCurrentContact: boolean;
}
export interface PhoneClosed {
  outcome: "CLOSED";
  challengeId: string;
  channel: "SANDBOX";
  ownershipVerified: false;
}
const root = "/auth/phone-otp",
  uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invalid = (): never => {
  throw new ApiError(
    "Phản hồi OTP chưa đủ để xác minh. Giữ mã yêu cầu và đối chiếu; không tự gửi lại.",
    502,
    "PHONE_OTP_INVALID_RESPONSE",
  );
};
function record(raw: unknown, keys: string[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const x = raw as Record<string, unknown>;
  if (
    Object.keys(x).length !== keys.length ||
    Object.keys(x).some((k) => !keys.includes(k))
  )
    return invalid();
  return x;
}
function id(v: unknown): string {
  if (typeof v !== "string" || !uuid.test(v)) return invalid();
  return v;
}
function integer(v: unknown, min = 0, max = 2147483647): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    return invalid();
  return v;
}
function phone(v: unknown): string {
  if (typeof v !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(v))
    return invalid();
  return v;
}
function date(v: unknown): string {
  if (
    typeof v !== "string" ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString() !== v
  )
    return invalid();
  return v;
}
function sandbox(x: Record<string, unknown>) {
  if (x.channel !== "SANDBOX" || x.ownershipVerified !== false)
    return invalid();
}
export const phoneJournalKey = (userId: number) =>
  `phone-otp-pending:v1:${userId}`;
export function loadPhoneJournal(userId: number) {
  const raw = sessionStorage.getItem(phoneJournalKey(userId));
  if (raw === null) return null;
  const x = record(JSON.parse(raw), ["version", "userId", "challengeId"]);
  if (x.version !== 1 || x.userId !== userId) return invalid();
  return { raw, challengeId: id(x.challengeId) };
}
function parseStatus(value: unknown): PhoneStatus {
  const x = record(value, [
    "channel",
    "ownershipVerified",
    "version",
    "contact",
    "pending",
    "resendAfter",
  ]);
  sandbox(x);
  const version = integer(x.version);
  let contact: PhoneStatus["contact"] = null,
    pending: PhoneStatus["pending"] = null;
  if (x.contact !== null) {
    const c = record(x.contact, [
      "phoneNumber",
      "sandboxConfirmedAt",
      "lastChallengeId",
    ]);
    contact = {
      phoneNumber: phone(c.phoneNumber),
      sandboxConfirmedAt: date(c.sandboxConfirmedAt),
      lastChallengeId: id(c.lastChallengeId),
    };
  }
  if ((version === 0) !== (contact === null)) return invalid();
  if (x.pending !== null) {
    const p = record(x.pending, [
      "challengeId",
      "phoneNumber",
      "expiresAt",
      "attemptsRemaining",
    ]);
    pending = {
      challengeId: id(p.challengeId),
      phoneNumber: phone(p.phoneNumber),
      expiresAt: date(p.expiresAt),
      attemptsRemaining: integer(p.attemptsRemaining, 1, 5),
    };
  }
  return {
    channel: "SANDBOX",
    ownershipVerified: false,
    version,
    contact,
    pending,
    resendAfter: date(x.resendAfter),
  };
}
function parseReceipt(
  value: unknown,
  expected: string,
): PhoneReceipt | PhoneClosed {
  if (!value || typeof value !== "object" || !("outcome" in value))
    return invalid();
  if (value.outcome === "CLOSED") {
    const x = record(value, [
      "outcome",
      "challengeId",
      "channel",
      "ownershipVerified",
    ]);
    sandbox(x);
    if (id(x.challengeId) !== expected) return invalid();
    return {
      outcome: "CLOSED",
      challengeId: expected,
      channel: "SANDBOX",
      ownershipVerified: false,
    };
  }
  const x = record(value, [
    "outcome",
    "challengeId",
    "phoneNumber",
    "version",
    "sandboxConfirmedAt",
    "channel",
    "ownershipVerified",
    "isCurrentContact",
  ]);
  sandbox(x);
  if (
    x.outcome !== "APPLIED" ||
    id(x.challengeId) !== expected ||
    typeof x.isCurrentContact !== "boolean"
  )
    return invalid();
  return {
    outcome: "APPLIED",
    challengeId: expected,
    phoneNumber: phone(x.phoneNumber),
    version: integer(x.version, 1),
    sandboxConfirmedAt: date(x.sandboxConfirmedAt),
    channel: "SANDBOX",
    ownershipVerified: false,
    isCurrentContact: x.isCurrentContact,
  };
}
type Requester = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;
export function createPhoneOtpClient(
  userId: number,
  requester: Requester = fetchApi,
) {
  integer(userId, 1);
  const epoch = getAuthSessionVersion(),
    slot = phoneJournalKey(userId);
  const current = () => {
    if (epoch !== getAuthSessionVersion())
      throw new ApiError(
        "Phiên đã đổi. Không cập nhật OTP của tài khoản trước.",
        0,
        "AUTH_SESSION_CHANGED",
      );
  };
  const options = (signal: AbortSignal): ApiRequestOptions => ({
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    cache: "no-store",
    retryOnUnauthorized: false,
  });
  const save = (challengeId: string, expected: string | null) => {
    current();
    if (sessionStorage.getItem(slot) !== expected) return invalid();
    const raw = JSON.stringify({ version: 1, userId, challengeId });
    sessionStorage.setItem(slot, raw);
    if (sessionStorage.getItem(slot) !== raw) return invalid();
    return raw;
  };
  const clear = (raw: string) => {
    current();
    if (sessionStorage.getItem(slot) !== raw) return invalid();
    sessionStorage.removeItem(slot);
    if (sessionStorage.getItem(slot) !== null) return invalid();
  };
  async function send(
    challengeId: string,
    body: object,
    action: "confirm" | "reconcile",
    signal: AbortSignal,
  ) {
    current();
    const saved = loadPhoneJournal(userId);
    if (!saved || saved.challengeId !== id(challengeId)) return invalid();
    const value = await requester(root + "/" + action, {
      ...options(signal),
      method: "POST",
      body: JSON.stringify(body),
    });
    current();
    const receipt = parseReceipt(value, challengeId);
    if (action === "confirm" && receipt.outcome !== "APPLIED") return invalid();
    clear(saved.raw);
    return receipt;
  }
  return {
    async status(signal: AbortSignal) {
      current();
      const raw = sessionStorage.getItem(slot),
        result = parseStatus(
          await requester(root + "/status", options(signal)),
        );
      current();
      if (sessionStorage.getItem(slot) !== raw) return invalid();
      return result;
    },
    adopt(challengeId: string) {
      const saved = loadPhoneJournal(userId);
      if (saved) {
        if (saved.challengeId !== challengeId) return invalid();
        return;
      }
      save(id(challengeId), null);
    },
    async request(
      phoneNumber: string,
      expectedVersion: number,
      signal: AbortSignal,
    ) {
      current();
      if (sessionStorage.getItem(slot) !== null) return invalid();
      phone(phoneNumber);
      integer(expectedVersion);
      const x = record(
        await requester(root + "/request", {
          ...options(signal),
          method: "POST",
          body: JSON.stringify({
            phoneNumber,
            expectedVersion,
            confirmed: true,
          }),
        }),
        [
          "challengeId",
          "phoneNumber",
          "expiresAt",
          "resendAfter",
          "channel",
          "demoCode",
          "smsSent",
          "ownershipVerified",
        ],
      );
      current();
      sandbox(x);
      if (
        phone(x.phoneNumber) !== phoneNumber ||
        x.smsSent !== false ||
        typeof x.demoCode !== "string" ||
        !/^[0-9]{6}$/.test(x.demoCode)
      )
        return invalid();
      const result: PhoneIssue = {
        challengeId: id(x.challengeId),
        phoneNumber,
        expiresAt: date(x.expiresAt),
        resendAfter: date(x.resendAfter),
        channel: "SANDBOX",
        demoCode: x.demoCode,
        smsSent: false,
        ownershipVerified: false,
      };
      if (result.resendAfter >= result.expiresAt) return invalid();
      save(result.challengeId, null);
      return result;
    },
    confirm(challengeId: string, code: string, signal: AbortSignal) {
      if (!/^[0-9]{6}$/.test(code))
        return Promise.reject(new ApiError("Mã phải gồm đúng 6 chữ số.", 400));
      return send(
        challengeId,
        { challengeId, code, confirmed: true },
        "confirm",
        signal,
      );
    },
    reconcile(challengeId: string, consent: boolean, signal: AbortSignal) {
      if (consent !== true)
        throw new Error("Cần đồng ý đối chiếu và đóng mã chưa dùng.");
      return send(
        challengeId,
        { challengeId, confirmed: true },
        "reconcile",
        signal,
      );
    },
  };
}
