import { API_URL } from "./apiClient";
let prepared: Promise<void> | undefined;
/** Prime the HttpOnly cookie before concurrent first searches in the same Web tab. */
export function prepareSearchTelemetry() {
  return (prepared ??= fetch(`${API_URL}/search/session`, {
    method: "POST",
    credentials: "include",
    signal: AbortSignal.timeout(3000),
  })
    .then(async (r) => {
      await r.body?.cancel();
    })
    .catch(() => undefined));
}

export function analyticsToken(raw: unknown): { token: string } | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  return Object.keys(value).length === 1 &&
    typeof value.token === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value.token)
    ? { token: value.token }
    : undefined;
}
/** Best effort, no authorization/refresh, no token URL or console logging. Never delays navigation. */
export function sendSearchEvent(
  token: string,
  productId: number,
  event: "IMPRESSION" | "CLICK",
) {
  if (document.visibilityState !== "visible") return;
  void fetch(`${API_URL}/search/events`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, productId, event }),
    signal: AbortSignal.timeout(3000),
  })
    .then((r) => r.body?.cancel())
    .catch(() => undefined);
}
