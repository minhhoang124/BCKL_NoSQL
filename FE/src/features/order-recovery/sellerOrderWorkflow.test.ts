// @vitest-environment jsdom
// Actual FE adapters/coordinator/journal; HTTP is mocked, not live transaction proof.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthSessionVersion,
  setAccessToken,
} from "../../services/apiClient";
import { preparationTransitions } from "../../services/orderResponse";
import type { PreparationCommand } from "../../types/order";
import {
  deferred,
  detailFixture,
  receiptFixture,
  seller,
} from "../order-readiness/testFixtures";
import { createSellerOrderWorkflow } from "./sellerOrderWorkflow";
import { createOrderIntentJournal } from "./orderIntentJournal";
import type { VerifiedOrderSession } from "./orderCommandCoordinator";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status });
const storageKey = `bckl-order-command-journal-v1:${seller.id}`;
let session: VerifiedOrderSession;
let order = detailFixture();
let store = { id: 4, sellerId: seller.id, status: "ACTIVE" };
let mutation: (command: PreparationCommand) => Promise<Response>;
let transport: ReturnType<typeof vi.fn>;
function receipt(command: PreparationCommand) {
  const r = receiptFixture();
  r.command = command;
  r.result.status = preparationTransitions[command][1];
  r.result.timeline[0].fromStatus = preparationTransitions[command][0];
  r.result.timeline[0].toStatus = preparationTransitions[command][1];
  return r;
}
function setup() {
  return createSellerOrderWorkflow({
    orderId: 19,
    storage: sessionStorage,
    getSession: () => session,
  });
}
function seedPending(orderId = 19) {
  return createOrderIntentJournal(sessionStorage).prepare(
    session.actor,
    orderId,
    "confirm",
  );
}
const writes = () =>
  transport.mock.calls.filter(([, opts]) => opts.method === "POST");
