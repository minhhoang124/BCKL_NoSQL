// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// @ts-expect-error Vitest-only Node WebCrypto; browser tsconfig intentionally excludes Node globals.
import { webcrypto, createHash } from "node:crypto";
import * as transport from "../../services/apiClient";
import {
  accountStatusApi,
  parseStatusHistory,
  parseStatusResolution,
  statusReasonDigest,
  type StatusIntent,
} from "./accountStatusApi";
import {
  clearStatusPending,
  loadStatusPending,
  prepareStatusPending,
} from "./accountStatusPending";
vi.mock("../../services/apiClient", async (original) => ({
  ...(await original<typeof import("../../services/apiClient")>()),
  fetchApi: vi.fn(),
}));
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  transport.setAccessToken("qa", 1);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(transport.fetchApi).mockReset();
});
const reason = "Nguyễn yêu cầu khóa tài khoản";
const intent: StatusIntent = {
  actorId: 1,
  targetId: 2,
  commandId: "12345678-1234-4234-8234-123456789abc",
  expectedRevision: 1,
  isActive: false,
  reasonDigest: createHash("sha256").update(reason).digest("hex"),
};
const receipt = {
  account: { id: 2, isActive: false, statusRevision: 2 },
  auditId: "7",
  searchReconciliation: null,
};
const closed = {
  commandId: intent.commandId,
  outcome: "CLOSED",
  current: { id: 2, isActive: true, statusRevision: 1 },
  receipt: null,
};
it("WebCrypto digest matches independent Node SHA256 after NFC trim", async () =>
  expect(
    await statusReasonDigest("  Nguye\u0302\u0303n yêu cầu khóa tài khoản  "),
  ).toBe(intent.reasonDigest));
it("journal stores only immutable metadata, never plaintext reason/token/email", async () => {
  const prepared = await prepareStatusPending(
    1,
    { id: 2, isActive: true, statusRevision: 1 },
    false,
    reason,
  );
  expect(loadStatusPending(1)?.raw).toBe(prepared.raw);
  expect(prepared.raw).not.toContain(reason);
  expect(prepared.raw).not.toMatch(/token|email|password/);
  expect(loadStatusPending(3)).toBeNull();
  await expect(
    prepareStatusPending(
      1,
      { id: 3, isActive: true, statusRevision: 1 },
      false,
      reason,
    ),
  ).rejects.toThrow();
});
it("input mutation while WebCrypto is pending cannot replace captured identity/revision", async () => {
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: (value: ArrayBuffer) => void;
  vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const account = { id: 2, isActive: true, statusRevision: 1 },
    pending = prepareStatusPending(1, account, false, reason);
  account.id = 9;
  account.statusRevision = 100;
  release(await digest("SHA-256", new TextEncoder().encode(reason)));
  expect((await pending).value).toMatchObject({
    targetId: 2,
    expectedRevision: 1,
    isActive: false,
  });
});
it("session change during hashing prevents journal persistence", async () => {
  let release!: (value: ArrayBuffer) => void;
  vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = prepareStatusPending(
    1,
    { id: 2, isActive: true, statusRevision: 1 },
    false,
    reason,
  );
  const rejected = expect(pending).rejects.toThrow();
  transport.setAccessToken("other", 3);
  release(new ArrayBuffer(32));
  await rejected;
  expect(loadStatusPending(1)).toBeNull();
});
it("CAS never clears another pending request; malformed journal stays fail-closed", async () => {
  const prepared = await prepareStatusPending(
    1,
    { id: 2, isActive: true, statusRevision: 1 },
    false,
    reason,
  );
  sessionStorage.setItem("admin-status-pending:v1:1", prepared.raw + " ");
  expect(() => clearStatusPending(1, prepared.raw)).toThrow();
  sessionStorage.setItem(
    "admin-status-pending:v1:1",
    JSON.stringify({ ...prepared.value, reason }),
  );
  expect(() => loadStatusPending(1)).toThrow();
});
it.each([
  { ...closed, commandId: "wrong" },
  { ...closed, current: { ...closed.current, id: 9 } },
  { ...closed, outcome: "APPLIED" },
  { ...closed, receipt },
  { ...closed, secret: "extra" },
  { ...closed, outcome: "NOOP", receipt },
])("rejects malformed/mismatched reconciliation %#", (raw) =>
  expect(() => parseStatusResolution(raw, intent)).toThrow(),
);
it("receipt may differ from current state but cannot regress current revision", () => {
  expect(
    parseStatusResolution(
      {
        ...closed,
        outcome: "APPLIED",
        receipt,
        current: { id: 2, isActive: true, statusRevision: 3 },
      },
      intent,
    ).current.statusRevision,
  ).toBe(3);
  expect(() =>
    parseStatusResolution({ ...closed, outcome: "APPLIED", receipt }, intent),
  ).toThrow();
});
it("strict write includes one command ID, disables auth retry and rejects reason mismatch before HTTP", async () => {
  vi.mocked(transport.fetchApi).mockResolvedValue({
    ...receipt,
    commandId: intent.commandId,
  });
  await accountStatusApi.write(intent, reason);
  expect(transport.fetchApi).toHaveBeenCalledWith(
    "/admin/accounts/2/status",
    expect.objectContaining({
      method: "PATCH",
      retryOnUnauthorized: false,
      cache: "no-store",
      body: JSON.stringify({
        commandId: intent.commandId,
        expectedRevision: 1,
        isActive: false,
        reason,
      }),
    }),
  );
  vi.mocked(transport.fetchApi).mockClear();
  await expect(
    accountStatusApi.write(intent, "Different normalized reason"),
  ).rejects.toThrow();
  expect(transport.fetchApi).not.toHaveBeenCalled();
});
it("audit parser rejects private fields and cursor drift; allows maximum valid revision", () => {
  const row = {
    id: "7",
    actorId: 1,
    targetId: 2,
    beforeActive: true,
    afterActive: false,
    fromRevision: 2147483646,
    toRevision: 2147483647,
    reason,
    createdAt: "2026-10-25T00:00:00.000Z",
  };
  const page = {
    account: { id: 2, isActive: false, statusRevision: 2147483647 },
    items: [row],
    nextBeforeRevision: null,
  };
  expect(parseStatusHistory(page, 2).items).toHaveLength(1);
  expect(() =>
    parseStatusHistory(
      { ...page, items: [{ ...row, fromCredentialVersion: 1 }] },
      2,
    ),
  ).toThrow();
  expect(() =>
    parseStatusHistory({ ...page, nextBeforeRevision: row.toRevision }, 2),
  ).toThrow();
});
