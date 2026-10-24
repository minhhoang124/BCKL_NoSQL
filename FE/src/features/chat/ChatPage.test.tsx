// @vitest-environment jsdom
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
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "./ChatPage";
import { chatApi, type Message } from "./chatApi";
import { ApiError, setAccessToken } from "../../services/apiClient";
import { loadPending } from "./chatPending";
vi.mock("../../contexts/useAuth", () => ({
  useAuth: () => ({ user: { id: 2, role: "USER", isActive: true } }),
}));
vi.mock("socket.io-client", () => ({
  io: () => {
    const handlers = new Map<string, () => void>();
    return {
      on: (name: string, cb: () => void) => handlers.set(name, cb),
      connect: () => handlers.get("chat:ready")?.(),
      disconnect: vi.fn(),
      removeAllListeners: () => handlers.clear(),
      timeout: () => ({
        emit: (
          _name: string,
          _body: unknown,
          cb: (error: null, result: unknown) => void,
        ) => cb(null, { ok: true }),
      }),
    };
  },
}));
const message: Message = {
  id: 10,
  conversationId: 7,
  sequence: 1,
  senderId: 2,
  senderType: "BUYER",
  content: "Hello",
  createdAt: "2026-10-24T00:00:00.000Z",
};
const page = (items: Message[] = []) => ({
  items,
  highWatermark: items.at(-1)?.sequence ?? 0,
  hasMore: false,
  nextBeforeSequence: null,
  nextAfterSequence: null,
});
function view(entry = "/messages/7") {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/messages/:conversationId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}
beforeEach(() => {
  sessionStorage.clear();
  setAccessToken("qa-only", 2);
  vi.spyOn(chatApi, "inbox").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(chatApi, "history").mockResolvedValue(page());
  vi.spyOn(chatApi, "read").mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  sessionStorage.clear();
});
describe("Chat UI session/unknown outcome boundaries", () => {
  it("shares only on explicit consent, keeps typed text and blocks duplicate context clicks", async () => {
    vi.stubEnv("VITE_CHAT_PRODUCT_CONTEXT_ENABLED", "true");
    const send = vi
      .spyOn(chatApi, "send")
      .mockResolvedValue({
        ...message,
        content: "Đã chia sẻ sản phẩm",
        productContext: { productId: 8, storeId: 4 },
      });
    view("/messages/7?productId=8");
    const button = await screen.findByRole("button", {
      name: "Chia sẻ sản phẩm #8",
    });
    await waitFor(() => expect(button).toBeEnabled());
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nội dung tin nhắn"), {
      target: { value: "Keep my draft" },
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Đã chia sẻ sản phẩm #8" }),
      ).toBeDisabled(),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Nội dung tin nhắn")).toHaveValue(
      "Keep my draft",
    );
  });
  it("loads in StrictMode, renders hostile text safely and does not mark read merely by opening", async () => {
    vi.mocked(chatApi.history).mockResolvedValue(
      page([{ ...message, content: "<img src=x onerror=alert(1)>" }]),
    );
    const result = view();
    await screen.findByText("<img src=x onerror=alert(1)>");
    expect(result.container.querySelector("img")).toBeNull();
    expect(chatApi.read).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Đánh dấu đã đọc các tin đã hiển thị",
      }),
    );
    await waitFor(() => expect(chatApi.read).toHaveBeenCalledTimes(1));
  });
  it("stores key before send and double submission causes one HTTP call", async () => {
    let resolve!: (message: Message) => void;
    const send = vi.spyOn(chatApi, "send").mockImplementation(() => {
      expect(loadPending(2)?.value.content).toBe("Hello");
      return new Promise((done) => {
        resolve = done;
      });
    });
    view();
    await screen.findByText("Chưa có tin nhắn. Bạn có thể bắt đầu trao đổi.");
    fireEvent.change(screen.getByLabelText("Nội dung tin nhắn"), {
      target: { value: "Hello" },
    });
    const form = screen.getByLabelText("Nội dung tin nhắn").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => resolve(message));
    await waitFor(() => expect(loadPending(2)).toBeNull());
  });
  it("keeps pending after loss, reloads it without auto-send and retries the exact key/body", async () => {
    const send = vi
      .spyOn(chatApi, "send")
      .mockRejectedValueOnce(Error("Response lost"))
      .mockResolvedValue(message);
    const first = view();
    await screen.findByText("Chưa có tin nhắn. Bạn có thể bắt đầu trao đổi.");
    fireEvent.change(screen.getByLabelText("Nội dung tin nhắn"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi tin nhắn" }));
    await screen.findByText("Response lost");
    const saved = loadPending(2)!;
    first.unmount();
    view();
    await screen.findByRole("button", { name: "Gửi lại cùng mã" });
    expect(send).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Gửi lại cùng mã" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Gửi lại cùng mã" }));
    await waitFor(() =>
      expect(send).toHaveBeenLastCalledWith(
        7,
        2,
        saved.value.clientMessageId,
        saved.value.content,
      ),
    );
    await waitFor(() => expect(loadPending(2)).toBeNull());
  });
  it("does not acknowledge an old session response after account/session changes", async () => {
    let resolve!: (message: Message) => void;
    vi.spyOn(chatApi, "send").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    view();
    await screen.findByText("Chưa có tin nhắn. Bạn có thể bắt đầu trao đổi.");
    fireEvent.change(screen.getByLabelText("Nội dung tin nhắn"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi tin nhắn" }));
    const saved = loadPending(2);
    setAccessToken("different-session", 99);
    await act(async () => resolve(message));
    expect(loadPending(2)).toEqual(saved);
  });
  it("silently failing browser storage prevents network send", async () => {
    const send = vi.spyOn(chatApi, "send").mockResolvedValue(message);
    view();
    await screen.findByText("Chưa có tin nhắn. Bạn có thể bắt đầu trao đổi.");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    fireEvent.change(screen.getByLabelText("Nội dung tin nhắn"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi tin nhắn" }));
    await screen.findByText("Không lưu được mã gửi, chưa gửi tin.");
    expect(send).not.toHaveBeenCalled();
  });
  it("a known receipt followed by failed history fetch does not re-send the command", async () => {
    const send = vi.spyOn(chatApi, "send").mockResolvedValue(message);
    view();
    await screen.findByText("Chưa có tin nhắn. Bạn có thể bắt đầu trao đổi.");
    vi.mocked(chatApi.history).mockRejectedValue(Error("History unavailable"));
    fireEvent.change(screen.getByLabelText("Nội dung tin nhắn"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi tin nhắn" }));
    await screen.findByText("History unavailable");
    expect(loadPending(2)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại tin nhắn" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });
  it("clears rendered history on revoked membership instead of showing private stale content", async () => {
    vi.mocked(chatApi.history).mockResolvedValue(page([message]));
    view();
    await screen.findByText("Hello");
    vi.mocked(chatApi.history).mockRejectedValue(
      new ApiError("No access", 403),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tải lại tin nhắn" }));
    await screen.findByText("No access");
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gửi tin nhắn" })).toBeDisabled();
  });
});
