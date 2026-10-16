// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrderCommandCoordinator,
  OrderRecoverySessionChangedError,
  type VerifiedOrderSession,
} from "./orderCommandCoordinator";
import {
  createOrderIntentJournal,
  OrderRecoveryBlockedError,
  type PendingOrderIntent,
} from "./orderIntentJournal";

const actor = { id: 1, role: "SELLER" } as const;
const key = "coordinator-order-recovery-key";
const command = { orderId: 10, command: "confirm", confirmed: true } as const;
const receipt = { orderId: 10, command: "confirm", commandId: 9 } as const;
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("Order coordinator foundation (mock adapter, no live HTTP)", () => {
  let current: VerifiedOrderSession | null;
  beforeEach(() => {
    sessionStorage.clear();
    current = { actor, isActive: true, version: 1 };
  });
  const journal = () => createOrderIntentJournal(sessionStorage, () => key);
  it("requires explicit confirmation and verified active session before creating pending work", async () => {
    const send = vi.fn(async () => receipt);
    const c = createOrderCommandCoordinator({
      journal: journal(),
      getSession: () => current,
      sendValidated: send,
    });
    await expect(c.execute({ ...command, confirmed: false })).rejects.toThrow(
      OrderRecoveryBlockedError,
    );
    expect(sessionStorage.length).toBe(0);
    current = null;
    await expect(c.execute(command)).rejects.toThrow(
      OrderRecoverySessionChangedError,
    );
    expect(send).not.toHaveBeenCalled();
  });
  it("persists before send; valid acknowledgement clears only after receipt", async () => {
    const j = journal();
    const c = createOrderCommandCoordinator({
      journal: j,
      getSession: () => current,
      sendValidated: async (intent) => {
        expect(j.pending(actor)).toEqual(intent);
        return receipt;
      },
    });
    expect(await c.execute(command)).toEqual(receipt);
    expect(c.pending()).toBeNull();
    expect(c.isBusy()).toBe(false);
  });
  it("blocks double-click synchronously and releases latch after completion", async () => {
    const d = deferred<typeof receipt>();
    const send = vi.fn(() => d.promise);
    const c = createOrderCommandCoordinator({
      journal: journal(),
      getSession: () => current,
      sendValidated: send,
    });
    const first = c.execute(command);
    expect(c.isBusy()).toBe(true);
    await expect(c.execute(command)).rejects.toThrow(OrderRecoveryBlockedError);
    expect(send).toHaveBeenCalledTimes(1);
    d.resolve(receipt);
    await first;
    expect(c.isBusy()).toBe(false);
  });
  it.each([
    "timeout",
    "abort",
    "HTTP 401",
    "HTTP 404",
    "HTTP 409",
    "HTTP 500",
    "invalid HTTP 200",
  ])(
    "keeps same pending after %s, no auto retry; caller confirms same-key retry",
    async (message) => {
      const intents: PendingOrderIntent[] = [];
      const c = createOrderCommandCoordinator({
        journal: journal(),
        getSession: () => current,
        sendValidated: async (intent) => {
          intents.push(intent);
          if (intents.length === 1) throw new Error(message);
          return receipt;
        },
      });
      await expect(c.execute(command)).rejects.toThrow(message);
      expect(c.isBusy()).toBe(false);
      expect(c.pending()?.idempotencyKey).toBe(key);
      expect(intents).toHaveLength(1);
      await c.execute(command);
      expect(intents[1]).toEqual(intents[0]);
      expect(c.pending()).toBeNull();
    },
  );
  it("does not acknowledge an old response after switching account", async () => {
    const d = deferred<typeof receipt>();
    const j = journal();
    const c = createOrderCommandCoordinator({
      journal: j,
      getSession: () => current,
      sendValidated: () => d.promise,
    });
    const running = c.execute(command);
    const original = j.pending(actor);
    current = { actor: { id: 2, role: "USER" }, isActive: true, version: 2 };
    d.resolve(receipt);
    await expect(running).rejects.toThrow(OrderRecoverySessionChangedError);
    expect(j.pending(actor)).toEqual(original);
    expect(c.pending()).toBeNull();
  });
  it.each(["version", "inactive", "role", "logout"])(
    "same-account session change %s retains original pending",
    async (change) => {
      const d = deferred<typeof receipt>();
      const j = journal();
      const c = createOrderCommandCoordinator({
        journal: j,
        getSession: () => current,
        sendValidated: () => d.promise,
      });
      const running = c.execute(command);
      current =
        change === "logout"
          ? null
          : {
              actor: change === "role" ? { id: 1, role: "USER" } : actor,
              isActive: change !== "inactive",
              version: change === "version" ? 2 : 1,
            };
      d.resolve(receipt);
      await expect(running).rejects.toThrow(OrderRecoverySessionChangedError);
      expect(j.pending(actor)?.idempotencyKey).toBe(key);
      expect(c.isBusy()).toBe(false);
    },
  );
  it("new controller after reload sees old pending and does not send until explicitly invoked", async () => {
    journal().prepare(actor, 10, "confirm");
    const send = vi.fn(async () => receipt);
    const c = createOrderCommandCoordinator({
      journal: journal(),
      getSession: () => current,
      sendValidated: send,
    });
    expect(c.pending()?.idempotencyKey).toBe(key);
    expect(send).not.toHaveBeenCalled();
    await c.execute(command);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: key }),
    );
  });
  it("corrupt/storage failure prevents send and preserves blocked state", async () => {
    sessionStorage.setItem("bckl-order-command-journal-v1:1", "{bad");
    const send = vi.fn(async () => receipt);
    const c = createOrderCommandCoordinator({
      journal: journal(),
      getSession: () => current,
      sendValidated: send,
    });
    await expect(c.execute(command)).rejects.toThrow(OrderRecoveryBlockedError);
    expect(send).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("bckl-order-command-journal-v1:1")).toBe(
      "{bad",
    );
  });
  it("wrong receipt identity does not release original pending", async () => {
    const c = createOrderCommandCoordinator({
      journal: journal(),
      getSession: () => current,
      sendValidated: async () => ({ ...receipt, orderId: 11 }),
    });
    await expect(c.execute(command)).rejects.toThrow(OrderRecoveryBlockedError);
    expect(c.pending()?.orderId).toBe(10);
  });
  it("late adapter failure after account switch is replaced with session-changed error, keeping original key", async () => {
    const d = deferred<typeof receipt>();
    const j = journal();
    const c = createOrderCommandCoordinator({
      journal: j,
      getSession: () => current,
      sendValidated: () => d.promise,
    });
    const running = c.execute(command);
    current = { actor: { id: 2, role: "USER" }, isActive: true, version: 2 };
    d.reject(new Error("old-session backend failure"));
    await expect(running).rejects.toThrow(OrderRecoverySessionChangedError);
    expect(j.pending(actor)?.idempotencyKey).toBe(key);
  });
});
