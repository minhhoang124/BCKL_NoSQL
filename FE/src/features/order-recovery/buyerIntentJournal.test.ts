// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  setAccessToken,
  getAuthSessionVersion,
} from "../../services/apiClient";
import { createBuyerIntentJournal } from "./buyerIntentJournal";
import {
  fingerprintBuyerCommand,
  normalizeBuyerCommand,
} from "./buyerCommandFingerprint";
import {
  createOrderIntentJournal,
  OrderRecoveryBlockedError,
} from "./orderIntentJournal";
import {
  OrderRecoverySessionChangedError,
  type VerifiedOrderSession,
} from "./orderCommandCoordinator";

const slot = "bckl-order-command-journal-v1:7",
  key = "original_buyer_request_key";
const time = "2026-10-19T00:00:00.000Z";
const body = {
  reasonCode: "CHANGED_MIND",
  reasonText: "  Tôi đổi ý mua hàng  ",
};
const legacy = {
  schemaVersion: 1,
  actorId: 7,
  role: "USER",
  orderId: 101,
  command: "complete",
  idempotencyKey: key,
  createdAt: time,
};
let session: VerifiedOrderSession | null;
const make = (
  getStorage: () => Pick<Storage, "getItem" | "setItem"> = () => sessionStorage,
  keyFactory = () => key,
) =>
  createBuyerIntentJournal({
    getStorage,
    getSession: () => session,
    keyFactory,
    now: () => new Date(time),
  });