beforeEach(() => {
  sessionStorage.clear();
  setAccessToken("qa-fixture", seller.id);
  session = {
    actor: { id: seller.id, role: "SELLER" },
    version: getAuthSessionVersion(),
    isActive: true,
  };
  order = detailFixture();
  store = { id: 4, sellerId: seller.id, status: "ACTIVE" };
  mutation = async (command) => {
    order = { ...order, status: preparationTransitions[command][1] };
    return json(receipt(command));
  };
  transport = vi.fn(async (url: string, opts: RequestInit) => {
    if (opts.method !== "POST")
      return json(url.endsWith("/seller/store") ? store : order);
    return mutation(url.split("/").at(-1) as PreparationCommand);
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => {
  setAccessToken(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Seller runtime workflow — mock HTTP boundary", () => {
  it("constructs and reloads read-only, no automatic execute/resolve", async () => {
    seedPending();
    const flow = setup();
    expect(transport).not.toHaveBeenCalled();
    await flow.reload();
    expect(flow.snapshot().phase).toBe("unknown");
    expect(writes()).toHaveLength(0);
  });
  it("requires consent for each step, gets fresh state and never chains commands", async () => {
    const flow = setup();
    await flow.reload();
    for (const command of [
      "confirm",
      "start-packing",
      "ready-to-ship",
    ] as const) {
      flow.choose(command);
      await expect(flow.execute(false)).rejects.toThrow();
      await flow.execute(true);
      expect(flow.snapshot().phase).toBe("ready");
      expect(flow.snapshot().order?.status).toBe(
        preparationTransitions[command][1],
      );
      expect(sessionStorage.getItem(storageKey)).toBeNull();
    }
    expect(writes()).toHaveLength(3);
    expect(
      new Set(
        writes().map(([, opts]) =>
          (opts.headers as Headers).get("Idempotency-Key"),
        ),
      ).size,
    ).toBe(3);
  });
  it("cancel confirmation performs no write and leaves no journal", async () => {
    const flow = setup();
    await flow.reload();
    flow.choose("confirm");
    flow.cancelConfirmation();
    expect(flow.snapshot().phase).toBe("ready");
    expect(writes()).toHaveLength(0);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
  it("latches double confirm and rejects resolve while execute is in flight", async () => {
    const gate = deferred<Response>();
    mutation = () => gate.promise;
    const flow = setup();
    await flow.reload();
    flow.choose("confirm");
    const first = flow.execute(true);
    await expect(flow.execute(true)).rejects.toThrow();
    const pending = JSON.parse(sessionStorage.getItem(storageKey)!);
    await expect(flow.resolve(pending, true)).rejects.toThrow();
    gate.resolve(json(receipt("confirm")));
    await first;
    expect(writes()).toHaveLength(1);
  });
  it.each([400, 401, 403, 404, 409, 429, 500])(
    "HTTP %s retains intent and never automatically retries POST",
    async (status) => {
      mutation = async () => json({ code: "CONTROLLED_FAILURE" }, status);
      const flow = setup();
      await flow.reload();
      flow.choose("confirm");
      await flow.execute(true);
      expect(flow.snapshot().phase).toBe("unknown");
      expect(sessionStorage.getItem(storageKey)).not.toBeNull();
      await flow.reload();
      expect(writes()).toHaveLength(1);
      expect(flow.snapshot().phase).toBe("unknown");
    },
  );
  it.each(["COMMITTED", "CLOSED_WITHOUT_EXECUTION"] as const)(
    "%s resolves with original key and only GET follows",
    async (outcome) => {
      const original = seedPending();
      mutation = async () =>
        json(
          outcome === "COMMITTED"
            ? { outcome, receipt: { ...receipt("confirm"), replayed: true } }
            : {
                outcome,
                resolutionId: 5,
                orderId: 19,
                command: "confirm",
                resolvedAt: "2026-10-18T06:00:00.000Z",
              },
        );
      const flow = setup();
      await flow.reload();
      await expect(flow.resolve(original, false)).rejects.toThrow();
      await flow.resolve(original, true);
      expect(flow.snapshot().phase).toBe("ready");
      expect(sessionStorage.getItem(storageKey)).toBeNull();
      expect(writes()).toHaveLength(1);
      expect(writes()[0][0]).toMatch(/resolve-command$/);
      expect((writes()[0][1].headers as Headers).get("Idempotency-Key")).toBe(
        original.idempotencyKey,
      );
    },
  );
  it("lost response persists original intent across recreated controller; malformed resolver keeps it", async () => {
    mutation = async () => {
      throw new TypeError("network loss");
    };
    const flow = setup();
    await flow.reload();
    flow.choose("confirm");
    await flow.execute(true);
    const pending = flow.snapshot().pending!;
    mutation = async () => json({ outcome: "COMMITTED", receipt: {} });
    const next = setup();
    await next.reload();
    await next.resolve(pending, true);
    expect(next.snapshot().pending).toEqual(pending);
    expect(writes()).toHaveLength(2);
  });
  it("successful write followed by failed GET permits only read retry", async () => {
    const flow = setup();
    await flow.reload();
    flow.choose("confirm");
    mutation = async () => {
      transport.mockImplementationOnce(async () => json({}, 503));
      return json(receipt("confirm"));
    };
    await flow.execute(true);
    expect(flow.snapshot().phase).toBe("committed-refresh-error");
    await expect(flow.execute(true)).rejects.toThrow();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    await flow.reload();
    expect(writes()).toHaveLength(1);
  });
  it("failed GET after CLOSED keeps known closure and cannot execute until read succeeds", async () => {
    const pending = seedPending();
    const flow = setup();
    await flow.reload();
    mutation = async () => {
      transport.mockImplementationOnce(async () => json({}, 503));
      return json({
        outcome: "CLOSED_WITHOUT_EXECUTION",
        resolutionId: 1,
        orderId: 19,
        command: "confirm",
        resolvedAt: "2026-10-18T06:00:00.000Z",
      });
    };
    await flow.resolve(pending, true);
    expect(flow.snapshot().phase).toBe("closed-refresh-error");
    expect(() => flow.choose("confirm")).toThrow();
    await flow.reload();
    expect(writes()).toHaveLength(1);
  });
  it("changing login before response prevents settlement and hides old personal data", async () => {
    const gate = deferred<Response>();
    mutation = () => gate.promise;
    const flow = setup();
    await flow.reload();
    flow.choose("confirm");
    const first = flow.execute(true);
    setAccessToken("new-session", 90);
    expect(flow.snapshot().order).toBeNull();
    expect(flow.snapshot().phase).toBe("blocked");
    gate.resolve(json(receipt("confirm")));
    await first;
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
    expect(flow.snapshot().order).toBeNull();
  });
  it("unmount during execution keeps pending until a later explicit resolution", async () => {
    const gate = deferred<Response>();
    mutation = () => gate.promise;
    const flow = setup();
    await flow.reload();
    flow.choose("confirm");
    const first = flow.execute(true);
    flow.setMounted(false);
    gate.resolve(json(receipt("confirm")));
    await first;
    expect(flow.snapshot().phase).toBe("blocked");
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
    const next = setup();
    await next.reload();
    expect(next.snapshot().phase).toBe("unknown");
    expect(writes()).toHaveLength(1);
  });
  it("storage removal failure retains pending even after validated success", async () => {
    const flow = setup();
    await flow.reload();
    flow.choose("confirm");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
    await flow.execute(true);
    expect(flow.snapshot().phase).toBe("unknown");
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
    expect(writes()).toHaveLength(1);
  });
  it("malformed persisted key with trailing newline fails closed before HTTP writes", async () => {
    const old = seedPending();
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ ...old, idempotencyKey: old.idempotencyKey + "\n" }),
    );
    const flow = setup();
    await flow.reload();
    expect(flow.snapshot().phase).toBe("blocked");
    expect(writes()).toHaveLength(0);
  });
  it("pending different Order blocks new commands and is never resolved on current Order", async () => {
    const old = seedPending(20);
    const flow = setup();
    await flow.reload();
    expect(() => flow.choose("confirm")).toThrow();
    await expect(flow.resolve(old, true)).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });
  it.each(["PENDING", "REJECTED", "CLOSED"])(
    "Store %s disallows new commands but permits resolution",
    async (status) => {
      store.status = status;
      const flow = setup();
      await flow.reload();
      expect(() => flow.choose("confirm")).toThrow();
      const pending = seedPending();
      await flow.reload();
      mutation = async () =>
        json({
          outcome: "CLOSED_WITHOUT_EXECUTION",
          resolutionId: 1,
          orderId: 19,
          command: "confirm",
          resolvedAt: "2026-10-18T06:00:00.000Z",
        });
      await flow.resolve(pending, true);
      expect(flow.snapshot().phase).toBe("ready");
    },
  );
  it("SUSPENDED permits old Order preparation", async () => {
    store.status = "SUSPENDED";
    const flow = setup();
    await flow.reload();
    flow.choose("confirm");
    await flow.execute(true);
    expect(writes()).toHaveLength(1);
  });
  it("missing/mismatched Store and invalid payment never open command", async () => {
    store.sellerId = 90;
    const flow = setup();
    await flow.reload();
    expect(flow.snapshot().phase).toBe("error");
    expect(() => flow.choose("confirm")).toThrow();
    store.sellerId = seller.id;
    order.payment = null;
    await flow.reload();
    expect(() => flow.choose("confirm")).toThrow();
    expect(writes()).toHaveLength(0);
  });
  it("storage unavailable or removal failure blocks without manufacturing acknowledgement", async () => {
    const flow = setup();
    await flow.reload();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    flow.choose("confirm");
    await flow.execute(true);
    expect(flow.snapshot().phase).toBe("blocked");
    expect(writes()).toHaveLength(0);
  });
});
