import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { createServer, request } from "node:http";
import { once } from "node:events";
type Fixture = { orderId: number; buyer: { id: number; token: string } };
const profile = JSON.parse(process.env.BCKL_BUYER_LIVE_QA ?? "null") as {
  origin: string;
  fixtures: Record<string, Fixture>;
  other: { id: number; token: string };
} | null;
if (!profile) throw new Error("Explicit isolated live QA host required");
const upstream = new URL(profile.origin);
if (
  upstream.protocol !== "http:" ||
  upstream.hostname !== "127.0.0.1" ||
  Number(upstream.port) < 1024 ||
  ["3000", "3001", "3011", "5432", "5549"].includes(upstream.port) ||
  upstream.pathname !== "/" ||
  upstream.username ||
  upstream.password ||
  upstream.search ||
  upstream.hash
)
  throw new Error("Ephemeral QA host required");
const reason = {
  reasonCode: "OTHER" as const,
  reasonText: "QA live đổi ý mua hàng",
};
const entries = new Map<string, string>();
const storage = {
  getItem: (k: string) => entries.get(k) ?? null,
  setItem: (k: string, v: string) => {
    entries.set(k, v);
  },
  removeItem: (k: string) => {
    entries.delete(k);
  },
};
let mode: "none" | "drop" | "hold" | "fail-get" = "none";
let releaseHeld = () => {},
  upstreamCompleted = () => {};
let posts = 0,
  gets = 0;
