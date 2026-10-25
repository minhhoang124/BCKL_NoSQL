// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// @ts-expect-error Vitest-only Node WebCrypto; browser tsconfig intentionally excludes Node globals.
import { webcrypto } from "node:crypto";
import { ApiError, setAccessToken } from "../../services/apiClient";
import { AccountStatusDialog } from "./AdminAccountStatusWorkspace";
import {
  loadStatusPending,
  prepareStatusPending,
} from "./accountStatusPending";
import type {
  AccountStatusApi,
  StatusHistory,
  StatusReceipt,
  StatusIntent,
  StatusResolution,
} from "./accountStatusApi";

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  setAccessToken("qa-admin", 1);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const reason = "QA explicit account status decision";
const first = (): StatusHistory => ({
  account: { id: 2, isActive: true, statusRevision: 1 },
  items: [],
  nextBeforeRevision: null,
});
const receipt: StatusReceipt = {
  account: { id: 2, isActive: false, statusRevision: 2 },
  auditId: "1",
  searchReconciliation: null,
};
function fakeApi() {
  let page = first();
  const api = {
    status: vi.fn(async () => page.account),
    history: vi.fn(async () => page),
    write: vi.fn(async () => {
      page = { ...first(), account: receipt.account };
      return receipt;
    }),
    reconcile: vi.fn(
      async (intent: StatusIntent): Promise<StatusResolution> => ({
        commandId: intent.commandId,
        outcome: "APPLIED",
        current: receipt.account,
        receipt,
      }),
    ),
  } satisfies AccountStatusApi;
  return {
    api,
    setPage: (value: StatusHistory) => {
      page = value;
    },
  };
}
function Controlled({
  api,
  actorId = 1,
}: {
  api: AccountStatusApi;
  actorId?: number;
}) {
  const [, tick] = useState(0);
  return (
    <AccountStatusDialog
      actorId={actorId}
      targetId={2}
      api={api}
      pending={loadStatusPending(actorId)}
      onPendingChange={() => tick((value) => value + 1)}
      onClose={vi.fn()}
    />
  );
}
async function confirm() {
  await screen.findByText("Đang hoạt động", { exact: true });
  fireEvent.change(screen.getByLabelText("Lý do khóa"), {
    target: { value: reason },
  });
  fireEvent.click(screen.getByLabelText("Tôi xác nhận khóa tài khoản #2"));
}
it("StrictMode reload finishes and does not leave the dialog permanently busy", async () => {
  const { api } = fakeApi();
  render(
    <StrictMode>
      <Controlled api={api} />
    </StrictMode>,
  );
  const reload = await screen.findByRole("button", {
    name: "Đọc lại trạng thái và lịch sử",
  });
  await waitFor(() => expect(reload).toBeEnabled());
  fireEvent.click(reload);
  await waitFor(() => expect(reload).toBeEnabled());
  expect(api.write).not.toHaveBeenCalled();
});
it("same-tick duplicate submit persists one ID and sends one write", async () => {
  const { api } = fakeApi();
  render(<Controlled api={api} />);
  await confirm();
  const form = screen
    .getByRole("button", { name: "Khóa tài khoản" })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(api.write).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(loadStatusPending(1)).toBeNull());
  expect(await screen.findByText("Đã khóa", { exact: true })).toBeVisible();
});
it("lost response survives reload; only explicit reconciliation clears journal, without replaying PATCH", async () => {
  const { api, setPage } = fakeApi();
  api.write.mockImplementationOnce(async () => {
    setPage({ ...first(), account: receipt.account });
    throw new Error("QA simulated lost response after commit");
  });
  const mounted = render(<Controlled api={api} />);
  await confirm();
  fireEvent.click(screen.getByRole("button", { name: "Khóa tài khoản" }));
  await screen.findByText(
    "Chưa xác định kết quả. Hãy đối chiếu yêu cầu đang chờ; không gửi lại.",
  );
  const raw = loadStatusPending(1)!.raw;
  expect(raw).not.toContain(reason);
  mounted.unmount();
  render(<Controlled api={api} />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Đối chiếu kết quả" }),
    ).toBeEnabled(),
  );
  expect(api.reconcile).not.toHaveBeenCalled();
  expect(api.write).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Đối chiếu kết quả" }));
  await waitFor(() => expect(loadStatusPending(1)).toBeNull());
  expect(api.write).toHaveBeenCalledTimes(1);
  expect(api.reconcile).toHaveBeenCalledTimes(1);
});
it("closing an undelivered command does not automatically send another write or preserve confirmation", async () => {
  const { api } = fakeApi();
  await prepareStatusPending(1, first().account, false, reason);
  api.reconcile.mockImplementationOnce(async (intent) => ({
    commandId: intent.commandId,
    outcome: "CLOSED",
    current: first().account,
    receipt: null,
  }));
  render(<Controlled api={api} />);
  const resolve = screen.getByRole("button", { name: "Đối chiếu kết quả" });
  await waitFor(() => expect(resolve).toBeEnabled());
  fireEvent.click(resolve);
  await waitFor(() => expect(loadStatusPending(1)).toBeNull());
  expect(api.write).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Khóa tài khoản" })).toBeDisabled();
});
it("write confirmed but history reload fails remains known processed and never automatically resends", async () => {
  const { api } = fakeApi();
  render(<Controlled api={api} />);
  await confirm();
  api.history.mockRejectedValueOnce(new Error("QA read failure"));
  fireEvent.click(screen.getByRole("button", { name: "Khóa tài khoản" }));
  await screen.findByText(
    "Yêu cầu đã được ghi nhận nhưng chưa tải lại được trạng thái. Không gửi lại; hãy đọc lại.",
  );
  expect(loadStatusPending(1)).toBeNull();
  expect(api.write).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Khóa tài khoản" })).toBeNull();
});
it("late response after account switch cannot clear the original actor journal", async () => {
  const { api } = fakeApi();
  let finish!: (value: StatusReceipt) => void;
  api.write.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Controlled api={api} />);
  await confirm();
  fireEvent.click(screen.getByRole("button", { name: "Khóa tài khoản" }));
  await waitFor(() => expect(api.write).toHaveBeenCalledTimes(1));
  const raw = loadStatusPending(1)!.raw;
  setAccessToken("another-admin", 3);
  await act(async () => {
    finish(receipt);
  });
  expect(loadStatusPending(1)?.raw).toBe(raw);
  expect(loadStatusPending(3)).toBeNull();
  expect(screen.queryByText("Đã khóa", { exact: true })).toBeNull();
});
it("a denied read blocks both mutation and reconciliation until a fresh session", async () => {
  const { api } = fakeApi();
  api.history.mockRejectedValue(new ApiError("Forbidden", 403));
  await prepareStatusPending(1, first().account, false, reason);
  render(<Controlled api={api} />);
  await screen.findByText(
    "Phiên hoặc quyền quản trị không còn hợp lệ. Hãy đăng nhập lại.",
  );
  expect(
    screen.getByRole("button", { name: "Đối chiếu kết quả" }),
  ).toBeDisabled();
  expect(api.write).not.toHaveBeenCalled();
  expect(api.reconcile).not.toHaveBeenCalled();
});
it("self-management exposes audit but no self-lock control", async () => {
  const { api } = fakeApi();
  render(<Controlled api={api} actorId={2} />);
  await screen.findByText("Không thể tự khóa tài khoản quản trị đang sử dụng.");
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(api.write).not.toHaveBeenCalled();
});
it("editing the reason resets its specific confirmation", async () => {
  const { api } = fakeApi();
  render(<Controlled api={api} />);
  await confirm();
  expect(screen.getByRole("checkbox")).toBeChecked();
  fireEvent.change(screen.getByLabelText("Lý do khóa"), {
    target: { value: reason + " changed" },
  });
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Khóa tài khoản" })).toBeDisabled();
});
