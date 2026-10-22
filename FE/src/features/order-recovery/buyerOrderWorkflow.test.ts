// @vitest-environment node
// Actual flow + merged runtime/journal/validators; mocked HTTP, not DB proof.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buyerCanChoose, createBuyerOrderWorkflow } from "./buyerOrderWorkflow";
import { createBuyerIntentJournal } from "./buyerIntentJournal";
import {
  getAuthSessionVersion,
  setAccessToken,
} from "../../services/apiClient";
import type { VerifiedOrderSession } from "./orderCommandCoordinator";
import type { BuyerReviewRequest } from "./BuyerCommandReview";
import type { BuyerCommand } from "./buyerCommandFingerprint";
import { deferred } from "../order-readiness/testFixtures";
import {
  buyerReceipt,
  commandOrder,
  finalOrder,
  json,
  reason,
  slot,
  time,
} from "./buyerWorkflow.testFixtures";

let session: VerifiedOrderSession, entries: Map<string, string>;
let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
let transport: ReturnType<typeof vi.fn>;
const flows: ReturnType<typeof createBuyerOrderWorkflow>[] = [];
const posts = () =>
  transport.mock.calls.filter(([, init]) => init.method === "POST");
function login(id = 7) {
  setAccessToken("test-only", id);
  session = {
    actor: { id, role: "USER" },
    isActive: true,
    version: getAuthSessionVersion(),
  };
}
function flow(id = 101) {
  const f = createBuyerOrderWorkflow({
    orderId: id,
    getSession: () => session,
    getStorage: () => storage,
  });
  flows.push(f);
  return f;
}
async function ready(f: ReturnType<typeof flow>) {
  f.mount();
  await vi.waitFor(() => expect(f.snapshot().phase).toBe("ready"));
}
function request(
  f: ReturnType<typeof flow>,
  command: BuyerCommand = "cancel",
): BuyerReviewRequest {
  return {
    actorId: 7,
    sessionVersion: session.version,
    orderId: 101,
    command,
    readKey: f.readKey(),
    expectedTotal: "20000.00",
    body: command === "cancel" ? reason : {},
  };
}
async function seed(command: BuyerCommand = "cancel", orderId = 101) {
  return createBuyerIntentJournal({
    getStorage: () => storage,
    getSession: () => session,
  }).prepareNew({
    orderId,
    command,
    body: command === "cancel" ? reason : {},
    confirmed: true,
  });
}
beforeEach(() => {
  login();
  entries = new Map();
  storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
  transport = vi.fn(async () => json(commandOrder()));
  vi.stubGlobal("fetch", transport);
});
afterEach(() => {
  flows.splice(0).forEach((f) => f.unmount());
  setAccessToken(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Buyer production workflow", () => {
  it("mount/choose/dismiss/reload are GET-only; stale read binding cannot execute", async () => {
    const f = flow();
    await ready(f);
    f.choose("cancel");
    const old = request(f);
    f.cancelConfirmation();
    await f.reload();
    f.choose("cancel");
    await expect(f.execute(old)).rejects.toThrow();
    expect(posts()).toHaveLength(0);
  });
  it.each(["cancel", "complete"] as const)(
    "executes %s once under concurrent clicks and keeps verified outcome",
    async (command) => {
      let order = commandOrder(command);
      transport.mockImplementation(async (_url, init) => {
        if (init.method === "POST") {
          order = finalOrder(command);
          return json(buyerReceipt(command));
        }
        return json(order);
      });
      const f = flow();
      await ready(f);
      f.choose(command);
      const input = request(f, command),
        first = f.execute(input);
      await expect(f.execute(input)).rejects.toThrow();
      await first;
      expect(f.snapshot()).toMatchObject({
        phase: "ready",
        outcome: "committed",
        pending: null,
        order: { status: command === "cancel" ? "CANCELLED" : "COMPLETED" },
      });
      expect(posts()).toHaveLength(1);
      expect(entries.has(slot)).toBe(false);
      await f.reload();
      expect(posts()).toHaveLength(1);
    },
  );
  it.each(["cancel", "complete"] as const)(
    "recovers unknown %s after unmount with the same key, never automatically",
    async (command) => {
      let order = commandOrder(command);
      transport.mockImplementation(async (url, init) => {
        if (url.endsWith("/resolve-command"))
          return json({
            outcome: "COMMITTED",
            receipt: buyerReceipt(command, true),
          });
        if (init.method === "POST") {
          order = finalOrder(command);
          throw Error("lost after commit");
        }
        return json(order);
      });
      const first = flow();
      await ready(first);
      first.choose(command);
      await first.execute(request(first, command));
      const raw = entries.get(slot)!;
      expect(raw).not.toContain(reason.reasonText);
      first.unmount();
      const second = flow();
      second.mount();
      await vi.waitFor(() => expect(second.snapshot().phase).toBe("unknown"));
      expect(posts()).toHaveLength(1);
      expect(entries.get(slot)).toBe(raw);
      await second.resolve(second.snapshot().pending!);
      expect(second.snapshot().outcome).toBe("committed");
      expect(posts()).toHaveLength(2);
      expect(posts()[1][1].headers.get("Idempotency-Key")).toBe(
        JSON.parse(raw).idempotencyKey,
      );
      expect(entries.has(slot)).toBe(false);
    },
  );
  it.each([400, 401, 403, 404, 409, 429, 500])(
    "keeps original pending on HTTP%s; no refresh or automatic replay",
    async (status) => {
      transport.mockImplementation(async (_url, init) =>
        init.method === "POST"
          ? json({ message: "fixture failure" }, status)
          : json(commandOrder()),
      );
      const f = flow();
      await ready(f);
      f.choose("cancel");
      await f.execute(request(f));
      expect(f.snapshot().phase).toBe("unknown");
      expect(entries.has(slot)).toBe(true);
      expect(posts()).toHaveLength(1);
      await f.reload();
      expect(posts()).toHaveLength(1);
    },
  );
  it("rejects malformed HTTP200 receipt without deleting pending", async () => {
    transport.mockImplementation(async (_url, init) =>
      init.method === "POST"
        ? json({ ...buyerReceipt(), injected: true })
        : json(commandOrder()),
    );
    const f = flow();
    await ready(f);
    f.choose("cancel");
    await f.execute(request(f));
    expect(f.snapshot().phase).toBe("unknown");
    expect(entries.has(slot)).toBe(true);
  });
  it.each(["cancel", "complete"] as const)(
    "known %s receipt + GET failure only permits GET retry",
    async (command) => {
      let done = false,
        fail = true;
      transport.mockImplementation(async (_url, init) => {
        if (init.method === "POST") {
          done = true;
          return json(buyerReceipt(command));
        }
        if (done && fail) throw Error("GET offline");
        return json(done ? finalOrder(command) : commandOrder(command));
      });
      const f = flow();
      await ready(f);
      f.choose(command);
      const input = request(f, command);
      await f.execute(input);
      expect(f.snapshot().phase).toBe("committed-refresh-error");
      expect(entries.has(slot)).toBe(false);
      await expect(f.execute(input)).rejects.toThrow();
      expect(() => f.choose(command)).toThrow();
      fail = false;
      await f.reload();
      expect(f.snapshot().phase).toBe("ready");
      expect(posts()).toHaveLength(1);
    },
  );
  it("CLOSED + failed GET cannot create a new key until GET succeeds; then separate intent works", async () => {
    const old = await seed();
    let closed = false,
      failRead = true,
      done = false;
    transport.mockImplementation(async (url, init) => {
      if (url.endsWith("/resolve-command")) {
        closed = true;
        return json({
          outcome: "CLOSED_WITHOUT_EXECUTION",
          resolutionId: 8,
          orderId: 101,
          command: "cancel",
          resolvedAt: time,
        });
      }
      if (init.method === "POST") {
        done = true;
        return json(buyerReceipt());
      }
      if (closed && failRead) throw Error("GET offline");
      return json(done ? finalOrder() : commandOrder());
    });
    const f = flow();
    f.mount();
    await vi.waitFor(() => expect(f.snapshot().phase).toBe("unknown"));
    await f.resolve(old);
    expect(f.snapshot().phase).toBe("closed-refresh-error");
    expect(entries.has(slot)).toBe(false);
    expect(() => f.choose("cancel")).toThrow();
    failRead = false;
    await f.reload();
    f.choose("cancel");
    await f.execute(request(f));
    expect(f.snapshot().outcome).toBe("committed");
    expect(posts()).toHaveLength(2);
    expect(posts()[1][1].headers.get("Idempotency-Key")).not.toBe(
      old.idempotencyKey,
    );
  });
  it("pending on another Order blocks writes and never closes the wrong order", async () => {
    const old = await seed("cancel", 102),
      f = flow();
    f.mount();
    await vi.waitFor(() => expect(f.snapshot().phase).toBe("unknown"));
    await expect(f.resolve(old)).rejects.toThrow();
    expect(() => f.choose("cancel")).toThrow();
    expect(posts()).toHaveLength(0);
  });
  it("storage refusal fails closed before POST; no pending is erased", async () => {
    storage.setItem = () => {
      throw Error("quota");
    };
    const f = flow();
    await ready(f);
    f.choose("cancel");
    await f.execute(request(f));
    expect(f.snapshot().phase).toBe("blocked");
    expect(posts()).toHaveLength(0);
  });
  it("blocked storage access does not permit commands", async () => {
    storage.getItem = () => {
      throw Error("access denied");
    };
    const f = flow();
    f.mount();
    await vi.waitFor(() => expect(f.snapshot().phase).toBe("blocked"));
    expect(posts()).toHaveLength(0);
  });
  it("account change while response is held leaves the old journal and exposes no old detail", async () => {
    const held = deferred<Response>();
    transport.mockImplementation(async (_url, init) =>
      init.method === "POST" ? held.promise : json(commandOrder()),
    );
    const f = flow();
    await ready(f);
    f.choose("cancel");
    const running = f.execute(request(f));
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    const raw = entries.get(slot);
    login(8);
    held.resolve(json(buyerReceipt()));
    await running;
    expect(f.snapshot()).toMatchObject({ phase: "blocked", order: null });
    expect(entries.get(slot)).toBe(raw);
  });
  it("StrictMode old GET cannot publish or release the next mount job", async () => {
    const old = deferred<Response>(),
      fresh = deferred<Response>();
    transport
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const f = flow();
    f.mount();
    f.unmount();
    f.mount();
    old.resolve(json(finalOrder()));
    await Promise.resolve();
    await Promise.resolve();
    expect(f.snapshot().phase).toBe("loading");
    await f.reload();
    expect(transport).toHaveBeenCalledTimes(2); // Old finally must not release new job.
    fresh.resolve(json(commandOrder()));
    await vi.waitFor(() => expect(f.snapshot().phase).toBe("ready"));
    expect(f.snapshot().order?.status).toBe("PENDING_CONFIRMATION");
  });
  it("supports explicit legacy V1 complete recovery; mount never upgrades it", async () => {
    const legacy = {
      schemaVersion: 1,
      actorId: 7,
      role: "USER",
      orderId: 101,
      command: "complete",
      idempotencyKey: "legacy-buyer-complete-123",
      createdAt: time,
    };
    entries.set(slot, JSON.stringify(legacy));
    transport.mockImplementation(async (url) =>
      url.endsWith("/resolve-command")
        ? json({
            outcome: "CLOSED_WITHOUT_EXECUTION",
            resolutionId: 9,
            orderId: 101,
            command: "complete",
            resolvedAt: time,
          })
        : json(commandOrder("complete")),
    );
    const f = flow();
    f.mount();
    await vi.waitFor(() => expect(f.snapshot().phase).toBe("unknown"));
    expect(entries.get(slot)).toBe(JSON.stringify(legacy));
    expect(posts()).toHaveLength(0);
    await f.resolve(f.snapshot().pending!);
    expect(f.snapshot().outcome).toBe("closed");
    expect(entries.has(slot)).toBe(false);
    expect(posts()[0][1].headers.get("Idempotency-Key")).toBe(
      legacy.idempotencyKey,
    );
  });
  it.each([
    "CONFIRMED",
    "PACKING",
    "READY_TO_SHIP",
    "SHIPPING",
    "CANCELLED",
    "COMPLETED",
  ] as const)("does not offer Buyer actions in %s", (status) => {
    const order = commandOrder();
    order.status = status;
    expect(buyerCanChoose(order, "cancel")).toBe(false);
    expect(buyerCanChoose(order, "complete")).toBe(false);
  });
  it("requires matching payment currency/total and actual paid delivery for completion", () => {
    const order = commandOrder();
    order.payment!.amount = "1.00";
    expect(buyerCanChoose(order, "cancel")).toBe(false);
    const delivered = commandOrder("complete");
    delivered.payment!.paidAt = null;
    expect(buyerCanChoose(delivered, "complete")).toBe(false);
  });
});