const server = createServer((incoming, outgoing) => {
  if (
    !/^\/orders\/[1-9][0-9]*(\/(cancel|complete|resolve-command))?$/.test(
      incoming.url ?? "",
    ) ||
    !["POST", "GET"].includes(incoming.method ?? "")
  ) {
    incoming.resume();
    outgoing.writeHead(404);
    outgoing.end();
    return;
  }
  if (incoming.method === "GET") {
    gets++;
    if (mode === "fail-get") {
      mode = "none";
      incoming.resume();
      outgoing.destroy();
      return;
    }
  } else posts++;
  const relay = request(
    new URL(incoming.url!, upstream),
    {
      method: incoming.method,
      headers: { ...incoming.headers, host: upstream.host },
      agent: false,
    },
    (response) => {
      const action =
        incoming.method === "POST" && response.statusCode === 200
          ? mode
          : "none";
      if (action === "drop" || action === "hold") {
        mode = "none";
        const chunks: Buffer[] = [];
        response.on("data", (bytes) => chunks.push(bytes));
        response.once("end", () => {
          releaseHeld = () => {
            if (!outgoing.destroyed) {
              outgoing.writeHead(response.statusCode!, response.headers);
              outgoing.end(Buffer.concat(chunks));
            }
          };
          if (action === "drop") outgoing.destroy();
          upstreamCompleted();
        });
      } else {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      }
      response.once("error", () => outgoing.destroy());
    },
  );
  relay.once("error", () => outgoing.destroy());
  relay.setTimeout(35000, () => relay.destroy());
  incoming.pipe(relay);
});
let auth: typeof import("../src/services/apiClient");
let createJournal: typeof import("../src/features/order-recovery/buyerIntentJournal").createBuyerIntentJournal;
let createRecovery: typeof import("../src/features/order-recovery/buyerCommandRecovery").createBuyerCommandRecovery;
let createRuntime: typeof import("../src/features/order-recovery/buyerCommandRecovery").createBuyerCommandRuntime;
let session: import("../src/features/order-recovery/orderCommandCoordinator").VerifiedOrderSession;
let origin: string;
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("QA proxy unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("VITE_API_URL", origin);
  auth = await import("../src/services/apiClient");
  createJournal = (
    await import("../src/features/order-recovery/buyerIntentJournal")
  ).createBuyerIntentJournal;
  createRecovery = (
    await import("../src/features/order-recovery/buyerCommandRecovery")
  ).createBuyerCommandRecovery;
  createRuntime = (
    await import("../src/features/order-recovery/buyerCommandRecovery")
  ).createBuyerCommandRuntime;
});
afterEach(() => {
  mode = "none";
  releaseHeld();
  upstreamCompleted = () => {};
  vi.restoreAllMocks();
  auth.setAccessToken(null);
});
afterAll(async () => {
  server.closeAllConnections();
  const closed = once(server, "close");
  server.close();
  await closed;
  vi.unstubAllEnvs();
});
function login(who: { id: number; token: string }) {
  auth.setAccessToken(who.token, who.id);
  session = {
    actor: { id: who.id, role: "USER" },
    isActive: true,
    version: auth.getAuthSessionVersion(),
  };
}
async function prepare(
  name: string,
  command: "cancel" | "complete" = "cancel",
) {
  const fixture = profile!.fixtures[name];
  login(fixture.buyer);
  const log = createJournal({
    getSession: () => session,
    getStorage: () => storage,
  });
  const intent = await log.prepareNew({
    orderId: fixture.orderId,
    command,
    body: command === "cancel" ? reason : {},
    confirmed: true,
  });
  const { orderApi } = await import("../src/services/orderApi");
  const order = await orderApi.detail("buyer", fixture.orderId);
  const coordinator = () =>
    createRecovery({ getSession: () => session, getStorage: () => storage });
  const execute = () =>
    fetch(`${origin}/orders/${fixture.orderId}/${command}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.buyer.token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": intent.idempotencyKey,
      },
      body: JSON.stringify(command === "cancel" ? reason : {}),
      signal: AbortSignal.timeout(15000),
    });
  return {
    fixture,
    log,
    intent,
    order,
    coordinator,
    execute,
    slot: `bckl-order-command-journal-v1:${fixture.buyer.id}`,
  };
}
it.each(["cancel", "complete"] as const)(
  "lost execute response: real %s commits once, remounted coordinator resolves original receipt",
  async (command) => {
    const c = await prepare(`${command}_lost_execute`, command),
      before = entries.get(c.slot);
    mode = "drop";
    await expect(c.execute()).rejects.toThrow();
    expect(entries.get(c.slot)).toBe(before);
    const result = await c
      .coordinator()
      .resolve({ intent: c.log.pending()!, order: c.order, confirmed: true });
    expect(result.phase).toBe("committed");
    expect(entries.has(c.slot)).toBe(false);
    if (result.phase === "committed")
      expect(result.order.status).toBe(
        command === "cancel" ? "CANCELLED" : "COMPLETED",
      );
  },
);
it("lost resolver response: real CLOSED fence survives and new coordinator closes the same pending only", async () => {
  const c = await prepare("cancel_lost_resolve"),
    before = entries.get(c.slot),
    first = c.coordinator();
  mode = "drop";
  await expect(
    first.resolve({ intent: c.intent, order: c.order, confirmed: true }),
  ).rejects.toThrow();
  expect(entries.get(c.slot)).toBe(before);
  first.dispose();
  const result = await c
    .coordinator()
    .resolve({ intent: c.log.pending()!, order: c.order, confirmed: true });
  expect(result.phase).toBe("closed");
  expect(entries.has(c.slot)).toBe(false);
  const late = await c.execute();
  expect(late.status).toBe(409);
  expect((await late.json()).code).toBe("ORDER_COMMAND_CLOSED");
});
it("complete key CLOSED does not mark a pending Order complete", async () => {
  const c = await prepare("complete_closed", "complete");
  const result = await c
    .coordinator()
    .resolve({ intent: c.intent, order: c.order, confirmed: true });
  expect(result.phase).toBe("closed");
  if (result.phase === "closed")
    expect(result.order.status).toBe("PENDING_CONFIRMATION");
});
it("account switch while real resolver response is held cannot settle old storage; owner resolves after login", async () => {
  const c = await prepare("cancel_session_switch"),
    before = entries.get(c.slot),
    recovery = c.coordinator();
  const received = new Promise<void>((resolve) => {
    upstreamCompleted = resolve;
  });
  mode = "hold";
  const pending = recovery.resolve({
    intent: c.intent,
    order: c.order,
    confirmed: true,
  });
  const rejected = expect(pending).rejects.toThrow();
  await received;
  login(profile!.other);
  releaseHeld();
  await rejected;
  expect(entries.get(c.slot)).toBe(before);
  expect(recovery.getState().phase).toBe("blocked");
  expect(c.coordinator().pending()).toBeNull();
  const { orderApi } = await import("../src/services/orderApi");
  await expect(
    orderApi.detail("buyer", c.fixture.orderId),
  ).rejects.toMatchObject({ status: 404 });
  login(c.fixture.buyer);
  expect(
    (
      await c
        .coordinator()
        .resolve({ intent: c.log.pending()!, order: c.order, confirmed: true })
    ).phase,
  ).toBe("closed");
});
it("real COMMITTED plus lost GET response keeps outcome; reload sends GET only", async () => {
  const c = await prepare("cancel_get_fail");
  expect((await c.execute()).status).toBe(200);
  mode = "fail-get";
  const recovery = c.coordinator(),
    beforePosts = posts;
  expect(
    (
      await recovery.resolve({
        intent: c.intent,
        order: c.order,
        confirmed: true,
      })
    ).phase,
  ).toBe("committed-refresh-error");
  const afterPosts = posts;
  expect(afterPosts).toBe(beforePosts + 1);
  expect((await recovery.reload()).phase).toBe("committed");
  expect(posts).toBe(afterPosts);
  expect(entries.has(c.slot)).toBe(false);
});
it("timeout fault after real resolver commit retains key; explicit retry uses durable fence", async () => {
  const c = await prepare("cancel_timeout"),
    before = entries.get(c.slot),
    timeout = new AbortController();
  const received = new Promise<void>((resolve) => {
    upstreamCompleted = resolve;
  });
  mode = "hold";
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal); // Fault injection, not a lower production deadline.
  const pending = c
    .coordinator()
    .resolve({ intent: c.intent, order: c.order, confirmed: true });
  const rejected = expect(pending).rejects.toThrow();
  await received;
  timeout.abort(new DOMException("Injected QA timeout", "TimeoutError"));
  await rejected;
  expect(entries.get(c.slot)).toBe(before);
  releaseHeld();
  vi.restoreAllMocks();
  expect(
    (
      await c
        .coordinator()
        .resolve({ intent: c.log.pending()!, order: c.order, confirmed: true })
    ).phase,
  ).toBe("closed");
});
it("same-tick double click forwards only one resolver to the real server", async () => {
  const c = await prepare("cancel_doubleclick"),
    recovery = c.coordinator(),
    beforePosts = posts;
  const first = recovery.resolve({
    intent: c.intent,
    order: c.order,
    confirmed: true,
  });
  await expect(
    recovery.resolve({ intent: c.intent, order: c.order, confirmed: true }),
  ).rejects.toThrow();
  expect((await first).phase).toBe("closed");
  expect(posts).toBe(beforePosts + 1);
  expect(gets).toBeGreaterThan(0);
});

it("actual execute timeout after commit retains key until explicit resolution", async () => {
  const c = await runtimeFixture("cancel_runtime_timeout"),
    deadline = new AbortController();
  const received = new Promise<void>((resolve) => {
    upstreamCompleted = resolve;
  });
  mode = "hold";
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const sending = c.runtime.execute(c.input),
    rejected = expect(sending).rejects.toThrow();
  await received;
  const before = entries.get(c.slot);
  expect(before).toBeTruthy();
  deadline.abort(new DOMException("Injected execute timeout", "TimeoutError"));
  await rejected;
  expect(entries.get(c.slot)).toBe(before);
  releaseHeld();
  vi.restoreAllMocks();
  const fresh = c.make();
  expect(
    (
      await fresh.resolve({
        intent: fresh.pending()!,
        order: c.order,
        confirmed: true,
      })
    ).phase,
  ).toBe("committed");
  expect(entries.has(c.slot)).toBe(false);
});

// These scenarios exercise the actual execute adapter/lifecycle, unlike the
// raw execute used intentionally above to construct recovery-only situations.
async function runtimeFixture(
  name: string,
  command: "cancel" | "complete" = "cancel",
) {
  const fixture = profile!.fixtures[name];
  login(fixture.buyer);
  const { orderApi } = await import("../src/services/orderApi");
  const order = await orderApi.detail("buyer", fixture.orderId);
  const make = () =>
    createRuntime({ getSession: () => session, getStorage: () => storage });
  const runtime = make();
  const input = {
    orderId: fixture.orderId,
    order,
    command,
    body: command === "cancel" ? reason : {},
    confirmed: true,
  };
  return {
    fixture,
    order,
    runtime,
    input,
    make,
    slot: `bckl-order-command-journal-v1:${fixture.buyer.id}`,
  };
}
it.each(["cancel", "complete"] as const)(
  "real execute lifecycle: %s validates receipt, clears own pending, then reads Order",
  async (command) => {
    const c = await runtimeFixture(`${command}_runtime_success`, command),
      beforePosts = posts;
    const result = await c.runtime.execute(c.input);
    expect(result.phase).toBe("committed");
    expect(entries.has(c.slot)).toBe(false);
    if (result.phase === "committed") {
      expect(result.outcome.outcome).toBe("COMMITTED");
      expect(result.order.status).toBe(
        command === "cancel" ? "CANCELLED" : "COMPLETED",
      );
    }
    await expect(c.runtime.execute(c.input)).rejects.toThrow();
    expect(posts).toBe(beforePosts + 1);
  },
);
it("real execute lost response retains key and remounted runtime resolves original receipt without replaying execute", async () => {
  const c = await runtimeFixture("cancel_runtime_lost"),
    beforePosts = posts;
  mode = "drop";
  await expect(c.runtime.execute(c.input)).rejects.toThrow();
  const raw = entries.get(c.slot);
  expect(raw).toBeTruthy();
  expect(raw).not.toContain(reason.reasonText);
  await expect(c.runtime.execute(c.input)).rejects.toThrow();
  expect(posts).toBe(beforePosts + 1);
  c.runtime.dispose();
  const fresh = c.make();
  const result = await fresh.resolve({
    intent: fresh.pending()!,
    order: c.order,
    confirmed: true,
  });
  expect(result.phase).toBe("committed");
  expect(entries.has(c.slot)).toBe(false);
  if (result.phase === "committed" && result.outcome.outcome === "COMMITTED")
    expect(result.outcome.receipt.replayed).toBe(true);
  expect(posts).toBe(beforePosts + 2); // One execute + one explicit resolver.
});
it("real execute same-tick double click forwards one mutation only", async () => {
  const c = await runtimeFixture("cancel_runtime_double"),
    beforePosts = posts;
  const sending = c.runtime.execute(c.input);
  await expect(c.runtime.execute(c.input)).rejects.toThrow();
  expect((await sending).phase).toBe("committed");
  expect(posts).toBe(beforePosts + 1);
});
it("real successful execute with lost GET response keeps known outcome and retries GET only", async () => {
  const c = await runtimeFixture("cancel_runtime_getfail"),
    beforePosts = posts;
  mode = "fail-get";
  expect((await c.runtime.execute(c.input)).phase).toBe(
    "committed-refresh-error",
  );
  expect(entries.has(c.slot)).toBe(false);
  expect(posts).toBe(beforePosts + 1);
  expect((await c.runtime.reload()).phase).toBe("committed");
  expect(posts).toBe(beforePosts + 1);
});
it("account switch during actual execute response cannot clear owner intent; owner resolves after login", async () => {
  const c = await runtimeFixture("cancel_runtime_switch");
  const received = new Promise<void>((resolve) => {
    upstreamCompleted = resolve;
  });
  mode = "hold";
  const sending = c.runtime.execute(c.input),
    rejected = expect(sending).rejects.toThrow();
  await received;
  const before = entries.get(c.slot);
  expect(before).toBeTruthy();
  login(profile!.other);
  releaseHeld();
  await rejected;
  expect(entries.get(c.slot)).toBe(before);
  expect(c.runtime.getState().phase).toBe("blocked");
  login(c.fixture.buyer);
  const fresh = c.make();
  expect(
    (
      await fresh.resolve({
        intent: fresh.pending()!,
        order: c.order,
        confirmed: true,
      })
    ).phase,
  ).toBe("committed");
  expect(entries.has(c.slot)).toBe(false);
});
