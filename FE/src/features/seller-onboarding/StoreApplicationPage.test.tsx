// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// @ts-expect-error Node-only fixture; browser app excludes Node ambient types.
import { webcrypto } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchApi, setAccessToken } from "../../services/apiClient";
import {
  createApplicationApi,
  loadPending,
  prepare,
  type ApplicationApi,
  type Scope,
  type View,
} from "./applicationClient";
import { StoreApplicationPage } from "./StoreApplicationPage";
const auth = vi.hoisted(() => ({
  user: {
    id: 1,
    email: "qa@example.invalid",
    fullName: "QA Owner",
    role: "USER",
    isActive: true,
    createdAt: "2026-10-26T00:00:00.000Z",
  },
}));
vi.mock("../../contexts/useAuth", () => ({
  useAuth: () => ({ user: auth.user, loading: false }),
}));
const profile = {
  name: "QA Store",
  description: "Synthetic QA only",
  contactName: "QA Owner",
  contactPhone: "+84901234567",
  pickupAddress: "Synthetic pickup address 01",
  returnAddress: "Synthetic return address 02",
};
const data: View = {
  store: {
    id: 7,
    name: profile.name,
    description: profile.description,
    status: "PENDING",
  },
  ownerId: 1,
  revision: 1,
  profile: {
    contactName: profile.contactName,
    contactPhone: profile.contactPhone,
    pickupAddress: profile.pickupAddress,
    returnAddress: profile.returnAddress,
  },
  grant: null,
  history: [
    {
      id: "1",
      actorId: 1,
      action: "submit",
      fromRevision: 0,
      toRevision: 1,
      fromStatus: null,
      toStatus: "PENDING",
      reason: "QA explicit application reason",
      createdAt: "2026-10-26T00:00:00.000Z",
    },
  ],
  nextBeforeRevision: null,
};
const labels = {
  name: "Tên cửa hàng",
  description: "Mô tả cửa hàng",
  contactName: "Người liên hệ",
  contactPhone: "Số điện thoại liên hệ",
  pickupAddress: "Địa chỉ lấy hàng",
  returnAddress: "Địa chỉ nhận hàng trả",
};
const reason = "QA explicitly submits this Store application";
const key = "store-application-pending:v1:1";
function ui(api: ApplicationApi, scope: Scope = "OWNER") {
  return (
    <MemoryRouter
      initialEntries={[
        scope === "ADMIN"
          ? "/admin/store-applications?storeId=7"
          : "/account/store-application",
      ]}
    >
      <StoreApplicationPage scope={scope} api={api} />
    </MemoryRouter>
  );
}
function setup(options: { lost?: boolean; refreshFailure?: boolean } = {}) {
  let exists = false,
    reads = 0;
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const requester = vi.fn(
    async (path: string, init?: Parameters<typeof fetchApi>[1]) => {
      if (init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        posts.push({ path, body });
        const pending = loadPending(1)!;
        const receipt = {
          storeId: 7,
          ownerId: pending.value.expected.ownerId,
          revision: pending.value.expected.revision,
          status: pending.value.expected.status,
          auditId: "1",
          grantCreated: pending.value.expected.grantCreated,
          reauthenticationRequired: false,
        };
        exists = true;
        if (options.lost && !path.includes("/reconcile"))
          throw new TypeError("network");
        return { commandId: body.commandId, outcome: "APPLIED", receipt };
      }
      reads++;
      if (options.refreshFailure && reads === 2)
        throw new ApiError("read unavailable", 503);
      return { application: exists ? structuredClone(data) : null };
    },
  );
  const api = createApplicationApi(1, "OWNER", requester as typeof fetchApi);
  return { api, requester, posts };
}
async function fill() {
  await waitFor(() => expect(screen.getByLabelText("Tên cửa hàng")).toBeEnabled());
  for (const key of Object.keys(profile) as Array<keyof typeof profile>)
    fireEvent.change(screen.getByLabelText(labels[key]), {
      target: { value: profile[key] },
    });
  fireEvent.change(screen.getByLabelText("Lý do / nội dung gửi duyệt"), {
    target: { value: reason },
  });
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Tôi xác nhận thông tin và thao tác đang chọn",
    }),
  );
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubEnv("VITE_SELLER_ONBOARDING_ENABLED", "true");
  vi.stubEnv("VITE_ACCOUNT_BUYER_ACCESS_ENABLED", "true");
  auth.user = {
    id: 1,
    email: "qa@example.invalid",
    fullName: "QA Owner",
    role: "USER",
    isActive: true,
    createdAt: "2026-10-26T00:00:00.000Z",
  };
  sessionStorage.clear();
  setAccessToken("synthetic-token", 1);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Store application consent, unknown outcome and session safety", () => {
  it("local validation keeps the draft editable and creates no pending command", async () => {
    const f = setup();
    render(ui(f.api));
    await fill();
    fireEvent.change(screen.getByLabelText("Số điện thoại liên hệ"), {
      target: { value: "not-a-number" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Tôi xác nhận thông tin và thao tác đang chọn",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Gửi hồ sơ" }));
    await screen.findByText(/Dữ liệu hồ sơ hoặc biên nhận không hợp lệ/);
    expect(screen.getByLabelText("Số điện thoại liên hệ")).toBeEnabled();
    expect(screen.getByLabelText("Số điện thoại liên hệ")).toHaveValue(
      "not-a-number",
    );
    expect(loadPending(1)).toBeNull();
    expect(f.posts).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Số điện thoại liên hệ"), {
      target: { value: profile.contactPhone },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Tôi xác nhận thông tin và thao tác đang chọn",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Gửi hồ sơ" }));
    await screen.findByText("Server đã xác nhận thao tác và ghi lịch sử.");
    expect(f.posts).toHaveLength(1);
  });
  it("sends one command for two same-tick submit events", async () => {
    const f = setup();
    render(ui(f.api));
    await fill();
    const send = screen.getByRole("button", { name: "Gửi hồ sơ" });
    act(() => {
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await screen.findByText("Server đã xác nhận thao tác và ghi lịch sử.");
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0].body.name).toBe(profile.name);
    expect(loadPending(1)).toBeNull();
  });
  it("same-tick input mutation invalidates consent before React rerenders", async () => {
    const f = setup();
    render(ui(f.api));
    await fill();
    const send = screen.getByRole("button", { name: "Gửi hồ sơ" });
    act(() => {
      fireEvent.change(screen.getByLabelText("Tên cửa hàng"), {
        target: { value: "New target draft after consent" },
      });
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(f.posts).toHaveLength(0);
    expect(send).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: "Tôi xác nhận thông tin và thao tác đang chọn",
      }),
    ).not.toBeChecked();
  });
  it("retains key after response loss, reloads, then explicitly reconciles without replay", async () => {
    const f = setup({ lost: true }),
      page = render(ui(f.api));
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Gửi hồ sơ" }));
    await screen.findByRole("complementary", {
      name: "Phục hồi yêu cầu cửa hàng",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Đối chiếu yêu cầu" }),
      ).toBeDisabled(),
    );
    const pending = loadPending(1)!;
    page.unmount();
    render(ui(f.api));
    await screen.findByRole("complementary", {
      name: "Phục hồi yêu cầu cửa hàng",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", {
          name: "Tôi đồng ý đối chiếu mã đã lưu",
        }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Tôi đồng ý đối chiếu mã đã lưu" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Đối chiếu yêu cầu" }));
    await screen.findByText("Server đã xác nhận thao tác và ghi lịch sử.");
    expect(f.posts.filter((p) => !p.path.includes("/reconcile"))).toHaveLength(
      1,
    );
    expect(f.posts.at(-1)!.body).toEqual({
      commandId: pending.value.commandId,
      requestHash: pending.value.requestHash,
      confirmed: true,
    });
    expect(loadPending(1)).toBeNull();
  });
  it("known success followed by GET failure keeps outcome and retries only reads", async () => {
    const f = setup({ refreshFailure: true });
    render(ui(f.api));
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Gửi hồ sơ" }));
    await screen.findByText(
      "Kết quả đã xác minh, nhưng chưa tải lại được hồ sơ. Chỉ tải lại dữ liệu; không gửi lại thao tác.",
    );
    expect(loadPending(1)).toBeNull();
    expect(
      screen.getByText("Server đã xác nhận thao tác và ghi lịch sử."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Tải lại hồ sơ và bỏ bản nháp" }),
    );
    await screen.findByText("Chờ duyệt");
    expect(f.posts).toHaveLength(1);
  });
  it("initial read error cannot be mistaken for no existing Store", async () => {
    const requester = vi
      .fn()
      .mockRejectedValue(new ApiError("unavailable", 503));
    render(ui(createApplicationApi(1, "OWNER", requester as typeof fetchApi)));
    await screen.findByText("unavailable");
    expect(screen.getByRole("button", { name: "Gửi hồ sơ" })).toBeDisabled();
    expect(screen.getByLabelText("Tên cửa hàng")).toBeDisabled();
    expect(loadPending(1)).toBeNull();
  });
  it("corrupt journal blocks new writes without deleting metadata", async () => {
    sessionStorage.setItem(key, "corrupt");
    const f = setup();
    render(ui(f.api));
    await screen.findByText(
      "Không đọc được mã chờ. Đã khóa gửi mới; không tự xóa dữ liệu.",
    );
    expect(screen.getByRole("button", { name: "Gửi hồ sơ" })).toBeDisabled();
    expect(sessionStorage.getItem(key)).toBe("corrupt");
    expect(f.posts).toHaveLength(0);
  });
  it("write flag off still permits explicit recovery of a previously saved key", async () => {
    const candidate = await prepare(
      1,
      "OWNER",
      "submit",
      1,
      { confirmed: true, reason, ...profile },
      null,
    );
    vi.stubEnv("VITE_SELLER_ONBOARDING_ENABLED", "false");
    const requester = vi.fn(
      async (_path: string, options?: Parameters<typeof fetchApi>[1]) =>
        options?.method === "POST"
          ? {
              commandId: candidate.pending.value.commandId,
              outcome: "CLOSED",
              receipt: null,
            }
          : { application: null },
    );
    render(ui(createApplicationApi(1, "OWNER", requester as typeof fetchApi)));
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", {
          name: "Tôi đồng ý đối chiếu mã đã lưu",
        }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Tôi đồng ý đối chiếu mã đã lưu" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Đối chiếu yêu cầu" }));
    await screen.findByText(
      "Yêu cầu chưa được thực hiện và đã được đóng. Hồ sơ cửa hàng không bị nộp, duyệt hoặc thay đổi.",
    );
    expect(loadPending(1)).toBeNull();
    expect(screen.getByRole("button", { name: "Gửi hồ sơ" })).toBeDisabled();
  });
  it("old account read cannot repopulate profile after session switch", async () => {
    let resolve!: (value: unknown) => void;
    const oldRequest = vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const oldApi = createApplicationApi(
      1,
      "OWNER",
      oldRequest as typeof fetchApi,
    );
    const page = render(ui(oldApi));
    await waitFor(() => expect(oldRequest).toHaveBeenCalledOnce());
    auth.user = { ...auth.user, id: 2, email: "second@example.invalid" };
    setAccessToken("second-token", 2);
    const freshRequest = vi.fn().mockResolvedValue({ application: null });
    page.rerender(
      ui(createApplicationApi(2, "OWNER", freshRequest as typeof fetchApi)),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Tên cửa hàng")).toBeEnabled(),
    );
    await act(async () => {
      resolve({ application: data });
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Tên cửa hàng")).toHaveValue("");
    expect(screen.queryByText("Chờ duyệt")).not.toBeInTheDocument();
  });
  it("Admin decision change requires independent fresh consent and clears it on target read", async () => {
    auth.user.role = "ADMIN";
    const target = {
      ...structuredClone(data),
      ownerId: 2,
      history: [{ ...data.history[0], actorId: 2 }],
    };
    const posts: unknown[] = [];
    const requester = vi.fn(
      async (path: string, options?: Parameters<typeof fetchApi>[1]) => {
        if (options?.method === "POST") {
          posts.push(JSON.parse(options.body as string));
          throw new TypeError("controlled unknown");
        }
        return path.startsWith("/admin/store-applications/7?")
          ? target
          : {
              items: [
                {
                  id: 7,
                  name: profile.name,
                  status: "PENDING",
                  ownerId: 2,
                  revision: 1,
                },
              ],
              nextAfterId: null,
            };
      },
    );
    render(
      ui(
        createApplicationApi(1, "ADMIN", requester as typeof fetchApi),
        "ADMIN",
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Thao tác")).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Lý do / nội dung gửi duyệt"), {
      target: { value: reason },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Tôi xác nhận thông tin và thao tác đang chọn",
      }),
    );
    fireEvent.change(screen.getByLabelText("Thao tác"), {
      target: { value: "REJECTED" },
    });
    expect(
      screen.getByRole("button", { name: "Ghi nhận quyết định" }),
    ).toBeDisabled();
    expect(posts).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Tải lại hồ sơ và bỏ bản nháp" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Thao tác")).toBeEnabled(),
    );
    expect(screen.getByLabelText("Lý do / nội dung gửi duyệt")).toHaveValue("");
    expect(
      screen.getByRole("checkbox", {
        name: "Tôi xác nhận thông tin và thao tác đang chọn",
      }),
    ).not.toBeChecked();
  });
});