const request = {
  orderId: 101,
  command: "cancel" as const,
  body,
  confirmed: true,
};
function deferred() {
  let resolve!: (value: ArrayBuffer) => void;
  const promise = new Promise<ArrayBuffer>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    get length() {
      return entries.size;
    },
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    clear: () => entries.clear(),
    key: (index: number) => [...entries.keys()][index] ?? null,
  });
  setAccessToken("qa-only", 7);
  session = {
    actor: { id: 7, role: "USER" },
    isActive: true,
    version: getAuthSessionVersion(),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Buyer canonical hash v1, normalized body only in RAM", () => {
  it("rejects accessors before reading/logging sensitive body fields", () => {
    const getter = vi.fn(() => {
      throw new Error("private reason");
    });
    const raw = Object.defineProperty({ reasonCode: "OTHER" }, "reasonText", {
      enumerable: true,
      get: getter,
    });
    expect(() => normalizeBuyerCommand("cancel", raw)).toThrow(
      OrderRecoveryBlockedError,
    );
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([
    [
      "complete",
      {},
      "1ae432f016f4b068acdb4ec4be611a2716e30c499b7ae8fbfc217295cf7df861",
    ],
    [
      "cancel",
      body,
      "5c7e4d7ab866c3dd0cd08449c4484077ba73dfc7c81009b98549c20af453f412",
    ],
    [
      "cancel",
      { reasonText: "Không còn nhu cầu", reasonCode: "OTHER" },
      "2b90ed0146392f084a1bf552011433676b85558f772f2421003b82ca7dbe0239",
    ],
  ] as const)(
    "reviewed #69 vector %s matches WebCrypto",
    async (command, raw, hash) =>
      expect(await fingerprintBuyerCommand(7, 101, command, raw)).toBe(hash),
  );
  it("does not normalize NFC or collapse internal whitespace", async () => {
    const hash = (reasonText: string) =>
      fingerprintBuyerCommand(7, 101, "cancel", {
        reasonCode: "OTHER",
        reasonText,
      });
    expect(await hash("é")).not.toBe(await hash("e\u0301"));
    expect(await hash("a b")).not.toBe(await hash("a  b"));
    expect(await hash(" a ")).toBe(await hash("a"));
  });
  it("uses JS UTF-16 length limit and freezes normalized body", () => {
    expect(
      Object.isFrozen(
        normalizeBuyerCommand("cancel", {
          reasonCode: "OTHER",
          reasonText: "😀".repeat(250),
        }),
      ),
    ).toBe(true);
    expect(() =>
      normalizeBuyerCommand("cancel", {
        reasonCode: "OTHER",
        reasonText: "😀".repeat(251),
      }),
    ).toThrow();
  });
  it.each([
    null,
    [],
    {},
    { ...body, extra: 1 },
    { ...body, reasonCode: "CANNOT_FULFIL" },
    { ...body, reasonText: "   " },
    { ...body, reasonText: "x".repeat(501) },
    Object.assign(Object.create({ bad: 1 }), body),
  ])("rejects unsafe cancellation body %#", (v) =>
    expect(() => normalizeBuyerCommand("cancel", v)).toThrow(
      OrderRecoveryBlockedError,
    ),
  );
  it.each([null, [], { command: "complete" }, { reasonText: "secret" }])(
    "complete rejects nonempty/wrong body %#",
    (v) =>
      expect(() => normalizeBuyerCommand("complete", v)).toThrow(
        OrderRecoveryBlockedError,
      ),
  );
  it("missing WebCrypto fails closed, not an insecure fallback", async () => {
    vi.stubGlobal("crypto", {});
    await expect(
      fingerprintBuyerCommand(7, 101, "complete", {}),
    ).rejects.toThrow(OrderRecoveryBlockedError);
  });
});

describe("Buyer journal v2 same physical slot — no HTTP/ACK/settlement", () => {
  it("persists exact nine metadata fields before returning, no reason/body/token/receipt", async () => {
    const j = make(),
      i = await j.prepareNew(request);
    expect(Object.keys(i).sort()).toEqual(
      [
        "schemaVersion",
        "actorId",
        "role",
        "orderId",
        "command",
        "idempotencyKey",
        "createdAt",
        "hashVersion",
        "requestHash",
      ].sort(),
    );
    expect(i).toMatchObject({
      schemaVersion: 2,
      actorId: 7,
      role: "USER",
      orderId: 101,
      command: "cancel",
      hashVersion: 1,
      createdAt: time,
      idempotencyKey: key,
    });
    expect(Object.isFrozen(i)).toBe(true);
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.getItem(slot)).not.toContain(body.reasonText.trim());
    expect(make().pending()).toEqual(i);
    expect(Object.keys(j).sort()).toEqual(
      ["pending", "prepareNew", "upgradeLegacyComplete", "isBusy"].sort(),
    );
  });
  it.each(["cancel", "complete"] as const)(
    "reload %s only returns metadata and never permits a fresh execution",
    async (command) => {
      const j = make();
      const i = await j.prepareNew({
        ...request,
        command,
        body: command === "cancel" ? body : {},
      });
      const factory = vi.fn(() => key + "_new"),
        reloaded = make(() => sessionStorage, factory);
      expect(reloaded.pending()).toEqual(i);
      await expect(
        reloaded.prepareNew({
          ...request,
          command,
          body: command === "cancel" ? body : {},
        }),
      ).rejects.toThrow(OrderRecoveryBlockedError);
      expect(factory).not.toHaveBeenCalled();
      expect(reloaded.pending()).toEqual(i);
    },
  );
  it("legacy complete upgrades in-place with key/time unchanged, no parallel slot", async () => {
    sessionStorage.setItem(slot, JSON.stringify(legacy));
    const j = make();
    expect(j.pending()).toEqual(legacy);
    const v2 = await j.upgradeLegacyComplete();
    expect(v2).toEqual({
      ...legacy,
      schemaVersion: 2,
      hashVersion: 1,
      requestHash:
        "1ae432f016f4b068acdb4ec4be611a2716e30c499b7ae8fbfc217295cf7df861",
    });
    expect(sessionStorage.length).toBe(1);
    expect(JSON.parse(sessionStorage.getItem(slot)!)).toEqual(v2);
    expect(await make().upgradeLegacyComplete()).toEqual(v2);
  });
  it("Seller v1 is preserved and never converted or bypassed by role", async () => {
    const old = { ...legacy, role: "SELLER", command: "confirm" };
    const raw = JSON.stringify(old);
    sessionStorage.setItem(slot, raw);
    expect(() => make().pending()).toThrow(OrderRecoveryBlockedError);
    await expect(make().upgradeLegacyComplete()).rejects.toThrow(
      OrderRecoveryBlockedError,
    );
    await expect(make().prepareNew(request)).rejects.toThrow(
      OrderRecoveryBlockedError,
    );
    expect(sessionStorage.getItem(slot)).toBe(raw);
    expect(
      createOrderIntentJournal(sessionStorage).pending({
        id: 7,
        role: "SELLER",
      }),
    ).toEqual(old);
  });
  it("old v1 client fails closed on v2; cannot mint another pending key", async () => {
    await make().prepareNew(request);
    const old = createOrderIntentJournal(sessionStorage);
    expect(() => old.pending({ id: 7, role: "USER" })).toThrow(
      OrderRecoveryBlockedError,
    );
    expect(() => old.prepare({ id: 7, role: "USER" }, 101, "complete")).toThrow(
      OrderRecoveryBlockedError,
    );
  });
  it.each([
    "{bad",
    JSON.stringify({ ...legacy, schemaVersion: 3 }),
    JSON.stringify({ ...legacy, command: "cancel" }),
    JSON.stringify({ ...legacy, actorId: 8 }),
    JSON.stringify({ ...legacy, idempotencyKey: key + "\n" }),
    JSON.stringify({ ...legacy, createdAt: "invalid" }),
    JSON.stringify({ ...legacy, orderId: 0 }),
    JSON.stringify({ ...legacy, body: {} }),
    JSON.stringify({ ...legacy, schemaVersion: 2 }),
    JSON.stringify({
      ...legacy,
      schemaVersion: 2,
      hashVersion: true,
      requestHash: "a".repeat(64),
    }),
    JSON.stringify({
      ...legacy,
      schemaVersion: 2,
      hashVersion: 1,
      requestHash: "a".repeat(64) + "\n",
    }),
    JSON.stringify({
      ...legacy,
      schemaVersion: 2,
      hashVersion: 1,
      requestHash: "A".repeat(64),
    }),
    "x".repeat(2049),
  ])("malformed pending %# remains blocked without deletion", async (raw) => {
    sessionStorage.setItem(slot, raw);
    const j = make();
    expect(() => j.pending()).toThrow(OrderRecoveryBlockedError);
    await expect(j.upgradeLegacyComplete()).rejects.toThrow(
      OrderRecoveryBlockedError,
    );
    expect(sessionStorage.getItem(slot)).toBe(raw);
  });
  it("storage property getter failure cannot fall back to a new store", async () => {
    const j = make(() => {
      throw new Error("unavailable");
    });
    expect(() => j.pending()).toThrow(OrderRecoveryBlockedError);
    await expect(j.prepareNew(request)).rejects.toThrow(
      OrderRecoveryBlockedError,
    );
  });
  it("silent set no-op blocks; legacy silent write preserves v1", async () => {
    sessionStorage.setItem(slot, JSON.stringify(legacy));
    const raw = sessionStorage.getItem(slot);
    const storage = {
      getItem: (k: string) => sessionStorage.getItem(k),
      setItem: vi.fn(),
    };
    await expect(make(() => storage).upgradeLegacyComplete()).rejects.toThrow(
      OrderRecoveryBlockedError,
    );
    expect(sessionStorage.getItem(slot)).toBe(raw);
    sessionStorage.clear();
    await expect(make(() => storage).prepareNew(request)).rejects.toThrow(
      OrderRecoveryBlockedError,
    );
  });
  it("set quota failure never returns a dispatchable intent", async () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    await expect(make(() => storage).prepareNew(request)).rejects.toThrow(
      OrderRecoveryBlockedError,
    );
  });
  it("no expiry or logout-clear; another account cannot read previous pending", async () => {
    const i = await make().prepareNew(request);
    setAccessToken(null);
    session = null;
    expect(() => make().pending()).toThrow(OrderRecoverySessionChangedError);
    expect(JSON.parse(sessionStorage.getItem(slot)!)).toEqual(i);
    setAccessToken("qa-other", 8);
    session = {
      actor: { id: 8, role: "USER" },
      isActive: true,
      version: getAuthSessionVersion(),
    };
    expect(make().pending()).toBeNull();
    expect(sessionStorage.getItem(slot)).not.toBeNull();
  });
  it("rejects no consent and invalid/locked sessions", async () => {
    await expect(
      make().prepareNew({ ...request, confirmed: false }),
    ).rejects.toThrow(OrderRecoveryBlockedError);
    session = {
      actor: { id: 7, role: "USER" },
      isActive: false,
      version: getAuthSessionVersion(),
    };
    await expect(make().prepareNew(request)).rejects.toThrow(
      OrderRecoverySessionChangedError,
    );
  });
  it("double click shares one latch before hashing returns", async () => {
    const gate = deferred();
    vi.spyOn(crypto.subtle, "digest").mockReturnValueOnce(gate.promise);
    const j = make(),
      first = j.prepareNew(request);
    expect(j.isBusy()).toBe(true);
    await expect(j.prepareNew(request)).rejects.toThrow(
      OrderRecoveryBlockedError,
    );
    gate.resolve(new Uint8Array(32).buffer);
    await first;
    expect(j.isBusy()).toBe(false);
  });
  it.each(["orderId", "command", "nestedBody", "replaceBody"] as const)(
    "uses one immutable request snapshot when %s changes during real WebCrypto digest",
    async (field) => {
      const originalBody = { ...body };
      const input: {
        orderId: number;
        command: "cancel" | "complete";
        body: typeof body | Record<string, never>;
        confirmed: boolean;
      } = { ...request, body: { ...originalBody } };
      const expectedHash = await fingerprintBuyerCommand(
        7,
        101,
        "cancel",
        originalBody,
      );
      const realDigest = crypto.subtle.digest.bind(crypto.subtle);
      const gate = deferred();
      vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(
        (algorithm, data) => {
          const realResult = realDigest(algorithm, data);
          return gate.promise.then(() => realResult);
        },
      );
      const journal = make();
      const preparing = journal.prepareNew(input);
      expect(journal.isBusy()).toBe(true);
      if (field === "orderId") input.orderId = 102;
      else if (field === "command") input.command = "complete";
      else if (field === "nestedBody")
        input.body.reasonText = "Changed private reason";
      else input.body = {};
      gate.resolve(new ArrayBuffer(0));
      const saved = await preparing;
      expect(saved).toMatchObject({
        orderId: 101,
        command: "cancel",
        requestHash: expectedHash,
      });
      expect(journal.pending()).toEqual(saved);
      expect(saved.requestHash).toBe(
        await fingerprintBuyerCommand(
          7,
          saved.orderId,
          saved.command,
          originalBody,
        ),
      );
      const raw = sessionStorage.getItem(slot)!;
      expect(raw).not.toContain(originalBody.reasonText.trim());
      expect(raw).not.toContain("Changed private reason");
    },
  );
  it.each(["prepare", "upgrade"] as const)(
    "session change during %s hash cannot write the old callback",
    async (method) => {
      if (method === "upgrade")
        sessionStorage.setItem(slot, JSON.stringify(legacy));
      const before = sessionStorage.getItem(slot);
      const gate = deferred();
      vi.spyOn(crypto.subtle, "digest").mockReturnValueOnce(gate.promise);
      const j = make(),
        result =
          method === "prepare"
            ? j.prepareNew(request)
            : j.upgradeLegacyComplete();
      setAccessToken("qa-same-account-new-login", 7);
      session = {
        actor: { id: 7, role: "USER" },
        isActive: true,
        version: getAuthSessionVersion(),
      };
      gate.resolve(new Uint8Array(32).buffer);
      await expect(result).rejects.toThrow(OrderRecoverySessionChangedError);
      expect(sessionStorage.getItem(slot)).toBe(before);
    },
  );
  it.each(["prepare", "upgrade"] as const)(
    "pending changed during %s hash cannot be overwritten",
    async (method) => {
      if (method === "upgrade")
        sessionStorage.setItem(slot, JSON.stringify(legacy));
      const gate = deferred();
      vi.spyOn(crypto.subtle, "digest").mockReturnValueOnce(gate.promise);
      const j = make(),
        result =
          method === "prepare"
            ? j.prepareNew(request)
            : j.upgradeLegacyComplete();
      const replacement = JSON.stringify({ ...legacy, orderId: 102 });
      sessionStorage.setItem(slot, replacement);
      gate.resolve(new Uint8Array(32).buffer);
      await expect(result).rejects.toThrow(OrderRecoveryBlockedError);
      expect(sessionStorage.getItem(slot)).toBe(replacement);
    },
  );
  it("a synchronous storage getter changing session cannot return another session data", () => {
    const storage = {
      getItem: () => {
        setAccessToken("qa-new", 8);
        session = {
          actor: { id: 8, role: "USER" },
          isActive: true,
          version: getAuthSessionVersion(),
        };
        return JSON.stringify(legacy);
      },
      setItem: vi.fn(),
    };
    expect(() => make(() => storage).pending()).toThrow(
      OrderRecoverySessionChangedError,
    );
  });
});
