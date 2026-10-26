// @vitest-environment jsdom
// @ts-expect-error Node-only fixture; browser app intentionally excludes Node ambient types.
import { createHash, webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../../services/apiClient";
import { aftersaleApi, parseResolution } from "./aftersaleApi";
import {
  loadPending,
  normalizeReason,
  prepareIntent,
  type Action,
  type Intent,
  type RequestRow,
  type Scope,
} from "./aftersaleIntent";
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  setAccessToken("synthetic-only", 1);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const row: RequestRow = {
  id: 21,
  orderItemId: 31,
  kind: "REFUND_ONLY",
  state: "PENDING",
  revision: 1,
};
const create = () => ({
  kind: "REFUND_ONLY",
  reasonCode: "DAMAGED",
  description: "  QA hàng bị hỏng khi nhận  ",
});
const change = () => ({
  expectedRevision: 1,
  reason: "  QA quyết định có lý do rõ  ",
});
const signal = () => new AbortController().signal;
function applied(intent: Intent) {
  const e = intent.expected;
  const request = {
    id: e.requestId ?? 81,
    orderItemId: e.orderItemId,
    kind: e.kind,
    state: e.state,
    revision: e.revision,
  };
  return {
    commandId: intent.commandId,
    outcome: "APPLIED",
    current: { ...request },
    receipt: {
      request,
      historyId: "123",
      refund:
        e.refundAmount === null
          ? null
          : {
              id: "456",
              amount: e.refundAmount,
              currency: "VND",
              mode: "SIMULATED",
            },
    },
  };
}
describe("Aftersales privacy, canonical hash and CAS journal", () => {
  it("matches Backend canonical SHA256 and stores no reason, description, token or body", async () => {
    const p = await prepareIntent(1, "BUYER", "create", 31, create());
    const expected = createHash("sha256")
      .update(
        JSON.stringify({
          scope: "BUYER",
          action: "create",
          targetId: 31,
          body: {
            kind: "REFUND_ONLY",
            reasonCode: "DAMAGED",
            description: "QA hàng bị hỏng khi nhận",
          },
        }),
      )
      .digest("hex");
    expect(p.value.requestHash).toBe(expected);
    expect(loadPending(1)?.raw).toBe(p.raw);
    expect(p.raw).not.toContain("hàng bị hỏng");
    expect(p.raw).not.toMatch(/description|reason|token|body/);
    expect(p.body).toEqual({
      kind: "REFUND_ONLY",
      reasonCode: "DAMAGED",
      description: "QA hàng bị hỏng khi nhận",
    });
  });
  it.each(["cancel", "dispute", "approve", "reject", "receive"] as Action[])(
    "hashes %s in exact Backend key order",
    async (action) => {
      const scope: Scope = ["cancel", "dispute"].includes(action)
        ? "BUYER"
        : "SELLER";
      const current = {
        ...row,
        state:
          action === "dispute"
            ? "REJECTED"
            : action === "receive"
              ? "AWAITING_RETURN"
              : "PENDING",
        kind: action === "receive" ? "RETURN_AND_REFUND" : "REFUND_ONLY",
      } as RequestRow;
      const body = {
        ...change(),
        ...(action === "receive" ? { restockable: false } : {}),
      };
      const p = await prepareIntent(
        1,
        scope,
        action,
        row.id,
        body,
        current,
        "100000.00",
      );
      expect(p.value.requestHash).toBe(
        createHash("sha256")
          .update(
            JSON.stringify({
              scope,
              action,
              targetId: row.id,
              body: {
                expectedRevision: 1,
                reason: "QA quyết định có lý do rõ",
                ...(action === "receive" ? { restockable: false } : {}),
              },
            }),
          )
          .digest("hex"),
      );
    },
  );
  it("captures request identity/body before delayed WebCrypto", async () => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(
      async (algorithm, input) => {
        await gate;
        return digest(algorithm, input);
      },
    );
    const input = create(),
      p = prepareIntent(1, "BUYER", "create", 31, input);
    input.description = "Changed while hashing must not affect pending";
    input.kind = "RETURN_AND_REFUND";
    release();
    const ready = await p;
    expect(ready.body).toMatchObject({
      kind: "REFUND_ONLY",
      description: "QA hàng bị hỏng khi nhận",
    });
    expect(ready.value.expected.kind).toBe("REFUND_ONLY");
  });
  it("permits only one concurrent intent per actor across scopes", async () => {
    const candidates = await Promise.allSettled([
      prepareIntent(1, "BUYER", "create", 31, create()),
      prepareIntent(1, "SELLER", "approve", 21, change(), row, "100000.00"),
    ]);
    expect(candidates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(candidates.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("does not store a late candidate after a session change", async () => {
    const p = prepareIntent(1, "BUYER", "create", 31, create());
    setAccessToken("other-synthetic", 2);
    await expect(p).rejects.toThrow();
    expect(loadPending(1)).toBeNull();
  });
  it.each(["short", "has\u0000invalid controls", "lone\ud800surrogate"])(
    "rejects invalid reason %s",
    (value) => {
      expect(() => normalizeReason(value)).toThrow();
    },
  );
  it("normalizes NFC while preserving permitted tabs and newlines", () => {
    expect(normalizeReason("  QA người mua\ncó lý do  ")).toBe(
      "QA người mua\ncó lý do",
    );
  });
  it("refuses storage corruption without deleting it", async () => {
    const p = await prepareIntent(1, "BUYER", "create", 31, create());
    const key = sessionStorage.key(0)!;
    sessionStorage.setItem(key, "{broken");
    expect(() => loadPending(1)).toThrow();
    expect(sessionStorage.getItem(key)).toBe("{broken");
    expect(p.raw).not.toBe("{broken");
  });
  it("fails before dispatch when durable storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    await expect(
      prepareIntent(1, "BUYER", "create", 31, create()),
    ).rejects.toThrow();
  });
});
describe("Aftersales execution and explicit recovery proofs", () => {
  it('accepts both initial create current and null replay current, while rejecting another request', async () => {
    const p = await prepareIntent(1, 'BUYER', 'create', 31, create());
    const initial = applied(p.value);
    expect(parseResolution(initial, p.value, false).current!.id).toBe(81);
    expect(parseResolution({ ...initial, current: null }, p.value, true).receipt!.request.id).toBe(81);
    expect(() => parseResolution({ ...initial, current: { ...initial.current, id: 82 } }, p.value, true)).toThrow();
    expect(() => parseResolution({ ...initial, current: { ...initial.current, orderItemId: 32 } }, p.value, false)).toThrow();
  });
  it("settles only a bound APPLIED receipt and never auto-retries 401", async () => {
    const p = await prepareIntent(
      1,
      "SELLER",
      "approve",
      21,
      change(),
      row,
      "100000.00",
    );
    const requester = vi.fn().mockResolvedValue(applied(p.value));
    await aftersaleApi(1, "SELLER", requester).execute(p, p.body, signal());
    expect(loadPending(1)).toBeNull();
    expect(requester).toHaveBeenCalledTimes(1);
    expect(requester.mock.calls[0]![0]).toBe(
      "/seller/aftersales/requests/21/approve",
    );
    expect(requester.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      retryOnUnauthorized: false,
    });
  });
  it.each([
    "command",
    "item",
    "request",
    "revision",
    "state",
    "kind",
    "history",
    "refund",
    "current",
  ])("retains pending for mismatched %s proof", async (mismatch) => {
    const p = await prepareIntent(
        1,
        "SELLER",
        "approve",
        21,
        change(),
        row,
        "100000.00",
      ),
      response = applied(p.value);
    if (mismatch === "command") response.commandId = crypto.randomUUID();
    if (mismatch === "item") response.receipt.request.orderItemId++;
    if (mismatch === "request") response.receipt.request.id++;
    if (mismatch === "revision") response.receipt.request.revision++;
    if (mismatch === "state") response.receipt.request.state = "PENDING";
    if (mismatch === "kind")
      response.receipt.request.kind = "RETURN_AND_REFUND";
    if (mismatch === "history") response.receipt.historyId = "0";
    if (mismatch === "refund") response.receipt.refund!.amount = "1.00";
    if (mismatch === "current") response.current!.id++;
    await expect(
      aftersaleApi(1, "SELLER", vi.fn().mockResolvedValue(response)).execute(
        p,
        p.body,
        signal(),
      ),
    ).rejects.toThrow();
    expect(loadPending(1)?.raw).toBe(p.raw);
  });
  it("requires explicit consent and sends only hash/UUID to reconciliation", async () => {
    const p = await prepareIntent(1, "BUYER", "create", 31, create()),
      requester = vi.fn().mockResolvedValue({
        commandId: p.value.commandId,
        outcome: "CLOSED",
        receipt: null,
        current: null,
      });
    const api = aftersaleApi(1, "BUYER", requester);
    expect(() => api.reconcile(p, signal(), false)).toThrow();
    expect(requester).not.toHaveBeenCalled();
    expect((await api.reconcile(p, signal(), true)).outcome).toBe("CLOSED");
    expect(loadPending(1)).toBeNull();
    expect(JSON.parse(requester.mock.calls[0]![1].body)).toEqual({
      commandId: p.value.commandId,
      requestHash: p.value.requestHash,
    });
  });
  it("rejects a CLOSED 200 from the execute route as an invalid proof", async () => {
    const p = await prepareIntent(1, "BUYER", "create", 31, create());
    await expect(
      aftersaleApi(
        1,
        "BUYER",
        vi.fn().mockResolvedValue({
          commandId: p.value.commandId,
          outcome: "CLOSED",
          receipt: null,
          current: null,
        }),
      ).execute(p, p.body, signal()),
    ).rejects.toThrow();
    expect(loadPending(1)?.raw).toBe(p.raw);
  });
  it("keeps the original key after a lost response, then resolves the server receipt", async () => {
    const p = await prepareIntent(1, "BUYER", "create", 31, create()),
      requester = vi
        .fn()
        .mockRejectedValueOnce(Error("response lost"))
        .mockResolvedValueOnce(applied(p.value));
    const api = aftersaleApi(1, "BUYER", requester);
    await expect(api.execute(p, p.body, signal())).rejects.toThrow();
    expect(loadPending(1)?.value.commandId).toBe(p.value.commandId);
    await api.reconcile(loadPending(1)!, signal(), true);
    expect(requester).toHaveBeenCalledTimes(2);
    expect(loadPending(1)).toBeNull();
  });
  it("does not execute a changed body or clear a different CAS record", async () => {
    const p = await prepareIntent(1, "BUYER", "create", 31, create()),
      requester = vi.fn();
    await expect(
      aftersaleApi(1, "BUYER", requester).execute(
        p,
        {
          ...create(),
          kind: "RETURN_AND_REFUND",
          description: "Different canonical description",
        },
        signal(),
      ),
    ).rejects.toThrow();
    expect(requester).not.toHaveBeenCalled();
    expect(loadPending(1)?.raw).toBe(p.raw);
    sessionStorage.setItem(
      sessionStorage.key(0)!,
      p.raw.replace(p.value.commandId, crypto.randomUUID()),
    );
    await expect(
      aftersaleApi(1, "BUYER", requester).reconcile(p, signal(), true),
    ).rejects.toThrow();
    expect(requester).not.toHaveBeenCalled();
  });
  it("does not clear the old actor journal after an account switch in flight", async () => {
    const p = await prepareIntent(1, "BUYER", "create", 31, create()),
      requester = vi.fn(async () => {
        setAccessToken("other-synthetic", 2);
        return applied(p.value);
      });
    await expect(
      aftersaleApi(1, "BUYER", requester).execute(p, p.body, signal()),
    ).rejects.toThrow();
    expect(loadPending(1)?.raw).toBe(p.raw);
  });
  it("accepts a newer current revision without treating it as the historical receipt", async () => {
    const p = await prepareIntent(1, "SELLER", "reject", 21, change(), row),
      response = applied(p.value);
    response.current = { ...response.current!, state: "DISPUTED", revision: 3 };
    expect(
      parseResolution(response, p.value, true).receipt!.request.revision,
    ).toBe(2);
  });
});
