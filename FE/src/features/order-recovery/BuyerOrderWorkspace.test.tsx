// @vitest-environment jsdom
// Production router + actual runtime/journal/validators. HTTP mocked; Chrome/DB separate.
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextType } from "../../contexts/useAuth";
import { AppRouter } from "../../routes/AppRouter";
import {
  getAuthSessionVersion,
  setAccessToken,
} from "../../services/apiClient";
import { buyer, deferred } from "../order-readiness/testFixtures";
import { createBuyerIntentJournal } from "./buyerIntentJournal";
import {
  buyerReceipt,
  commandOrder,
  finalOrder,
  json,
  reason,
  slot,
  time,
} from "./buyerWorkflow.testFixtures";

let auth: AuthContextType, transport: ReturnType<typeof vi.fn>;
let order = commandOrder();
let failRead = false,
  committed = false;
const writes = () =>
  transport.mock.calls.filter(([, init]) => init.method === "POST");
function Navigation() {
  const go = useNavigate();
  return (
    <button onClick={() => go("/account/orders/102")}>
      Navigate other order
    </button>
  );
}
function tree(path = "/account/orders/101") {
  return (
    <StrictMode>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <AppRouter />
          <Navigation />
        </MemoryRouter>
      </AuthContext.Provider>
    </StrictMode>
  );
}
async function choose(command: "cancel" | "complete" = "cancel") {
  fireEvent.click(
    await screen.findByRole("button", {
      name: command === "cancel" ? "Hủy đơn" : "Xác nhận đã nhận hàng",
    }),
  );
}
function consent(command: "cancel" | "complete" = "cancel") {
  if (command === "cancel") {
    fireEvent.change(screen.getByLabelText("Lý do hủy"), {
      target: { value: "OTHER" },
    });
    fireEvent.change(screen.getByLabelText("Mô tả lý do hủy"), {
      target: { value: reason.reasonText },
    });
  }
  fireEvent.click(screen.getByRole("checkbox"));
}
const submit = (command: "cancel" | "complete" = "cancel") =>
  screen.getByRole("button", {
    name: command === "cancel" ? "Xác nhận hủy đơn" : "Xác nhận hoàn tất đơn",
  });
