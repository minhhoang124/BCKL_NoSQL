// @vitest-environment node
// Actual client/journal/validators, mocked HTTP. Live PostgreSQL is separate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBuyerCommandRuntime,
  createBuyerCommandRecovery,
} from "./buyerCommandRecovery";
import { createBuyerIntentJournal } from "./buyerIntentJournal";
import {
  fingerprintBuyerCommand,
  type BuyerCommand,
} from "./buyerCommandFingerprint";
import {
  prepareBuyerCommand,
  sendBuyerCommand,
  assertBuyerCommandProof,
  type BuyerExecutionIdentity,
} from "../../services/buyerCommandApi";
import {
  getAuthSessionVersion,
  setAccessToken,
  AuthSessionChangedError,
} from "../../services/apiClient";
import type { VerifiedOrderSession } from "./orderCommandCoordinator";
import { detailFixture, deferred } from "../order-readiness/testFixtures";

const reason = {
  reasonCode: "OTHER" as const,
  reasonText: "Không còn nhu cầu",
};
const slot = "bckl-order-command-journal-v1:7";
const time = "2026-10-22T01:00:00.000Z";
let entries: Map<string, string>, session: VerifiedOrderSession;
let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
const options = () => ({
  getStorage: () => storage,
  getSession: () => session,
});
function login(id = 7) {
  setAccessToken("qa-only-token", id);
  session = {
    actor: { id, role: "USER" },
    isActive: true,
    version: getAuthSessionVersion(),
  };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
function receipt(command: BuyerCommand = "cancel", replayed = false) {
  return {
    orderId: 101,
    commandId: 201,
    command,
    replayed,
    result:
      command === "cancel"
        ? {
            status: "CANCELLED",
            payment: {
              provider: "COD",
              status: "CANCELLED",
              amount: "20000.00",
              currency: "VND",
              paidAt: null,
            },
            cancellation: {
              cancelledBy: { type: "BUYER", id: 7 },
              ...reason,
              cancelledAt: time,
            },
            timeline: [
              {
                fromStatus: "PENDING_CONFIRMATION",
                toStatus: "CANCELLED",
                actorType: "BUYER",
                actorId: 7,
                ...reason,
                createdAt: time,
              },
            ],
          }
        : {
            status: "COMPLETED",
            deliveredAt: "2026-10-21T01:00:00.000Z",
            completedAt: time,
            payment: {
              provider: "COD",
              status: "PAID",
              amount: "20000.00",
              currency: "VND",
              paidAt: "2026-10-21T01:00:00.000Z",
            },
            timeline: [
              {
                fromStatus: "DELIVERED",
                toStatus: "COMPLETED",
                actorType: "BUYER",
                actorId: 7,
                createdAt: time,
              },
            ],
          },
  };
}
function order(command: BuyerCommand = "cancel") {
  const detail = detailFixture(101);
  if (command === "complete") {
    detail.status = "DELIVERED";
    detail.payment = {
      provider: "COD",
      status: "PAID",
      amount: detail.total,
      currency: "VND",
      paidAt: "2026-10-21T01:00:00.000Z",
    };
  }
  return detail;
}
const input = (command: BuyerCommand = "cancel") => ({
  orderId: 101,
  order: order(command),
  command,
  body: command === "cancel" ? reason : {},
  confirmed: true,
});
async function identity(
  command: BuyerCommand = "cancel",
): Promise<BuyerExecutionIdentity> {
  return {
    actorId: 7,
    orderId: 101,
    command,
    idempotencyKey: "original-buyer-execute-key-123",
    hashVersion: 1,
    requestHash: await fingerprintBuyerCommand(
      7,
      101,
      command,
      command === "cancel" ? reason : {},
    ),
    total: "20000.00",
  };
}
beforeEach(() => {
  entries = new Map();
  storage = {
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => {
      entries.set(k, v);
    },
    removeItem: (k) => {
      entries.delete(k);
    },
  };
  login();
});
afterEach(() => {
  setAccessToken(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Buyer execute adapter — no automatic retries or forged proofs", () => {
  it.each(["cancel", "complete"] as const)(
    "validates original and replay %s receipts and retains body only in RAM",
    async (command) => {
      for (const replayed of [false, true]) {
        const expected = await identity(command);
        const h = await prepareBuyerCommand(
          expected,
          command === "cancel" ? reason : {},
        );
        expect(JSON.stringify(h)).not.toContain(reason.reasonText);
        const transport = vi
          .fn()
          .mockResolvedValue(json(receipt(command, replayed)));
        vi.stubGlobal("fetch", transport);
        const result = await sendBuyerCommand(h);
        assertBuyerCommandProof(result, expected);
        expect(Object.isFrozen(result.result)).toBe(true);
        expect(() =>
          assertBuyerCommandProof(structuredClone(result), expected),
        ).toThrow();
        expect(() =>
          assertBuyerCommandProof(result, {
            ...expected,
            idempotencyKey: "different-key-123456789",
          }),
        ).toThrow();
        const [url, config] = transport.mock.calls[0];
        expect(url).toMatch(new RegExp(`/orders/101/${command}$`));
        expect(config.headers.get("Idempotency-Key")).toBe(
          expected.idempotencyKey,
        );
        expect(config.cache).toBe("no-store");
        expect(JSON.parse(config.body)).toEqual(
          command === "cancel" ? reason : {},
        );
        expect(transport).toHaveBeenCalledTimes(1);
      }
    },
  );
  it.each([
    { orderId: 0 },
    { actorId: 0 },
    { hashVersion: 2 },
    { requestHash: "a".repeat(64) },
    { total: "20000" },
    { idempotencyKey: "short" },
    { command: "confirm" },
  ])("rejects invalid identity %j before HTTP", async (change) => {
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    await expect(
      prepareBuyerCommand(
        { ...(await identity()), ...change } as BuyerExecutionIdentity,
        reason,
      ),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects a different normalized body and a forged handle without HTTP", async () => {
    const expected = await identity(),
      transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    await expect(
      prepareBuyerCommand(expected, {
        ...reason,
        reasonText: "Different reason",
      }),
    ).rejects.toThrow();
    const h = await prepareBuyerCommand(expected, reason);
    await expect(sendBuyerCommand({ ...h })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("snapshots identity/body before a delayed digest and refuses a session change during prepare", async () => {
    const expected = await identity(),
      body = { ...reason };
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const gate = deferred<ArrayBuffer>();
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(
      async (...args) => {
        const result = await digest(...args);
        await gate.promise;
        return result;
      },
    );
    const preparing = prepareBuyerCommand(expected, body);
    body.reasonText = "mutated";
    Object.assign(expected, { orderId: 999 });
    gate.resolve(new ArrayBuffer(0));
    const h = await preparing;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(receipt())));
    expect((await sendBuyerCommand(h)).orderId).toBe(101);
    login();
    await expect(sendBuyerCommand(h)).rejects.toBeInstanceOf(
      AuthSessionChangedError,
    );
  });
  it.each([401, 403, 409, 429, 500])(
    "HTTP%s is one attempt, never token refresh/replay",
    async (status) => {
      const h = await prepareBuyerCommand(await identity(), reason);
      const transport = vi
        .fn()
        .mockResolvedValue(json({ code: "SAFE_ERROR" }, status));
      vi.stubGlobal("fetch", transport);
      await expect(sendBuyerCommand(h)).rejects.toMatchObject({ status });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["order", "actor", "money", "reason", "extra", "malformed-json"])(
    "rejects corrupt successful receipt %s",
    async (kind) => {
      const raw = receipt();
      if (kind === "order") raw.orderId = 102;
      if (kind === "actor")
        Object.assign(raw.result.timeline[0], { actorId: 8 });
      if (kind === "money") raw.result.payment.amount = "30000.00";
      if (kind === "reason")
        Object.assign(raw.result.cancellation!, { reasonText: "Different" });
      if (kind === "extra") Object.assign(raw, { privateField: true });
      const h = await prepareBuyerCommand(await identity(), reason);
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            kind === "malformed-json" ? new Response("{") : json(raw),
          ),
      );
      await expect(sendBuyerCommand(h)).rejects.toThrow();
    },
  );
});

describe("Buyer execute lifecycle — unmounted integration", () => {
  it("dispose during fingerprinting prevents storage mutation and HTTP", async () => {
    const c = createBuyerCommandRuntime(options());
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const gate = deferred<void>(),
      entered = deferred<void>();
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(
      async (...args) => {
        const result = await digest(...args);
        entered.resolve();
        await gate.promise;
        return result;
      },
    );
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    const sending = c.execute(input()),
      rejected = expect(sending).rejects.toThrow();
    await entered.promise;
    c.dispose();
    gate.resolve();
    await rejected;
    expect(entries.size).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });
  it("captures route, order and body once before hashing", async () => {
    const c = createBuyerCommandRuntime(options()),
      request = { ...input(), body: { ...reason } };
    const digest = crypto.subtle.digest.bind(crypto.subtle),
      gate = deferred<void>(),
      entered = deferred<void>();
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(
      async (...args) => {
        const result = await digest(...args);
        entered.resolve();
        await gate.promise;
        return result;
      },
    );
    const transport = vi
      .fn()
      .mockResolvedValueOnce(json(receipt()))
      .mockResolvedValueOnce(json(order()));
    vi.stubGlobal("fetch", transport);
    const sending = c.execute(request);
    await entered.promise;
    request.orderId = 999;
    request.order.id = 999;
    request.order.total = "30000.00";
    request.command = "complete";
    request.body.reasonText = "Changed mid-flight";
    gate.resolve();
    expect((await sending).phase).toBe("committed");
    expect(transport.mock.calls[0][0]).toMatch(/\/orders\/101\/cancel$/);
    expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual(reason);
  });
  it("a newer raw record during the second fingerprint is not sent or overwritten", async () => {
    const c = createBuyerCommandRuntime(options());
    const digest = crypto.subtle.digest.bind(crypto.subtle),
      gate = deferred<void>(),
      entered = deferred<void>();
    let calls = 0;
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
      const result = await digest(...args);
      if (++calls === 2) {
        entered.resolve();
        await gate.promise;
      }
      return result;
    });
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    const sending = c.execute(input()),
      rejected = expect(sending).rejects.toThrow();
    await entered.promise;
    const newer = JSON.stringify({
      ...JSON.parse(entries.get(slot)!),
      createdAt: time,
    });
    entries.set(slot, newer);
    gate.resolve();
    await rejected;
    expect(entries.get(slot)).toBe(newer);
    expect(transport).not.toHaveBeenCalled();
  });
  it("execute timeout uses a finite deadline and retains its original pending", async () => {
    const c = createBuyerCommandRuntime(options());
    const timeoutSignal = AbortSignal.abort(
      new DOMException("QA timeout", "TimeoutError"),
    );
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal);
    const transport = vi.fn(async (_url, config: RequestInit) => {
      config.signal!.throwIfAborted();
      return json(receipt());
    });
    vi.stubGlobal("fetch", transport);
    await expect(c.execute(input())).rejects.toThrow("QA timeout");
    expect(timeout).toHaveBeenCalledWith(30000);
    const saved = entries.get(slot);
    expect(saved).toBeTruthy();
    await expect(c.execute(input())).rejects.toThrow();
    expect(entries.get(slot)).toBe(saved);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("leaves the existing resolver-only factory without an execute entry point", () => {
    expect(Object.keys(createBuyerCommandRecovery(options()))).not.toContain(
      "execute",
    );
  });
  it.each(["cancel", "complete"] as const)(
    "persists metadata before %s POST, settles proof, then GET",
    async (command) => {
      const c = createBuyerCommandRuntime(options());
      const transport = vi.fn(async (_url, config: RequestInit) => {
        if (config.method === "POST") {
          const pending = c.pending();
          expect(pending).toMatchObject({
            command,
            orderId: 101,
            hashVersion: 1,
          });
          expect(config.headers).toBeInstanceOf(Headers);
          expect((config.headers as Headers).get("Idempotency-Key")).toBe(
            pending!.idempotencyKey,
          );
          expect(entries.get(slot)).not.toContain(reason.reasonText);
          expect(entries.get(slot)).not.toContain("qa-only-token");
          return json(receipt(command));
        }
        expect(entries.has(slot)).toBe(false);
        return json(order(command));
      });
      vi.stubGlobal("fetch", transport);
      expect((await c.execute(input(command))).phase).toBe("committed");
      expect(c.pending()).toBeNull();
      expect(transport).toHaveBeenCalledTimes(2);
      await expect(c.execute(input(command))).rejects.toThrow();
    },
  );
  it.each(["consent", "wrong-order", "state", "payment", "role"])(
    "blocks invalid %s before pending/HTTP",
    async (kind) => {
      const request = input();
      if (kind === "consent") request.confirmed = false;
      if (kind === "wrong-order") request.orderId = 102;
      if (kind === "state") request.order.status = "CONFIRMED";
      if (kind === "payment") request.order.payment!.provider = "VNPAY";
      if (kind === "role")
        session = { ...session, actor: { id: 7, role: "SELLER" } };
      const transport = vi.fn();
      vi.stubGlobal("fetch", transport);
      await expect(
        Promise.resolve().then(() =>
          createBuyerCommandRuntime(options()).execute(request),
        ),
      ).rejects.toThrow();
      expect(entries.size).toBe(0);
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it("same-tick double click sends one execute with one key", async () => {
    const c = createBuyerCommandRuntime(options());
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(receipt()))
        .mockResolvedValueOnce(json(order())),
    );
    const first = c.execute(input());
    await expect(c.execute(input())).rejects.toThrow();
    await first;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["network", "malformed", "401", "409", "429", "500"])(
    "keeps the original pending after %s; explicit resolver is required",
    async (kind) => {
      const c = createBuyerCommandRuntime(options());
      const transport =
        kind === "network"
          ? vi.fn().mockRejectedValue(new TypeError("offline"))
          : vi
              .fn()
              .mockResolvedValue(
                kind === "malformed"
                  ? json({})
                  : json({ code: "SAFE_ERROR" }, Number(kind)),
              );
      vi.stubGlobal("fetch", transport);
      await expect(c.execute(input())).rejects.toThrow();
      const before = entries.get(slot);
      expect(before).toBeTruthy();
      await expect(c.execute(input())).rejects.toThrow();
      expect(entries.get(slot)).toBe(before);
      expect(transport).toHaveBeenCalledTimes(1);
      const remounted = createBuyerCommandRuntime(options());
      transport
        .mockResolvedValueOnce(
          json({ outcome: "COMMITTED", receipt: receipt("cancel", true) }),
        )
        .mockResolvedValueOnce(json(order()));
      expect(
        (
          await remounted.resolve({
            intent: remounted.pending()!,
            order: order(),
            confirmed: true,
          })
        ).phase,
      ).toBe("committed");
      expect(entries.has(slot)).toBe(false);
      expect(transport.mock.calls[1][0]).toMatch(/resolve-command$/);
    },
  );
  it.each(["throw", "silent"])(
    "storage delete %s blocks settlement without another POST",
    async (kind) => {
      const c = createBuyerCommandRuntime(options());
      storage.removeItem = () => {
        if (kind === "throw") throw new Error("Storage failed");
      };
      const transport = vi.fn().mockResolvedValue(json(receipt()));
      vi.stubGlobal("fetch", transport);
      await expect(c.execute(input())).rejects.toThrow();
      expect(entries.has(slot)).toBe(true);
      expect(c.getState().phase).toBe("blocked");
      await expect(c.execute(input())).rejects.toThrow();
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["switch", "same-account", "dispose", "newer-record"])(
    "cannot acknowledge %s during a response await",
    async (mode) => {
      const c = createBuyerCommandRuntime(options()),
        response = deferred<Response>(),
        entered = deferred<void>();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          entered.resolve();
          return response.promise;
        }),
      );
      const sending = c.execute(input());
      const rejected = expect(sending).rejects.toThrow();
      await entered.promise;
      const before = entries.get(slot);
      if (mode === "switch") login(8);
      if (mode === "same-account") login();
      if (mode === "dispose") c.dispose();
      if (mode === "newer-record")
        entries.set(
          slot,
          JSON.stringify({ ...JSON.parse(before!), createdAt: time }),
        );
      const expected = entries.get(slot);
      response.resolve(json(receipt()));
      await rejected;
      expect(entries.get(slot)).toBe(expected);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("known success plus GET failure permits GET-only retry and never reconstructs pending", async () => {
    const c = createBuyerCommandRuntime(options());
    const transport = vi
      .fn()
      .mockResolvedValueOnce(json(receipt()))
      .mockRejectedValueOnce(new TypeError("GET offline"))
      .mockResolvedValueOnce(json(order()));
    vi.stubGlobal("fetch", transport);
    expect((await c.execute(input())).phase).toBe("committed-refresh-error");
    expect(entries.has(slot)).toBe(false);
    expect((await c.reload()).phase).toBe("committed");
    expect(
      transport.mock.calls.map(([, init]) => init.method ?? "GET"),
    ).toEqual(["POST", "GET", "GET"]);
  });
  it("a previously persisted intent cannot execute after reload even with the same body", async () => {
    await createBuyerIntentJournal(options()).prepareNew({
      orderId: 101,
      command: "cancel",
      body: reason,
      confirmed: true,
    });
    const before = entries.get(slot);
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    await expect(
      createBuyerCommandRuntime(options()).execute(input()),
    ).rejects.toThrow();
    expect(entries.get(slot)).toBe(before);
    expect(transport).not.toHaveBeenCalled();
  });
});
