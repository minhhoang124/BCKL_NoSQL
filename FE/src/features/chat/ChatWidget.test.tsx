// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWidget } from "./ChatWidget";
import { chatApi, type InboxItem, type Message } from "./chatApi";
import { setAccessToken } from "../../services/apiClient";

const auth = vi.hoisted(() => ({
  user: { id: 2, role: "USER", isActive: true } as { id: number; role: string; isActive: boolean } | null,
}));
vi.mock("../../contexts/useAuth", () => ({ useAuth: () => auth }));
const sockets = vi.hoisted(() => ({ opened: 0, closed: 0 }));
vi.mock("socket.io-client", () => ({
  io: () => {
    sockets.opened++;
    const handlers = new Map<string, () => void>();
    return {
      on: (name: string, cb: () => void) => handlers.set(name, cb),
      connect: () => handlers.get("chat:ready")?.(),
      disconnect: () => {
        sockets.closed++;
      },
      removeAllListeners: () => handlers.clear(),
      timeout: () => ({
        emit: (_n: string, _b: unknown, cb: (e: null, r: unknown) => void) => cb(null, { ok: true }),
      }),
    };
  },
}));

const last: Message = {
  id: 10,
  conversationId: 7,
  sequence: 3,
  senderId: 9,
  senderType: "SELLER",
  content: "Shop đã nhận đơn",
  createdAt: "2026-10-31T00:00:00.000Z",
};
const row = (id: number, name: string, unread: number): InboxItem => ({
  id,
  context: "BUYER",
  store: { id: 100 + id, name },
  buyer: { id: 2, fullName: "Buyer" },
  lastSequence: 3,
  lastMessageAt: last.createdAt,
  lastMessage: { ...last, conversationId: id },
  lastReadSequence: 3 - unread,
  unreadCount: unread,
});
const view = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ChatWidget />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.stubEnv("VITE_CHAT_ENABLED", "true");
  auth.user = { id: 2, role: "USER", isActive: true };
  sockets.opened = 0;
  sockets.closed = 0;
  sessionStorage.clear();
  setAccessToken("qa-only", 2);
  vi.spyOn(chatApi, "history").mockResolvedValue({
    items: [],
    highWatermark: 0,
    hasMore: false,
    nextBeforeSequence: null,
    nextAfterSequence: null,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("ChatWidget visibility", () => {
  it.each([
    ["chat disabled", () => vi.stubEnv("VITE_CHAT_ENABLED", "false"), "/"],
    ["signed out", () => (auth.user = null), "/"],
    ["admin", () => (auth.user = { id: 1, role: "ADMIN", isActive: true }), "/"],
    ["on the Messages page (avoids a second socket)", () => undefined, "/messages/7"],
  ])("is not rendered when %s", (_name, arrange, path) => {
    const inbox = vi.spyOn(chatApi, "inbox").mockResolvedValue({ items: [], nextCursor: null });
    arrange();
    view(path);
    expect(screen.queryByRole("button", { name: /Tin nhắn/ })).not.toBeInTheDocument();
    expect(inbox).not.toHaveBeenCalled();
  });
});

describe("ChatWidget behaviour", () => {
  it("shows the unread total, lists conversations by store name and opens one thread with a single socket", async () => {
    vi.spyOn(chatApi, "inbox").mockResolvedValue({
      items: [row(7, "Cửa hàng A", 2), row(8, "Cửa hàng B", 1)],
      nextCursor: null,
    });
    view();
    expect(await screen.findByLabelText("3 tin chưa đọc")).toBeInTheDocument();
    expect(sockets.opened).toBe(0); // the inbox list itself never opens a socket
    fireEvent.click(screen.getByRole("button", { name: /Tin nhắn/ }));
    const dialog = screen.getByRole("dialog", { name: "Tin nhắn nhanh" });
    expect(dialog).toHaveTextContent("Cửa hàng A");
    expect(dialog).toHaveTextContent("Shop đã nhận đơn");
    fireEvent.click(screen.getByRole("button", { name: /Cửa hàng A/ }));
    await screen.findByText("Chưa có tin nhắn. Bạn có thể bắt đầu trao đổi.");
    expect(sockets.opened).toBe(1);
    // Never auto-marks read: reading needs the explicit displayed-messages action.
    expect(screen.getByRole("button", { name: "Đánh dấu đã đọc các tin đã hiển thị" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại danh sách hội thoại" }));
    await waitFor(() => expect(sockets.closed).toBe(1));
  });

  it("minimizes with Escape and returns focus to the toggle", async () => {
    vi.spyOn(chatApi, "inbox").mockResolvedValue({ items: [], nextCursor: null });
    view();
    const toggle = screen.getByRole("button", { name: /Tin nhắn/ });
    fireEvent.click(toggle);
    expect(await screen.findByText(/Chưa có hội thoại/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("drops the previous account's conversations and late responses after an account switch", async () => {
    let resolveOld!: (v: { items: InboxItem[]; nextCursor: null }) => void;
    const inbox = vi
      .spyOn(chatApi, "inbox")
      .mockReturnValueOnce(new Promise((done) => (resolveOld = done)))
      .mockResolvedValueOnce({ items: [row(9, "Cửa hàng của người khác", 0)], nextCursor: null });
    const ui = view();
    await waitFor(() => expect(inbox).toHaveBeenCalledTimes(1));
    auth.user = { id: 3, role: "USER", isActive: true };
    setAccessToken("qa-only-2", 3);
    ui.rerender(
      <MemoryRouter initialEntries={["/"]}>
        <ChatWidget />
      </MemoryRouter>,
    );
    await waitFor(() => expect(inbox).toHaveBeenCalledTimes(2));
    await act(async () => resolveOld({ items: [row(7, "Cửa hàng cũ", 5)], nextCursor: null }));
    fireEvent.click(screen.getByRole("button", { name: /Tin nhắn/ }));
    expect(await screen.findByText("Cửa hàng của người khác")).toBeInTheDocument();
    expect(screen.queryByText("Cửa hàng cũ")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("5 tin chưa đọc")).not.toBeInTheDocument();
  });
});
