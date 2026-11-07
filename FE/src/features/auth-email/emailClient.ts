import {
  AuthSessionChangedError,
  fetchApi,
  getAuthSessionVersion,
  type ApiRequestOptions,
} from "../../services/apiClient";
type Requester = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;
const invalid = (): never => {
  throw Error(
    "Chưa xác minh được phản hồi. Không tự gửi lại; hãy kiểm tra trạng thái hoặc đăng nhập lại.",
  );
};
const object = (v: unknown, keys: string[]): Record<string, unknown> =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === [...keys].sort().join(",")
    ? (v as Record<string, unknown>)
    : invalid();
export function tokenFromFragment(hash: string): string | null {
  const params = new URLSearchParams(
      hash.startsWith("#") ? hash.slice(1) : hash,
    ),
    keys = [...params.keys()];
  const token = params.get("token");
  return keys.length === 1 &&
    keys[0] === "token" &&
    token !== null &&
    /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(token)
    ? token
    : null;
}
export function createEmailApi(request: Requester = fetchApi) {
  const epoch = getAuthSessionVersion();
  const call = async (path: string, body: unknown, signal?: AbortSignal) => {
    if (epoch !== getAuthSessionVersion()) throw new AuthSessionChangedError();
    const r = await request<unknown>(path, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      retryOnUnauthorized: false,
      cache: "no-store",
      signal,
    });
    if (epoch !== getAuthSessionVersion()) throw new AuthSessionChangedError();
    return r;
  };
  return {
    async status(signal?: AbortSignal) {
      const r = object(await call("/auth/email/status", undefined, signal), [
        "email",
        "verifiedAt",
      ]);
      if (
        typeof r.email !== "string" ||
        r.email.length > 254 ||
        (r.verifiedAt !== null &&
          (typeof r.verifiedAt !== "string" ||
            !Number.isFinite(Date.parse(r.verifiedAt))))
      )
        return invalid();
      return { email: r.email, verifiedAt: r.verifiedAt as string | null };
    },
    async request(email: string | null, signal?: AbortSignal) {
      const r = object(
        await call(
          email === null
            ? "/auth/email/request"
            : "/auth/password-reset/request",
          email === null ? { confirmed: true } : { email },
          signal,
        ),
        ["status", "message"],
      );
      if (
        r.status !== "REQUEST_ACCEPTED" ||
        typeof r.message !== "string" ||
        r.message.length > 500
      )
        return invalid();
      return r.message;
    },
    async confirm(token: string, newPassword?: string, signal?: AbortSignal) {
      if (tokenFromFragment("#token=" + token) !== token) return invalid();
      const reset = newPassword !== undefined;
      const r = object(
        await call(
          reset ? "/auth/password-reset/confirm" : "/auth/email/confirm",
          { token, confirmed: true, ...(reset ? { newPassword } : {}) },
          signal,
        ),
        reset ? ["status", "reauthenticationRequired"] : ["status"],
      );
      if (
        r.status !== (reset ? "PASSWORD_RESET" : "EMAIL_VERIFIED") ||
        (reset && r.reauthenticationRequired !== true)
      )
        return invalid();
    },
  };
}
