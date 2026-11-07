// @vitest-environment jsdom
// @ts-expect-error Node-only fixture; browser app excludes Node ambient types.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchApi, setAccessToken } from "../../services/apiClient";
import {
  createApplicationApi,
  fingerprint,
  loadPending,
  normalize,
  prepare,
  type Intent,
  type Pending,
  type View,
} from "./applicationClient";
const profile = {
  name: "QA Store",
  description: "",
  contactName: "QA Owner",
  contactPhone: "+84901234567",
  pickupAddress: "Synthetic pickup address 01",
  returnAddress: "Synthetic return address 02",
};
const input = () => ({
  confirmed: true,
  reason: "QA explicit Store application decision",
  ...profile,
});
const key = "store-application-pending:v1:1";
const receipt = (p: Pending, patch: object = {}) => ({
  commandId: p.value.commandId,
  outcome: "APPLIED",
  receipt: {
    storeId: p.value.expected.storeId ?? 7,
    ownerId: p.value.expected.ownerId,
    revision: p.value.expected.revision,
    status: p.value.expected.status,
    auditId: "1",
    grantCreated: p.value.expected.grantCreated,
    reauthenticationRequired: false,
    ...patch,
  },
});
export const viewFixture: View = {
  store: { id: 7, name: profile.name, description: null, status: "PENDING" },
  ownerId: 1,
  revision: 1,
  profile: {
    contactName: profile.contactName,
    contactPhone: profile.contactPhone,
    pickupAddress: profile.pickupAddress,
    returnAddress: profile.returnAddress,
  },
  grant: null,
  history: [
    {
      id: "1",
      actorId: 1,
      action: "submit",
      fromRevision: 0,
      toRevision: 1,
      fromStatus: null,
      toStatus: "PENDING",
      reason: "QA explicit Store application decision",
      createdAt: "2026-10-26T00:00:00.000Z",
    },
  ],
  nextBeforeRevision: null,
};
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  setAccessToken("synthetic-only", 1);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("Store application journal/hash/receipt fences", () => {
  it("requires explicit application:null to prove there is no Store", async () => {
    const request = vi.fn().mockResolvedValue({ application: null });
    expect(
      await createApplicationApi(1, "OWNER", request as typeof fetchApi).mine(
        new AbortController().signal,
      ),
    ).toBeNull();
    request.mockResolvedValue({});
    await expect(
      createApplicationApi(1, "OWNER", request as typeof fetchApi).mine(
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    request.mockResolvedValue(null);
    await expect(
      createApplicationApi(1, "OWNER", request as typeof fetchApi).mine(
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it("validates the owner identity inside a nonempty application envelope", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ application: structuredClone(viewFixture) });
    expect(
      (
        await createApplicationApi(1, "OWNER", request as typeof fetchApi).mine(
          new AbortController().signal,
        )
      )?.store.id,
    ).toBe(7);
    request.mockResolvedValue({
      application: { ...structuredClone(viewFixture), ownerId: 2 },
    });
    await expect(
      createApplicationApi(1, "OWNER", request as typeof fetchApi).mine(
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it("matches Backend canonical UTF8 SHA256 and persists metadata without contact/reason/body/token", async () => {
    const candidate = await prepare(1, "OWNER", "submit", 1, input(), null);
    expect(candidate.pending.value.requestHash).toBe(
      createHash("sha256")
        .update(
          JSON.stringify({
            schemaVersion: 1,
            scope: "OWNER",
            action: "submit",
            targetId: 1,
            body: normalize("submit", input()),
          }),
        )
        .digest("hex"),
    );
    expect(candidate.pending.raw).not.toMatch(
      /contactName|contactPhone|pickupAddress|returnAddress|reason|token|body/,
    );
    expect(candidate.pending.raw).not.toContain(profile.name);
    expect(loadPending(1)?.raw).toBe(candidate.pending.raw);
  });
  it("snapshots the input before await digest", async () => {
    const actual = webcrypto.subtle.digest.bind(webcrypto.subtle);
    let release!: () => void;
    vi.spyOn(webcrypto.subtle, "digest").mockImplementationOnce(
      (algorithm: AlgorithmIdentifier, data: BufferSource) =>
        new Promise((resolve) => {
          release = () => void actual(algorithm, data).then(resolve);
        }),
    );
    const body = input(),
      flight = prepare(1, "OWNER", "submit", 1, body, null);
    body.name = "Changed while hashing";
    body.reason = "Changed reason while hashing";
    release();
    const result = await flight;
    expect(result.body.name).toBe(profile.name);
    expect(result.body.reason).toBe("QA explicit Store application decision");
    expect(Object.isFrozen(result.body)).toBe(true);
  });
  it("serializes concurrent preparations by storage CAS", async () => {
    const results = await Promise.allSettled([
      prepare(1, "OWNER", "submit", 1, input(), null),
      prepare(1, "OWNER", "submit", 1, input(), null),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
  });
  it("rejects session change during digest before storage or HTTP", async () => {
    const actual = webcrypto.subtle.digest.bind(webcrypto.subtle);
    let release!: () => void;
    vi.spyOn(webcrypto.subtle, "digest").mockImplementationOnce(
      (algorithm: AlgorithmIdentifier, data: BufferSource) =>
        new Promise((resolve) => {
          release = () => void actual(algorithm, data).then(resolve);
        }),
    );
    const flight = prepare(1, "OWNER", "submit", 1, input(), null);
    setAccessToken("new-session", 2);
    release();
    await expect(flight).rejects.toThrow();
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("retains old metadata across same-account reauthentication and explicitly resolves it", async () => {
    const c = await prepare(1, "OWNER", "submit", 1, input(), null);
    setAccessToken("post-promotion-session", 1);
    const request = vi.fn().mockResolvedValue(receipt(c.pending));
    await createApplicationApi(
      1,
      "OWNER",
      request as typeof fetchApi,
    ).reconcile(loadPending(1)!, new AbortController().signal, true);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      commandId: c.pending.value.commandId,
      requestHash: c.pending.value.requestHash,
      confirmed: true,
    });
    expect(loadPending(1)).toBeNull();
  });
  it("snapshots dispatch body during digest and never sends its later mutation", async () => {
    const c = await prepare(1, "OWNER", "submit", 1, input(), null),
      request = vi.fn().mockResolvedValue(receipt(c.pending));
    const actual = webcrypto.subtle.digest.bind(webcrypto.subtle);
    let release!: () => void;
    vi.spyOn(webcrypto.subtle, "digest").mockImplementationOnce(
      (algorithm: AlgorithmIdentifier, data: BufferSource) =>
        new Promise((resolve) => {
          release = () => void actual(algorithm, data).then(resolve);
        }),
    );
    const mutable = { ...c.body },
      flight = createApplicationApi(
        1,
        "OWNER",
        request as typeof fetchApi,
      ).execute(c.pending, mutable, new AbortController().signal);
    mutable.name = "Mutated during dispatch hash";
    release();
    await flight;
    expect(JSON.parse(request.mock.calls[0][1].body).name).toBe(profile.name);
    expect(request.mock.calls[0][1].retryOnUnauthorized).toBe(false);
  });
  it("wrong body cannot be dispatched under the saved hash", async () => {
    const c = await prepare(1, "OWNER", "submit", 1, input(), null),
      request = vi.fn();
    await expect(
      createApplicationApi(1, "OWNER", request as typeof fetchApi).execute(
        c.pending,
        { ...c.body, name: "Wrong body" },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(loadPending(1)?.raw).toBe(c.pending.raw);
  });
  it("requires explicit recovery consent and execute cannot accidentally become reconcile", async () => {
    const c = await prepare(1, "OWNER", "submit", 1, input(), null),
      request = vi.fn(),
      api = createApplicationApi(1, "OWNER", request as typeof fetchApi),
      signal = new AbortController().signal;
    expect(() => api.reconcile(c.pending, signal, false)).toThrow();
    expect(() => api.execute(c.pending, undefined as never, signal)).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("network failure retains the same UUID without automatic resend", async () => {
    const c = await prepare(1, "OWNER", "submit", 1, input(), null),
      request = vi.fn().mockRejectedValue(new TypeError("network"));
    await expect(
      createApplicationApi(1, "OWNER", request as typeof fetchApi).execute(
        c.pending,
        c.body,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    expect(loadPending(1)?.value.commandId).toBe(c.pending.value.commandId);
  });
  it.each([
    { storeId: 0 },
    { ownerId: 2 },
    { revision: 2 },
    { status: "ACTIVE" },
    { auditId: "0" },
    { auditId: "9223372036854775808" },
    { grantCreated: true },
    { reauthenticationRequired: true },
    { revision: "1" },
  ])(
    "does not clear metadata for a forged/malformed receipt %j",
    async (patch) => {
      const c = await prepare(1, "OWNER", "submit", 1, input(), null),
        request = vi.fn().mockResolvedValue(receipt(c.pending, patch));
      await expect(
        createApplicationApi(1, "OWNER", request as typeof fetchApi).execute(
          c.pending,
          c.body,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(loadPending(1)?.raw).toBe(c.pending.raw);
    },
  );
  it("accepts CLOSED only from explicit reconcile, not initial execute", async () => {
    const c = await prepare(1, "OWNER", "submit", 1, input(), null),
      request = vi.fn().mockResolvedValue({
        commandId: c.pending.value.commandId,
        outcome: "CLOSED",
        receipt: null,
      }),
      api = createApplicationApi(1, "OWNER", request as typeof fetchApi),
      signal = new AbortController().signal;
    await expect(api.execute(c.pending, c.body, signal)).rejects.toThrow();
    expect(loadPending(1)).not.toBeNull();
    expect(await api.reconcile(c.pending, signal, true)).toEqual({
      outcome: "CLOSED",
      receipt: null,
    });
    expect(loadPending(1)).toBeNull();
  });
  it("does not clear a different raw slot or accept a result in another session", async () => {
    const c = await prepare(1, "OWNER", "submit", 1, input(), null);
    let resolve!: (value: unknown) => void;
    const request = vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const flight = createApplicationApi(
      1,
      "OWNER",
      request as typeof fetchApi,
    ).reconcile(c.pending, new AbortController().signal, true);
    sessionStorage.setItem(key, "foreign-raw");
    resolve(receipt(c.pending));
    await expect(flight).rejects.toThrow();
    expect(sessionStorage.getItem(key)).toBe("foreign-raw");
  });
  it("corrupt storage and write failure block new commands without deleting anything", async () => {
    sessionStorage.setItem(key, "corrupt");
    expect(() => loadPending(1)).toThrow();
    await expect(
      prepare(1, "OWNER", "submit", 1, input(), null),
    ).rejects.toThrow();
    expect(sessionStorage.getItem(key)).toBe("corrupt");
    sessionStorage.clear();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await expect(
      prepare(1, "OWNER", "submit", 1, input(), null),
    ).rejects.toThrow();
  });
  it("rejects Owner target mismatch and invalid Admin transition before creating metadata", async () => {
    await expect(
      prepare(1, "OWNER", "submit", 2, input(), null),
    ).rejects.toThrow();
    expect(loadPending(1)).toBeNull();
    await expect(
      prepare(
        1,
        "ADMIN",
        "review",
        7,
        {
          confirmed: true,
          reason: "QA explicit decision",
          expectedRevision: 1,
          status: "SUSPENDED",
        },
        viewFixture,
      ),
    ).rejects.toThrow();
  });
  it("separates scope/action/target identity in the fingerprint", async () => {
    const body = normalize("submit", input());
    const h = await fingerprint("OWNER", "submit", 1, body);
    expect(await fingerprint("OWNER", "submit", 2, body)).not.toBe(h);
    expect(await fingerprint("ADMIN", "review", 1, body)).not.toBe(h);
  });
  it("rejects stale scope/actor and invalid journal expectations", async () => {
    const c = await prepare(1, "OWNER", "submit", 1, input(), null);
    const bad: Intent = {
      ...c.pending.value,
      expected: { ...c.pending.value.expected, ownerId: 2 },
    };
    sessionStorage.setItem(key, JSON.stringify(bad));
    expect(() => loadPending(1)).toThrow();
    sessionStorage.setItem(key, c.pending.raw);
    const request = vi.fn();
    await expect(
      createApplicationApi(1, "ADMIN", request as typeof fetchApi).reconcile(
        c.pending,
        new AbortController().signal,
        true,
      ),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(loadPending(2)).toBeNull();
  });
});
