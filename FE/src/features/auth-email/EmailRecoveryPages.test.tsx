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
import * as client from "./emailClient";
import {
  EmailConfirmationPage,
  EmailVerificationSettings,
  ForgotPasswordPage,
} from "./EmailRecoveryPages";
import { setAccessToken } from "../../services/apiClient";
const auth = vi.hoisted(() => ({ user: { id: 1, isActive: true }, loading:false }));
vi.mock("../../contexts/useAuth", () => ({
  useAuth: () => ({ user: auth.user, loading:auth.loading }),
}));
const token = "A".repeat(43);
beforeEach(() => {
  auth.user = { id: 1, isActive: true };
  auth.loading=false;
  setAccessToken("one");
  window.history.replaceState({}, "", "/verify-email#token=" + token);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  sessionStorage.clear();
  localStorage.clear();
});
function setup() {
  const api = {
    status: vi
      .fn()
      .mockResolvedValue({ email: "one@example.invalid", verifiedAt: null }),
    request: vi.fn().mockResolvedValue("Nếu đủ điều kiện sẽ gửi thư."),
    confirm: vi.fn().mockResolvedValue(undefined),
  };
  vi.spyOn(client, "createEmailApi").mockReturnValue(api);
  return api;
}
const ui = (reset = false) => (
  <MemoryRouter>
    <EmailConfirmationPage reset={reset} />
  </MemoryRouter>
);
it('waits for guest bootstrap before capturing API epoch or clearing link',async()=>{
 const api=setup();auth.loading=true;const view=render(ui());expect(window.location.hash).toContain(token);expect(screen.queryByRole('button',{name:'Xác nhận email'})).not.toBeInTheDocument();auth.loading=false;setAccessToken('bootstrapped');view.rerender(ui());await waitFor(()=>expect(window.location.hash).toBe(''));expect(screen.getByRole('button',{name:'Xác nhận email'})).toBeDisabled();expect(api.confirm).not.toHaveBeenCalled();
});
it("strips token from URL, retains StrictMode flow but never POSTs on mount", () => {
  const api = setup();
  render(<StrictMode>{ui()}</StrictMode>);
  expect(window.location.hash).toBe("");
  expect(api.confirm).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Xác nhận email" })).toBeDisabled();
  expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain(
    token,
  );
});
it('clearly labels local sandbox mail without claiming Gmail delivery',()=>{
 vi.stubEnv('VITE_AUTH_EMAIL_SANDBOX','true');setup();render(ui());expect(screen.getByRole('note')).toHaveTextContent('không gửi tới Gmail');
});
it("same-tick confirmation sends once, with explicit consent", async () => {
  const api = setup();
  let resolve!: () => void;
  api.confirm.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = () => r(undefined);
      }),
  );
  render(ui());
  fireEvent.click(screen.getByRole("checkbox"));
  const button = screen.getByRole("button", { name: "Xác nhận email" });
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(api.confirm).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  expect(
    await screen.findByText(/Email trong liên kết đã được xác minh/),
  ).toBeVisible();
});
it("uncertain response keeps form locked and reload never auto-confirms", async () => {
  const api = setup();
  api.confirm.mockRejectedValue(new Error("lost"));
  const view = render(ui());
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Xác nhận email" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Xác nhận email" })).toBeDisabled();
  view.unmount();
  render(ui());
  expect(screen.getByRole("alert")).toHaveTextContent("Thiếu liên kết");
  expect(api.confirm).toHaveBeenCalledTimes(1);
});
it("reset validates matching passwords before POST and clears them after submit", async () => {
  const api = setup();
  render(ui(true));
  fireEvent.change(screen.getByLabelText("Mật khẩu mới", { exact: true }), {
    target: { value: "new password 123" },
  });
  fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), {
    target: { value: "different password" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Xác nhận đặt lại mật khẩu" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("phải khớp");
  expect(api.confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), {
    target: { value: "new password 123" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Xác nhận đặt lại mật khẩu" }),
  );
  await screen.findByText(/Đã đặt lại mật khẩu/);
  expect(screen.getByLabelText("Mật khẩu mới", { exact: true })).toHaveValue(
    "",
  );
});
it("forgot form sends user email only and does not claim account exists", async () => {
  const api = setup();
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Email đăng nhập"), {
    target: { value: "synthetic@example.invalid" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Yêu cầu liên kết đặt lại" }),
  );
  await screen.findByRole("status");
  expect(api.request).toHaveBeenCalledWith(
    "synthetic@example.invalid",
    expect.any(AbortSignal),
  );
  expect(api.confirm).not.toHaveBeenCalled();
});
it("verification settings hide prior account data on switching session", async () => {
  const api = setup();
  const view = render(
    <MemoryRouter>
      <EmailVerificationSettings />
    </MemoryRouter>,
  );
  await screen.findByText(/one@example.invalid/);
  auth.user = { id: 2, isActive: true };
  setAccessToken("two");
  api.status.mockRejectedValue(new Error("denied"));
  view.rerender(
    <MemoryRouter>
      <EmailVerificationSettings />
    </MemoryRouter>,
  );
  expect(screen.queryByText(/one@example.invalid/)).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Không tải được"),
  );
});
