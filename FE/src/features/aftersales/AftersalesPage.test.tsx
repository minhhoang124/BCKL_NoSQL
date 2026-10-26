// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// @ts-expect-error Node-only fixture; browser app intentionally excludes Node ambient types.
import { webcrypto } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AftersalesPage } from "./AftersalesPage";
import { aftersaleApi } from "./aftersaleApi";
import {
  loadPending,
  prepareIntent,
  type RequestRow,
  type Scope,
} from "./aftersaleIntent";
import { ApiError, setAccessToken } from "../../services/apiClient";
import { orderApi } from "../../services/orderApi";
import { detailFixture } from "../order-readiness/testFixtures";
import type { User } from "../../types/auth";
const auth = vi.hoisted(() => ({
  user: {
    id: 1,
    email: "qa@example.invalid",
    role: "USER",
    fullName: "QA",
    isActive: true,
  } as User | null,
  loading: false,
}));
vi.mock("../../contexts/useAuth", () => ({ useAuth: () => auth }));
const context = {
  orderId: 11,
  storeId: 4,
  buyerId: 1,
  storeName: "QA Store",
  productName: "QA item",
  quantity: 1,
  lineTotal: "100000.00",
};
const initial: RequestRow = {
  id: 21,
  orderItemId: 31,
  kind: "REFUND_ONLY",
  state: "PENDING",
  revision: 1,
};
const iso = "2026-10-26T00:00:00.000Z";
function server(scope: Scope, existing?: RequestRow) {
  let current = existing ? { ...existing } : null;
  const saved = new Map<string, unknown>();
  const controls = {
    lost: false,
    failReads: false,
    malformed: false,
    writeCount: 0,
    gate: null as Promise<void> | null,
  };
  const requester = vi.fn(
    async (
      path: string,
      options: { method?: string; body?: BodyInit | null },
    ) => {
      const u = new URL(path, "http://qa.invalid");
      if (options.method === "POST") {
        const body = JSON.parse(String(options.body));
        if (u.pathname.endsWith("/reconcile"))
          return (
            saved.get(body.commandId) ?? {
              commandId: body.commandId,
              outcome: "CLOSED",
              receipt: null,
              current: u.pathname.includes("/create/") ? null : current,
            }
          );
        if (saved.has(body.commandId)) return saved.get(body.commandId);
        controls.writeCount++;
        const action = u.pathname.includes("/items/")
          ? "create"
          : u.pathname.split("/").at(-1)!;
        if (action === "create") current = { ...initial, kind: body.kind };
        else
          current = {
            ...current!,
            revision: current!.revision + 1,
            state:
              action === "cancel"
                ? "CANCELLED"
                : action === "dispute"
                  ? "DISPUTED"
                  : action === "reject"
                    ? scope === "ADMIN"
                      ? "ADMIN_REJECTED"
                      : "REJECTED"
                    : action === "receive" || current!.kind === "REFUND_ONLY"
                      ? "REFUNDED"
                      : "AWAITING_RETURN",
          };
        const result = {
          commandId: body.commandId,
          outcome: "APPLIED",
          receipt: {
            request: { ...current },
            historyId: "123",
            refund:
              current.state === "REFUNDED"
                ? {
                    id: "456",
                    amount: "100000.00",
                    currency: "VND",
                    mode: "SIMULATED",
                  }
                : null,
          },
        current: { ...current },
        };
        saved.set(body.commandId, result);
        if (controls.gate) await controls.gate;
        if (controls.lost) throw new TypeError("response lost");
        return controls.malformed
          ? { ...result, commandId: crypto.randomUUID() }
          : result;
      }
      if (controls.failReads) throw new ApiError("Read unavailable", 503);
      if (u.pathname.includes("/requests/")) {
        if (!current) throw new ApiError("Missing", 404);
        return {
          request: {
            ...current,
            reasonCode: "DAMAGED",
            description: "Synthetic QA description",
            deadlineAt: iso,
            receivedAt: null,
            restockable: null,
          },
          context,
          history: [
            {
              id: "123",
              actorId: 1,
              fromState: current.revision === 1 ? null : "PENDING",
              toState: current.state,
              fromRevision: current.revision - 1,
              toRevision: current.revision,
              reason: "Synthetic QA history reason",
              createdAt: iso,
            },
          ],
          nextBeforeRevision: null,
          refund:
            current.state === "REFUNDED"
              ? {
                  id: "456",
                  amount: "100000.00",
                  currency: "VND",
                  mode: "SIMULATED",
                  succeededAt: iso,
                }
              : null,
        };
      }
      return {
        items: current ? [{ ...current, context }] : [],
        nextBeforeId: null,
      };
    },
  );
  return { source: aftersaleApi(1, scope, requester), controls, requester };
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  setAccessToken("synthetic-test-token", 1);
  auth.user = {
    id: 1,
    email: "qa@example.invalid",
    role: "USER",
    fullName: "QA",
    isActive: true,
  };
  const purchase = detailFixture(11);
  purchase.status = "DELIVERED";
  purchase.payment = {
    provider: "COD",
    status: "PAID",
    amount: "120000.00",
    currency: "VND",
    paidAt: iso,
  };
  purchase.items = [
    {
      ...purchase.items[0]!,
      id: 31,
      productName: "QA item",
      quantity: 1,
      unitPrice: "100000.00",
      lineTotal: "100000.00",
    },
  ];
  vi.spyOn(orderApi, "detail").mockResolvedValue(purchase);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function view(
  s: ReturnType<typeof server>,
  scope: Scope = "BUYER",
  query = "?orderId=11&itemId=31",
) {
  if (scope !== "BUYER") auth.user!.role = scope;
  return render(
    <MemoryRouter initialEntries={["/aftersales" + query]}>
      <AftersalesPage scope={scope} api={s.source} />
    </MemoryRouter>,
  );
}
async function confirmCreate() {
  const form = await screen.findByRole("region", {
    name: "Tạo yêu cầu hậu mãi",
  });
  await within(form).findByLabelText("Mô tả");
  fireEvent.change(within(form).getByLabelText("Mô tả"), {
    target: { value: "QA hàng đã nhận nhưng có hư hỏng" },
  });
  fireEvent.click(within(form).getByRole("checkbox"));
  return within(form)
    .getByRole("button", { name: "Gửi yêu cầu" })
    .closest("form")!;
}
async function openDecision(action: string) {
  fireEvent.click(
    await screen.findByRole("button", { name: "Xem yêu cầu #21" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: action }));
  const form = screen.getByRole("form", { name: "Xác nhận xử lý hậu mãi" });
  fireEvent.change(within(form).getByLabelText("Lý do quyết định"), {
    target: { value: "QA quyết định sau kiểm tra đầy đủ" },
  });
  return form;
}
describe("Aftersales UI with actual journal and HTTP adapter (mock HTTP, not real PostgreSQL)", () => {
  it("sends create only once for same-tick double-submit and shows verified receipt", async () => {
    const s = server("BUYER");
    view(s);
    const form = await confirmCreate();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(
      await screen.findByText("Đã ghi nhận thao tác cho yêu cầu #21.", {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(s.controls.writeCount).toBe(1);
    expect(loadPending(1)).toBeNull();
  });
  it("recovers a lost response after reload only with explicit consent and the same key", async () => {
    const s = server("BUYER");
    s.controls.lost = true;
    const first = view(s);
    fireEvent.submit(await confirmCreate());
    await screen.findByRole("region", { name: "Khôi phục yêu cầu hậu mãi" });
    await waitFor(() => expect(s.controls.writeCount).toBe(1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Đối chiếu mã cũ" }),
      ).toBeDisabled(),
    );
    const original = loadPending(1)!;
    expect(original.raw).not.toContain("hư hỏng");
    first.unmount();
    view(s);
    const recovery = await screen.findByRole("region", {
      name: "Khôi phục yêu cầu hậu mãi",
    });
    expect(within(recovery).getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(within(recovery).getByRole("checkbox"));
    fireEvent.click(
      within(recovery).getByRole("button", { name: "Đối chiếu mã cũ" }),
    );
    await screen.findByText("Đã ghi nhận thao tác cho yêu cầu #21.", {
      exact: false,
    });
    expect(s.controls.writeCount).toBe(1);
    expect(loadPending(1)).toBeNull();
    const reconciliation = s.requester.mock.calls.find((c) =>
      c[0].endsWith("/reconcile"),
    )!;
    expect(JSON.parse(String(reconciliation[1].body))).toEqual({
      commandId: original.value.commandId,
      requestHash: original.value.requestHash,
    });
  });
  it("does not confuse known success with a failed subsequent GET", async () => {
    const s = server("BUYER");
    view(s);
    const form = await confirmCreate();
    s.controls.failReads = true;
    fireEvent.submit(form);
    await screen.findByText("Đã ghi nhận thao tác cho yêu cầu #21.", {
      exact: false,
    });
    await waitFor(() =>
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0),
    );
    expect(loadPending(1)).toBeNull();
    expect(s.controls.writeCount).toBe(1);
    s.controls.failReads = false;
    fireEvent.click(screen.getByRole("button", { name: "Tải lại chi tiết" }));
    await screen.findByRole("heading", { name: "Yêu cầu #21 · QA item" });
    expect(s.controls.writeCount).toBe(1);
  });
  it("keeps pending when a malformed 200 cannot prove the outcome", async () => {
    const s = server("SELLER", initial);
    s.controls.malformed = true;
    view(s, "SELLER", "");
    const form = await openDecision("Chấp thuận");
    fireEvent.click(within(form).getByRole("checkbox"));
    fireEvent.submit(form);
    await screen.findByRole("region", { name: "Khôi phục yêu cầu hậu mãi" });
    await waitFor(() => expect(loadPending(1)).not.toBeNull());
    expect(s.controls.writeCount).toBe(1);
  });
  it("requires independent create/decision confirmation and reconfirms changed input", async () => {
    const s = server("BUYER", initial);
    view(s);
    await confirmCreate();
    const decision = await openDecision("Rút yêu cầu");
    const createRegion = screen.getByRole("region", {
      name: "Tạo yêu cầu hậu mãi",
    });
    fireEvent.click(within(createRegion).getByRole("checkbox"));
    expect(
      within(decision).getByRole("button", { name: "Xác nhận rút yêu cầu" }),
    ).toBeDisabled();
    fireEvent.click(within(decision).getByRole("checkbox"));
    expect(
      within(createRegion).getByRole("button", { name: "Gửi yêu cầu" }),
    ).toBeDisabled();
    fireEvent.change(within(decision).getByLabelText("Lý do quyết định"), {
      target: { value: "QA lý do mới phải xác nhận lại" },
    });
    expect(within(decision).getByRole("checkbox")).not.toBeChecked();
    expect(s.controls.writeCount).toBe(0);
  });
  it("requires an explicit restock choice and sends boolean false for non-restockable goods", async () => {
    const s = server("SELLER", {
      ...initial,
      kind: "RETURN_AND_REFUND",
      state: "AWAITING_RETURN",
      revision: 2,
    });
    view(s, "SELLER", "");
    const form = await openDecision("Xác nhận đã nhận lại hàng");
    fireEvent.change(within(form).getByLabelText("Khả năng nhập lại kho"), {
      target: { value: "no" },
    });
    fireEvent.click(within(form).getByRole("checkbox"));
    fireEvent.submit(form);
    await screen.findByText("Đã ghi nhận thao tác cho yêu cầu #21.", {
      exact: false,
    });
    const write = s.requester.mock.calls.find((c) =>
      c[0].endsWith("/receive"),
    )!;
    expect(JSON.parse(String(write[1].body)).restockable).toBe(false);
    expect(s.controls.writeCount).toBe(1);
  });
  it("keeps the original actor intent after an account switch while a write is pending", async () => {
    const s = server("BUYER");
    let release!: () => void;
    s.controls.gate = new Promise<void>((done) => {
      release = done;
    });
    const v = view(s);
    fireEvent.submit(await confirmCreate());
    await waitFor(() => expect(s.controls.writeCount).toBe(1));
    auth.user = null;
    setAccessToken(null);
    v.rerender(
      <MemoryRouter>
        <AftersalesPage scope="BUYER" api={s.source} />
      </MemoryRouter>,
    );
    await act(async () => release());
    expect(screen.getByRole("alert")).toHaveTextContent("không có quyền");
    expect(loadPending(1)).not.toBeNull();
  });
  it("blocks mutations for corrupt durable metadata while leaving read-only views available", async () => {
    sessionStorage.setItem("aftersale-pending:v1:1", "{broken");
    const s = server("BUYER");
    view(s);
    await screen.findByText("Dữ liệu yêu cầu hậu mãi không hợp lệ;", {
      exact: false,
    });
    const form = await screen.findByRole("region", {
      name: "Tạo yêu cầu hậu mãi",
    });
    await within(form).findByLabelText("Mô tả");
    expect(
      within(form).getByRole("button", { name: "Gửi yêu cầu" }),
    ).toBeDisabled();
    expect(s.controls.writeCount).toBe(0);
  });
  it("retains explicit recovery when new transactions are disabled by the operational flag", async () => {
    vi.stubEnv("VITE_AFTERSALES_ENABLED", "false");
    await prepareIntent(1, "BUYER", "create", 31, {
      kind: "REFUND_ONLY",
      reasonCode: "DAMAGED",
      description: "Synthetic QA reason for recovery",
    });
    const s = server("BUYER");
    view(s);
    const recovery = await screen.findByRole("region", {
      name: "Khôi phục yêu cầu hậu mãi",
    });
    fireEvent.click(within(recovery).getByRole("checkbox"));
    fireEvent.click(
      within(recovery).getByRole("button", { name: "Đối chiếu mã cũ" }),
    );
    await screen.findByText("Server đã đóng mã chưa thực hiện.", {
      exact: false,
    });
    expect(loadPending(1)).toBeNull();
    expect(s.controls.writeCount).toBe(0);
    expect(screen.getByRole("button", { name: "Gửi yêu cầu" })).toBeDisabled();
  });
  it("does not restore private order data from a late read after permission denial", async () => {
    let release!: (v: Awaited<ReturnType<typeof orderApi.detail>>) => void;
    vi.mocked(orderApi.detail).mockReturnValueOnce(
      new Promise((done) => {
        release = done;
      }),
    );
    const s = server("BUYER");
    vi.spyOn(s.source, "list").mockRejectedValueOnce(
      new ApiError("Denied", 403),
    );
    view(s);
    await screen.findByText("Phiên hoặc quyền xử lý đã thay đổi.", {
      exact: false,
    });
    const old = detailFixture(11);
    old.orderNumber = "PRIVATE-LATE-ORDER";
    await act(async () => release(old));
    expect(
      screen.queryByText("PRIVATE-LATE-ORDER", { exact: false }),
    ).not.toBeInTheDocument();
  });
});
