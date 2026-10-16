// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrderIntentJournal,
  OrderRecoveryBlockedError,
  type RecoverableCommand,
} from "./orderIntentJournal";

const seller = { id: 1, role: "SELLER" } as const;
const buyer = { id: 2, role: "USER" } as const;
const key = "order-recovery-test-key-0001";
const storageKey = "bckl-order-command-journal-v1:1";
const clock = () => new Date("2026-10-15T00:00:00.000Z");
describe("tab-scoped pending Order command journal (not runtime HTTP proof)", () => {
  beforeEach(() => sessionStorage.clear());
  it("persists immutable command before dispatch and resumes same key after remount/reload", () => {
    const factory = vi.fn(() => key);
    const journal = createOrderIntentJournal(sessionStorage, factory, clock);
    const intent = journal.prepare(seller, 10, "confirm");
    expect(Object.isFrozen(intent)).toBe(true);
    const reloaded = createOrderIntentJournal(sessionStorage, () => {
      throw new Error("must not generate");
    });
    expect(reloaded.pending(seller)).toEqual(intent);
    expect(reloaded.prepare(seller, 10, "confirm")).toEqual(intent);
    expect(factory).toHaveBeenCalledTimes(1);
  });
  it("does not expose another account intent or clear it on an account switch", () => {
    const journal = createOrderIntentJournal(sessionStorage, () => key, clock);
    const pending = journal.prepare(seller, 10, "confirm");
    expect(journal.pending(buyer)).toBeNull();
    expect(journal.pending(seller)).toEqual(pending);
  });
  it("role change cannot bypass unresolved work of the same user", () => {
    const journal = createOrderIntentJournal(sessionStorage, () => key, clock);
    journal.prepare(seller, 10, "confirm");
    expect(() => journal.pending({ id: 1, role: "USER" })).toThrow(
      OrderRecoveryBlockedError,
    );
  });
  it.each([
    [11, "confirm"],
    [10, "start-packing"],
  ] as const)(
    "blocks a different order/command while unresolved (%s %s)",
    (id, command) => {
      const journal = createOrderIntentJournal(
        sessionStorage,
        () => key,
        clock,
      );
      journal.prepare(seller, 10, "confirm");
      expect(() => journal.prepare(seller, id, command)).toThrow(
        OrderRecoveryBlockedError,
      );
    },
  );
  it("has no timeout/GET-based reset or automatic retry; old unresolved keys survive age", () => {
    const journal = createOrderIntentJournal(sessionStorage, () => key, clock);
    const intent = journal.prepare(seller, 10, "confirm");
    expect(
      createOrderIntentJournal(
        sessionStorage,
        () => "new-key-must-not-be-used",
        () => new Date("2027-10-15"),
      ).pending(seller),
    ).toEqual(intent);
  });
  it.each(["confirm", "start-packing", "ready-to-ship"] as const)(
    "accepts Seller %s",
    (command) => {
      expect(
        createOrderIntentJournal(sessionStorage, () => key, clock).prepare(
          seller,
          10,
          command,
        ).command,
      ).toBe(command);
    },
  );
  it("accepts Buyer complete and stores no PII/body/token/receipt", () => {
    const intent = createOrderIntentJournal(
      sessionStorage,
      () => key,
      clock,
    ).prepare(buyer, 10, "complete");
    expect(Object.keys(intent).sort()).toEqual(
      [
        "schemaVersion",
        "actorId",
        "role",
        "orderId",
        "command",
        "idempotencyKey",
        "createdAt",
      ].sort(),
    );
  });
  it.each(["cancel", "confirm-returned", "complete"] as const)(
    "rejects unsupported Seller command %s",
    (command) => {
      expect(() =>
        createOrderIntentJournal(sessionStorage).prepare(
          seller,
          10,
          command as RecoverableCommand,
        ),
      ).toThrow(OrderRecoveryBlockedError);
    },
  );
  it("rejects Buyer preparation", () => {
    expect(() =>
      createOrderIntentJournal(sessionStorage).prepare(buyer, 10, "confirm"),
    ).toThrow(OrderRecoveryBlockedError);
  });
  it.each(["{bad", "null", "[]", "{}", "x".repeat(2049)])(
    "corrupt data fails closed, without generating or overwriting",
    (raw) => {
      sessionStorage.setItem(storageKey, raw);
      const factory = vi.fn(() => key);
      expect(() =>
        createOrderIntentJournal(sessionStorage, factory).prepare(
          seller,
          10,
          "confirm",
        ),
      ).toThrow(OrderRecoveryBlockedError);
      expect(factory).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(storageKey)).toBe(raw);
    },
  );
  it.each([
    { schemaVersion: 2 },
    { actorId: 9 },
    { orderId: 0 },
    { orderId: 2147483648 },
    { command: ["confirm"] },
    { idempotencyKey: "short" },
    { createdAt: "bad" },
    { token: "must-not-store" },
  ])("rejects invalid persisted fields %j", (delta) => {
    const journal = createOrderIntentJournal(sessionStorage, () => key, clock);
    const intent = journal.prepare(seller, 10, "confirm");
    sessionStorage.setItem(storageKey, JSON.stringify({ ...intent, ...delta }));
    expect(() => journal.pending(seller)).toThrow(OrderRecoveryBlockedError);
  });
  it("storage denial or silent failed write blocks before dispatch", () => {
    const denied = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: vi.fn(),
    };
    expect(() =>
      createOrderIntentJournal(denied, () => key, clock).prepare(
        seller,
        10,
        "confirm",
      ),
    ).toThrow(OrderRecoveryBlockedError);
    expect(() =>
      createOrderIntentJournal(
        { ...denied, setItem: () => {} },
        () => key,
        clock,
      ).prepare(seller, 10, "confirm"),
    ).toThrow(OrderRecoveryBlockedError);
  });
  it("read failure blocks without creating a new key", () => {
    const factory = vi.fn(() => key);
    const journal = createOrderIntentJournal(
      {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      factory,
      clock,
    );
    expect(() => journal.prepare(seller, 10, "confirm")).toThrow(
      OrderRecoveryBlockedError,
    );
    expect(factory).not.toHaveBeenCalled();
  });
  it("failed removal retains pending and does not report acknowledgement success", () => {
    const journal = createOrderIntentJournal(sessionStorage, () => key, clock);
    const intent = journal.prepare(seller, 10, "confirm");
    const badStorage = {
      getItem: sessionStorage.getItem.bind(sessionStorage),
      setItem: sessionStorage.setItem.bind(sessionStorage),
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() =>
      createOrderIntentJournal(badStorage).acknowledge(seller, intent, {
        orderId: 10,
        command: "confirm",
        commandId: 5,
      }),
    ).toThrow(OrderRecoveryBlockedError);
    expect(journal.pending(seller)).toEqual(intent);
  });
  it("only matching validated command acknowledgement clears pending; stale callbacks cannot clear a newer intent", () => {
    let seq = 0;
    const journal = createOrderIntentJournal(
      sessionStorage,
      () => key + seq++,
      clock,
    );
    const first = journal.prepare(seller, 10, "confirm");
    expect(() =>
      journal.acknowledge(seller, first, {
        orderId: 11,
        command: "confirm",
        commandId: 5,
      }),
    ).toThrow();
    expect(() =>
      journal.acknowledge(seller, first, {
        orderId: 10,
        command: "confirm",
        commandId: 0,
      }),
    ).toThrow();
    journal.acknowledge(seller, first, {
      orderId: 10,
      command: "confirm",
      commandId: 5,
    });
    expect(journal.pending(seller)).toBeNull();
    const second = journal.prepare(seller, 11, "confirm");
    expect(() =>
      journal.acknowledge(seller, first, {
        orderId: 10,
        command: "confirm",
        commandId: 5,
      }),
    ).toThrow();
    expect(journal.pending(seller)).toEqual(second);
  });
  it("a different logged-in account cannot acknowledge another account command", () => {
    const journal = createOrderIntentJournal(sessionStorage, () => key, clock);
    const intent = journal.prepare(seller, 10, "confirm");
    expect(() =>
      journal.acknowledge(buyer, intent, {
        orderId: 10,
        command: "confirm",
        commandId: 5,
      }),
    ).toThrow();
    expect(journal.pending(seller)).toEqual(intent);
  });
});
