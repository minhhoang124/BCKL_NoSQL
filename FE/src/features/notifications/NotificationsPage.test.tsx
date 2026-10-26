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
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAccessToken } from "../../services/apiClient";
import * as client from "./notificationClient";
import { NotificationsPage, NotificationBadge } from "./NotificationsPage";
const auth = vi.hoisted(() => ({
  user: { id: 1, role: "USER", isActive: true },
}));
vi.mock("../../contexts/useAuth", () => ({
  useAuth: () => ({ user: auth.user, loading: false }),
}));
const stamp = "2026-10-27T00:00:00.000Z";
const item = (id: string, title = "Đơn của tài khoản một") => ({
  id,
  title,
  text: "Nội dung an toàn",
  link: "/account/orders/12",
  eventAt: stamp,
  createdAt: stamp,
  readAt: null,
});
const page = (id = "10") => ({
  items: [item(id)],
  nextBeforeId: null,
  unreadCount: 3,
  throughId: "99",
  syncPending: false,
});
const ui = () => (
  <MemoryRouter>
    <NotificationsPage />
  </MemoryRouter>
);
beforeEach(() => {
  auth.user = { id: 1, role: "USER", isActive: true };
  setAccessToken("one");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function setup() {
  const api = {
    list: vi.fn().mockResolvedValue(page()),
    read: vi.fn().mockResolvedValue({ id: "10", readAt: stamp }),
    readAll: vi.fn().mockResolvedValue({ throughId: "10", changed: 1 }),
  };
  vi.spyOn(client, "createNotificationApi").mockReturnValue(api);
  return api;
}
it("loads inbox in StrictMode without stale aborted load overwriting it", async () => {
  setup();
  render(<StrictMode>{ui()}</StrictMode>);
  expect(await screen.findByText("Đơn của tài khoản một")).toBeVisible();
});
it("read-all uses displayed head rather than newer server head metadata", async () => {
  const api = setup();
  render(ui());
  await screen.findByText("Đơn của tài khoản một");
  fireEvent.click(screen.getByText("Đánh dấu đến mốc đang hiển thị đã đọc"));
  await waitFor(() =>
    expect(api.readAll).toHaveBeenCalledWith("10", expect.any(AbortSignal)),
  );
});
it("blocks same-tick duplicate mark clicks", async () => {
  const api = setup();
  let resolve!: () => void;
  api.read.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = () => r({ id: "10", readAt: stamp });
      }),
  );
  render(ui());
  await screen.findByText("Đơn của tài khoản một");
  const button = screen.getByText("Đánh dấu đã đọc");
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(api.read).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
});
it("keeps known read success when refresh fails and reload only GETs", async () => {
  const api = setup();
  api.list
    .mockResolvedValueOnce(page())
    .mockRejectedValueOnce(new Error("read failed"))
    .mockResolvedValue(page());
  render(ui());
  await screen.findByText("Đơn của tài khoản một");
  fireEvent.click(screen.getByText("Đánh dấu đã đọc"));
  expect(await screen.findByText("Đã đánh dấu đã đọc.")).toBeVisible();
  expect(await screen.findByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByText("Tải lại"));
  await screen.findByText("Đơn của tài khoản một");
  expect(api.read).toHaveBeenCalledTimes(1);
});
it("lost read response does not replay on reload", async () => {
  const api = setup();
  api.read.mockRejectedValue(new Error("lost"));
  render(ui());
  await screen.findByText("Đơn của tài khoản một");
  fireEvent.click(screen.getByText("Đánh dấu đã đọc"));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByText("Tải lại"));
  await screen.findByText("Đơn của tài khoản một");
  expect(api.read).toHaveBeenCalledTimes(1);
});
it("unmounts previous account inbox immediately and ignores delayed response", async () => {
  const api = setup();
  let resolve!: (p: unknown) => void;
  api.list.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(ui());
  auth.user = { id: 2, role: "USER", isActive: true };
  setAccessToken("two");
  api.list.mockResolvedValue({
    ...page("12"),
    items: [item("12", "Đơn của tài khoản hai")],
  });
  view.rerender(ui());
  await screen.findByText("Đơn của tài khoản hai");
  await act(async () => resolve(page()));
  expect(screen.queryByText("Đơn của tài khoản một")).not.toBeInTheDocument();
});
it("does not mark anything merely by opening or reloading inbox", async () => {
  const api = setup();
  const view = render(ui());
  await screen.findByText("Đơn của tài khoản một");
  view.unmount();
  render(ui());
  await screen.findByText("Đơn của tài khoản một");
  expect(api.read).not.toHaveBeenCalled();
  expect(api.readAll).not.toHaveBeenCalled();
});
it("badge stays disabled by default without HTTP requests", () => {
  vi.stubEnv("VITE_NOTIFICATIONS_ENABLED", "false");
  const api = setup();
  render(
    <MemoryRouter>
      <NotificationBadge />
    </MemoryRouter>,
  );
  expect(api.list).not.toHaveBeenCalled();
});
it("badge removes old count on account change", async () => {
  vi.stubEnv("VITE_NOTIFICATIONS_ENABLED", "true");
  const api = setup();
  const view = render(
    <MemoryRouter>
      <NotificationBadge />
    </MemoryRouter>,
  );
  await screen.findByLabelText("Thông báo, 3 chưa đọc");
  api.list.mockRejectedValue(new Error("denied"));
  auth.user = { id: 2, role: "USER", isActive: true };
  setAccessToken("two");
  view.rerender(
    <MemoryRouter>
      <NotificationBadge />
    </MemoryRouter>,
  );
  expect(
    screen.queryByLabelText("Thông báo, 3 chưa đọc"),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("Thông báo")).toBeVisible());
});