async function seed(command: "cancel" | "complete" = "cancel", orderId = 101) {
  return createBuyerIntentJournal({
    getStorage: () => sessionStorage,
    getSession: () => ({
      actor: { id: buyer.id, role: "USER" },
      version: getAuthSessionVersion(),
      isActive: true,
    }),
  }).prepareNew({
    orderId,
    command,
    body: command === "cancel" ? reason : {},
    confirmed: true,
  });
}
beforeEach(() => {
  vi.stubEnv("VITE_BUYER_ORDER_COMMANDS_ENABLED", "true");
  sessionStorage.clear();
  setAccessToken("test-only", buyer.id);
  auth = {
    user: buyer,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
  order = commandOrder();
  committed = false;
  failRead = false;
  transport = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === "POST") {
      const command = url.endsWith("/complete") ? "complete" : "cancel";
      committed = true;
      order = finalOrder(command);
      return json(buyerReceipt(command));
    }
    if (committed && failRead) throw Error("GET offline");
    return json(order);
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => {
  cleanup();
  setAccessToken(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Buyer production Order detail workspace", () => {
  it("GET only on StrictMode mount, confirmation can be dismissed, one POST for double submit", async () => {
    render(tree());
    await choose();
    expect(writes()).toHaveLength(0);
    expect(submit()).toBeDisabled();
    expect(screen.queryByText(/BẢN CHUẨN BỊ/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại, chưa gửi" }));
    await choose();
    consent();
    const button = submit();
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText(
      "Đã xác minh biên nhận và tải lại đơn. Không cần gửi lại lệnh.",
    );
    expect(writes()).toHaveLength(1);
    expect(sessionStorage.getItem(slot)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Hủy đơn" }),
    ).not.toBeInTheDocument();
  });
  it("complete requires actual receipt and separate received-goods consent", async () => {
    order = commandOrder("complete");
    render(tree());
    await choose("complete");
    expect(submit("complete")).toBeDisabled();
    consent("complete");
    fireEvent.click(submit("complete"));
    await screen.findByText(
      "Đã xác minh biên nhận và tải lại đơn. Không cần gửi lại lệnh.",
    );
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1].body).toBe("{}");
  });
  it("editing cancellation reason discards the old consent; Enter does not auto-send", async () => {
    render(tree());
    await choose();
    consent();
    fireEvent.change(screen.getByLabelText("Mô tả lý do hủy"), {
      target: { value: "Nội dung mới" },
    });
    expect(submit()).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("Mô tả lý do hủy"), {
      key: "Enter",
    });
    expect(writes()).toHaveLength(0);
  });
  it("lost committed response survives real storage-backed remount and resolves only after consent", async () => {
    transport.mockImplementation(async (url, init) => {
      if (url.endsWith("/resolve-command"))
        return json({
          outcome: "COMMITTED",
          receipt: buyerReceipt("cancel", true),
        });
      if (init.method === "POST") {
        order = finalOrder();
        throw Error("lost response");
      }
      return json(order);
    });
    const view = render(tree());
    await choose();
    consent();
    fireEvent.click(submit());
    const button = await screen.findByRole("button", {
      name: "Đối chiếu / dừng yêu cầu cũ",
    });
    expect(button).toBeDisabled();
    const raw = sessionStorage.getItem(slot)!;
    expect(raw).not.toContain(reason.reasonText);
    view.unmount();
    render(tree());
    const resolve = await screen.findByRole("button", {
      name: "Đối chiếu / dừng yêu cầu cũ",
    });
    expect(writes()).toHaveLength(1);
    expect(sessionStorage.getItem(slot)).toBe(raw);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(resolve);
    await screen.findByText(
      "Đã xác minh biên nhận và tải lại đơn. Không cần gửi lại lệnh.",
    );
    expect(writes()).toHaveLength(2);
    expect(writes()[1][1].headers.get("Idempotency-Key")).toBe(
      JSON.parse(raw).idempotencyKey,
    );
  });
  it.each(["cancel", "complete"] as const)(
    "known %s receipt + GET failure exposes GET-only retry",
    async (command) => {
      order = commandOrder(command);
      failRead = true;
      render(tree());
      await choose(command);
      consent(command);
      fireEvent.click(submit(command));
      const reload = await screen.findByRole("button", { name: "Tải lại đơn" });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Đã xác minh biên nhận.",
      );
      expect(sessionStorage.getItem(slot)).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Hủy đơn" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Xác nhận đã nhận hàng" }),
      ).not.toBeInTheDocument();
      failRead = false;
      fireEvent.click(reload);
      await screen.findByText(
        "Đã xác minh biên nhận và tải lại đơn. Không cần gửi lại lệnh.",
      );
      expect(writes()).toHaveLength(1);
    },
  );
  it("CLOSED does not mean cancellation and allows a separately confirmed fresh attempt", async () => {
    const old = await seed();
    transport.mockImplementation(async (url, init) => {
      if (url.endsWith("/resolve-command"))
        return json({
          outcome: "CLOSED_WITHOUT_EXECUTION",
          resolutionId: 8,
          orderId: 101,
          command: "cancel",
          resolvedAt: time,
        });
      if (init.method === "POST") {
        order = finalOrder();
        return json(buyerReceipt());
      }
      return json(order);
    });
    render(tree());
    const button = await screen.findByRole("button", {
      name: "Đối chiếu / dừng yêu cầu cũ",
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(button);
    await screen.findByText(
      "Đã đóng mã yêu cầu chưa thực hiện và tải lại đơn. Đóng mã không phải hủy hoặc hoàn tất đơn.",
    );
    await choose();
    consent();
    fireEvent.click(submit());
    await screen.findByText(
      "Đã xác minh biên nhận và tải lại đơn. Không cần gửi lại lệnh.",
    );
    expect(writes()).toHaveLength(2);
    expect(writes()[1][1].headers.get("Idempotency-Key")).not.toBe(
      old.idempotencyKey,
    );
  });
  it("pending other Order shows a link, not an execute or wrong-order resolver", async () => {
    await seed("cancel", 102);
    render(tree());
    const link = await screen.findByRole("link", { name: "Đối chiếu đơn 102" });
    expect(link).toHaveAttribute("href", "/account/orders/102");
    expect(writes()).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Hủy đơn" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Đối chiếu / dừng yêu cầu cũ" }),
    ).not.toBeInTheDocument();
  });
  it("legacy V1 complete uses explicit recovery consent, not automatic migration", async () => {
    const legacy = {
      schemaVersion: 1,
      actorId: 7,
      role: "USER",
      orderId: 101,
      command: "complete",
      idempotencyKey: "legacy-buyer-key-12345",
      createdAt: time,
    };
    sessionStorage.setItem(slot, JSON.stringify(legacy));
    order = commandOrder("complete");
    transport.mockImplementation(async (url) =>
      url.endsWith("/resolve-command")
        ? json({
            outcome: "CLOSED_WITHOUT_EXECUTION",
            resolutionId: 8,
            orderId: 101,
            command: "complete",
            resolvedAt: time,
          })
        : json(order),
    );
    render(tree());
    const button = await screen.findByRole("button", {
      name: "Đối chiếu / dừng yêu cầu cũ",
    });
    expect(button).toBeDisabled();
    expect(sessionStorage.getItem(slot)).toBe(JSON.stringify(legacy));
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(button);
    await screen.findByText(
      "Đã đóng mã yêu cầu chưa thực hiện và tải lại đơn. Đóng mã không phải hủy hoặc hoàn tất đơn.",
    );
    expect(writes()).toHaveLength(1);
  });
  it("storage failure blocks before sending, without exposing the reason in a raw error", async () => {
    render(tree());
    await choose();
    consent();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error("secret internal");
    });
    fireEvent.click(submit());
    await screen.findByText(/Không thể xác minh phiên hoặc bộ nhớ yêu cầu/);
    expect(writes()).toHaveLength(0);
    expect(screen.queryByText("secret internal")).not.toBeInTheDocument();
  });
  it("account switch during held receipt never updates the new Buyer or deletes old pending", async () => {
    const held = deferred<Response>();
    transport.mockImplementation(async (_url, init) =>
      init.method === "POST" ? held.promise : json(order),
    );
    const view = render(tree());
    await choose();
    consent();
    fireEvent.click(submit());
    await waitFor(() => expect(writes()).toHaveLength(1));
    const raw = sessionStorage.getItem(slot);
    auth = { ...auth, user: { ...buyer, id: 8 } };
    setAccessToken("other-test-only", 8);
    transport.mockImplementation(async () =>
      json({ message: "not found" }, 404),
    );
    view.rerender(tree());
    await act(async () => {
      held.resolve(json(buyerReceipt()));
    });
    await screen.findByText(
      /Chưa tải được đơn hoặc bạn không có quyền truy cập/,
    );
    expect(
      screen.queryByRole("region", { name: "Chi tiết đơn hàng" }),
    ).not.toBeInTheDocument();
    expect(sessionStorage.getItem(slot)).toBe(raw);
  });
  it("navigation during HTTP leaves original pending for its own order", async () => {
    const held = deferred<Response>();
    transport.mockImplementation(async (url, init) =>
      init.method === "POST"
        ? held.promise
        : json(commandOrder("cancel", url.endsWith("/102") ? 102 : 101)),
    );
    render(tree());
    await choose();
    consent();
    fireEvent.click(submit());
    await waitFor(() => expect(writes()).toHaveLength(1));
    fireEvent.click(
      screen.getByRole("button", { name: "Navigate other order" }),
    );
    await act(async () => {
      held.resolve(json(buyerReceipt()));
    });
    expect(
      await screen.findByRole("link", { name: "Đối chiếu đơn 101" }),
    ).toHaveAttribute("href", "/account/orders/101");
    expect(sessionStorage.getItem(slot)).not.toBeNull();
  });
  it("invalid Order path makes no GET or POST", () => {
    render(tree("/account/orders/01"));
    expect(screen.getByText("Mã đơn hàng không hợp lệ.")).toBeInTheDocument();
    expect(transport).not.toHaveBeenCalled();
  });
});
