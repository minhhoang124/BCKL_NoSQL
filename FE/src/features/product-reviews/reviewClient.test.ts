// @vitest-environment jsdom
// @ts-expect-error Node-only test fixture, app excludes Node ambient types.
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchApi, setAccessToken } from "../../services/apiClient";
import {
  createReviewApi,
  fingerprint,
  loadPending,
  normalize,
  prepare,
  readPublic,
  type Pending,
  type Review,
} from "./reviewClient";
const key = "product-review-pending:v1:1",
  signal = () => new AbortController().signal;
const body = () => ({ confirmed: true, rating: 5, body: "Sản phẩm tốt" });
const review: Review = {
  id: 7,
  orderItemId: 12,
  productId: 3,
  storeId: 4,
  revision: 1,
  rating: 5,
  body: "Sản phẩm tốt",
  hidden: false,
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
  reply: null,
  isRefunded: false,
};
const result = (p: Pending, patch: object = {}) => ({
  commandId: p.value.commandId,
  outcome: "APPLIED",
  receipt: {
    orderItemId: 12,
    reviewId: 7,
    revision: p.value.expected.revision,
    rating: p.value.expected.rating,
    hidden: p.value.expected.hidden,
    action: p.value.action,
    auditId: "1",
    ...patch,
  },
});
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  setAccessToken("synthetic-only", 1);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("Review hash, journal, consent, recovery and identity", () => {
  it("matches independent SHA256 contract vector and normalizes Unicode", async () => {
    expect(
      await fingerprint(
        "BUYER",
        "create",
        12,
        normalize("BUYER", "create", body()),
      ),
    ).toBe("752d829d9cba1109dda10c3bc66a2cbf8b8ac6d7ccd44a933d14d280b0926449");
    expect(
      normalize("BUYER", "create", {
        ...body(),
        body: "  Nguye\u0302\u0303n\r\n😀  ",
      }).body,
    ).toBe("Nguyễn\n😀");
  });
  it.each([0, 6, "5", null])("rejects invalid rating %j", (rating) =>
    expect(() => normalize("BUYER", "create", { ...body(), rating })).toThrow(),
  );
  it("rejects unknown fields and cross-scope actions", () => {
    expect(() =>
      normalize("BUYER", "create", { ...body(), actorId: 1 }),
    ).toThrow();
    expect(() => normalize("ADMIN", "edit", body())).toThrow();
  });
  it("persists only bounded metadata, not body/reason/token", async () => {
    await prepare(1, "BUYER", "create", 12, body(), null);
    const raw = sessionStorage.getItem(key)!;
    expect(raw).not.toContain("Sản phẩm tốt");
    expect(raw).not.toContain("synthetic-only");
    expect(raw).not.toContain("reason");
    expect(loadPending(1)?.value.expected).toMatchObject({
      revision: 1,
      rating: 5,
      hidden: false,
    });
  });
  it("one actor cannot start Seller reply while Buyer command is pending", async () => {
    await prepare(1, "BUYER", "create", 12, body(), null);
    await expect(
      prepare(
        1,
        "SELLER",
        "reply",
        12,
        { confirmed: true, expectedRevision: 1, body: "Seller reply" },
        review,
      ),
    ).rejects.toThrow();
  });
  it("snapshots body and expected identity before deferred hash", async () => {
    const original = webcrypto.subtle.digest.bind(webcrypto.subtle);
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    vi.spyOn(webcrypto.subtle, "digest").mockImplementationOnce(
      async (...args: Parameters<SubtleCrypto["digest"]>) => {
        await wait;
        return original(...args);
      },
    );
    const raw = body(),
      promise = prepare(1, "BUYER", "create", 12, raw, null);
    raw.rating = 1;
    raw.body = "Mutated";
    release();
    const c = await promise;
    expect(c.body).toMatchObject({ rating: 5, body: "Sản phẩm tốt" });
    expect(c.pending.value.expected.rating).toBe(5);
  });
  it("session switch during hashing cannot persist old intent", async () => {
    const original = webcrypto.subtle.digest.bind(webcrypto.subtle);
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    vi.spyOn(webcrypto.subtle, "digest").mockImplementationOnce(
      async (...args: Parameters<SubtleCrypto["digest"]>) => {
        await wait;
        return original(...args);
      },
    );
    const promise = prepare(1, "BUYER", "create", 12, body(), null);
    setAccessToken("another-actor", 2);
    release();
    await expect(promise).rejects.toThrow();
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("corrupt or cross-account journal is fail-closed, never silently replaced", async () => {
    sessionStorage.setItem(key, "{}");
    await expect(
      prepare(1, "BUYER", "create", 12, body(), null),
    ).rejects.toThrow();
    expect(sessionStorage.getItem(key)).toBe("{}");
    sessionStorage.clear();
    await prepare(1, "BUYER", "create", 12, body(), null);
    const data = JSON.parse(sessionStorage.getItem(key)!);
    data.actorId = 2;
    sessionStorage.setItem(key, JSON.stringify(data));
    expect(() => loadPending(1)).toThrow();
  });
  it("network timeout retains exact old key/body hash and never refresh-replays POST", async () => {
    const c = await prepare(1, "BUYER", "create", 12, body(), null),
      request = vi.fn().mockRejectedValue(new TypeError("network"));
    await expect(
      createReviewApi(1, "BUYER", request as typeof fetchApi).execute(
        c.pending,
        c.body,
        signal(),
      ),
    ).rejects.toThrow();
    expect(loadPending(1)?.raw).toBe(c.pending.raw);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1].retryOnUnauthorized).toBe(false);
  });
  it.each([
    { orderItemId: 13 },
    { reviewId: 0 },
    { revision: 2 },
    { rating: 4 },
    { hidden: true },
    { action: "edit" },
    { auditId: "0" },
    { auditId: "9223372036854775808" },
  ])("wrong receipt %j cannot clear pending", async (patch) => {
    const c = await prepare(1, "BUYER", "create", 12, body(), null),
      request = vi.fn().mockResolvedValue(result(c.pending, patch));
    await expect(
      createReviewApi(1, "BUYER", request as typeof fetchApi).execute(
        c.pending,
        c.body,
        signal(),
      ),
    ).rejects.toThrow();
    expect(loadPending(1)?.raw).toBe(c.pending.raw);
  });
  it("receipt verifies all fields then removes only the same raw key", async () => {
    const c = await prepare(1, "BUYER", "create", 12, body(), null),
      request = vi.fn().mockResolvedValue(result(c.pending));
    expect(
      await createReviewApi(1, "BUYER", request as typeof fetchApi).execute(
        c.pending,
        c.body,
        signal(),
      ),
    ).toBe("APPLIED");
    expect(loadPending(1)).toBeNull();
  });
  it("CAS change during request cannot clear another pending value", async () => {
    const c = await prepare(1, "BUYER", "create", 12, body(), null),
      request = vi.fn().mockImplementation(async () => {
        sessionStorage.setItem(key, c.pending.raw + " ");
        return result(c.pending);
      });
    await expect(
      createReviewApi(1, "BUYER", request as typeof fetchApi).execute(
        c.pending,
        c.body,
        signal(),
      ),
    ).rejects.toThrow();
    expect(sessionStorage.getItem(key)).toBe(c.pending.raw + " ");
  });
  it("explicit reconciliation has no review/reason body and closes unused key", async () => {
    const c = await prepare(1, "BUYER", "create", 12, body(), null),
      request = vi.fn().mockResolvedValue({
        commandId: c.pending.value.commandId,
        outcome: "CLOSED",
        receipt: null,
      }),
      api = createReviewApi(1, "BUYER", request as typeof fetchApi);
    await expect(api.reconcile(c.pending, signal(), false)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(await api.reconcile(c.pending, signal(), true)).toBe("CLOSED");
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      commandId: c.pending.value.commandId,
      requestHash: c.pending.value.requestHash,
      confirmed: true,
    });
  });
  it("writer cannot accept CLOSED or undefined body as reconciliation", async () => {
    const c = await prepare(1, "BUYER", "create", 12, body(), null),
      request = vi.fn().mockResolvedValue({
        commandId: c.pending.value.commandId,
        outcome: "CLOSED",
        receipt: null,
      }),
      api = createReviewApi(1, "BUYER", request as typeof fetchApi);
    await expect(api.execute(c.pending, c.body, signal())).rejects.toThrow();
    await expect(
      api.execute(c.pending, undefined as never, signal()),
    ).rejects.toThrow();
    expect(loadPending(1)).not.toBeNull();
  });
  it("same actor relogin can recover with a fresh adapter; stale adapter is fenced", async () => {
    const c = await prepare(1, "BUYER", "create", 12, body(), null),
      request = vi.fn().mockResolvedValue(result(c.pending)),
      old = createReviewApi(1, "BUYER", request as typeof fetchApi);
    setAccessToken("fresh-login", 1);
    await expect(old.reconcile(c.pending, signal(), true)).rejects.toThrow();
    expect(
      await createReviewApi(1, "BUYER", request as typeof fetchApi).reconcile(
        c.pending,
        signal(),
        true,
      ),
    ).toBe("APPLIED");
  });
  it("public parser enforces exact aggregate, author allowlist and no leaked Order identity", async () => {
    const page = {
      productId: 3,
      count: 0,
      average: null,
      counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      items: [],
      nextBeforeId: null,
    };
    const request = vi.fn().mockResolvedValue(page);
    expect(
      (await readPublic(3, signal(), undefined, request as typeof fetchApi))
        .average,
    ).toBeNull();
    request.mockResolvedValue({ ...page, count: 1 });
    await expect(
      readPublic(3, signal(), undefined, request as typeof fetchApi),
    ).rejects.toThrow();
    request.mockResolvedValue({ ...page, orderItemId: 12 });
    await expect(
      readPublic(3, signal(), undefined, request as typeof fetchApi),
    ).rejects.toThrow();
  });
});
