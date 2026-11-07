// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
// @ts-expect-error Node-only test fixture, browser app excludes Node ambient types.
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
import * as client from "./reviewClient";
import { ReviewPage } from "./ReviewPage";
const auth = vi.hoisted(() => ({
  user: {
    id: 1,
    email: "qa@example.invalid",
    role: "USER",
    isActive: true,
    fullName: "QA",
  },
}));
vi.mock("../../contexts/useAuth", () => ({
  useAuth: () => ({ user: auth.user, loading: false }),
}));
const realCreate = client.createReviewApi;
const stamp = "2026-10-26T00:00:00.000Z";
const existing: client.Review = {
  id: 7,
  orderItemId: 12,
  productId: 3,
  storeId: 4,
  revision: 1,
  rating: 5,
  body: "Existing synthetic review",
  hidden: false,
  createdAt: stamp,
  updatedAt: stamp,
  reply: null,
  isRefunded: false,
};
const ui = (scope: client.Scope = "BUYER") => (
  <MemoryRouter initialEntries={["/account/reviews?itemId=12"]}>
    <ReviewPage scope={scope} />
  </MemoryRouter>
);
function setup(
  options: {
    lost?: boolean;
    readFails?: boolean;
    deny?: boolean;
    badReceipt?: boolean;
  } = {},
) {
  let exists = false,
    reads = 0;
  const posts: unknown[] = [];
  const requester = vi.fn(async (_path: string, req?: RequestInit) => {
    if (req?.method === "POST") {
      posts.push(JSON.parse(req.body as string));
      if (options.deny) throw new ApiError("Không đủ quyền.", 403);
      const pending = client.loadPending(1)!;
      const receipt = {
        orderItemId: 12,
        reviewId: 7,
        revision: pending.value.expected.revision,
        rating: pending.value.expected.rating,
        hidden: pending.value.expected.hidden,
        action: pending.value.action,
        auditId: "1",
      };
      exists = true;
      if (options.lost && !_path.includes("reconcile"))
        throw new TypeError("Mất phản hồi");
      return {
        commandId: pending.value.commandId,
        outcome: "APPLIED",
        receipt: {
          ...receipt,
          ...(options.badReceipt ? { orderItemId: 99 } : {}),
        },
      };
    }
    reads++;
    if (options.readFails && reads === 2)
      throw new ApiError("Tải lại dữ liệu lỗi.", 503);
    return {
      orderItemId: 12,
      productName: "Synthetic purchased product",
      deadline: "2026-11-25T00:00:00.000Z",
      canCreate: !exists,
      canEdit: exists,
      review: exists ? existing : null,
      historyTruncated: false,
      history: exists
        ? [
            {
              revision: 1,
              action: "create",
              rating: 5,
              body: existing.body,
              hidden: false,
              replyBody: null,
              createdAt: stamp,
            },
          ]
        : [],
    };
  });
  vi.spyOn(client, "createReviewApi").mockImplementation((id, scope) =>
    realCreate(id, scope, requester as typeof fetchApi),
  );
  return { requester, posts };
}
async function fill() {
  await waitFor(() =>
    expect(screen.getByLabelText("Nhận xét của bạn")).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("Nhận xét của bạn"), {
    target: { value: "Nhận xét có xác nhận." },
  });
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Tôi xác nhận nội dung và thao tác đang chọn.",
    }),
  );
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubEnv("VITE_PRODUCT_REVIEWS_ENABLED", "true");
  sessionStorage.clear();
  auth.user = {
    id: 1,
    email: "qa@example.invalid",
    role: "USER",
    isActive: true,
    fullName: "QA",
  };
  setAccessToken("synthetic-test", 1);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Review UI consent, duplicate clicks, reload and session boundaries", () => {
  it("Seller cannot re-enable cached row selection after a failed refresh", async () => {
    auth.user = { ...auth.user, role: "SELLER" };
    let reads = 0;
    const request = vi.fn(async () => {
      if (++reads > 1) throw new ApiError("Refresh failed", 503);
      return {
        items: [{ ...existing, productName: "Seller synthetic item" }],
        nextBeforeId: null,
      };
    });
    vi.spyOn(client, "createReviewApi").mockImplementation((id, scope) =>
      realCreate(id, scope, request as typeof fetchApi),
    );
    render(ui("SELLER"));
    const row = await screen.findByRole("button", {
      name: /Seller synthetic item/,
    });
    fireEvent.click(row);
    await screen.findByLabelText("Phản hồi của cửa hàng");
    fireEvent.click(screen.getByRole("button", { name: "Tải lại đánh giá" }));
    await screen.findByRole("alert");
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(
      screen.queryByLabelText("Phản hồi của cửa hàng"),
    ).not.toBeInTheDocument();
  });
  it("Admin detail reads private moderation history while foreign role is blocked", async () => {
    auth.user = { ...auth.user, role: "ADMIN" };
    const request = vi.fn(async (path: string) =>
      path.includes("/admin/reviews/12")
        ? {
            orderItemId: 12,
            productName: "Admin synthetic item",
            deadline: stamp,
            canCreate: false,
            canEdit: false,
            review: { ...existing, hidden: true },
            historyTruncated: false,
            history: [
              {
                revision: 1,
                action: "create",
                rating: 5,
                body: existing.body,
                hidden: true,
                replyBody: null,
                reason: "Internal admin moderation reason",
                createdAt: stamp,
              },
            ],
          }
        : {
            items: [
              {
                ...existing,
                hidden: true,
                productName: "Admin synthetic item",
              },
            ],
            nextBeforeId: null,
          },
    );
    vi.spyOn(client, "createReviewApi").mockImplementation((id, scope) =>
      realCreate(id, scope, request as typeof fetchApi),
    );
    render(ui("ADMIN"));
    await screen.findByText("Internal admin moderation reason");
    expect(
      screen.queryByRole("button", { name: "Ẩn đánh giá" }),
    ).not.toBeInTheDocument();
  });
  it("same-tick double submit sends one POST with no auto-replay", async () => {
    const f = setup();
    render(ui());
    await fill();
    const b = screen.getByRole("button", { name: "Gửi đánh giá" });
    await act(async () => {
      b.click();
      b.click();
    });
    await waitFor(() => expect(f.posts).toHaveLength(1));
    await screen.findByText(/Server đã ghi nhận và xác minh/);
    expect(client.loadPending(1)).toBeNull();
  });
  it("same-tick draft mutation invalidates earlier confirmation", async () => {
    const f = setup();
    render(ui());
    await fill();
    const b = screen.getByRole("button", { name: "Gửi đánh giá" });
    act(() => {
      fireEvent.change(screen.getByLabelText("Nhận xét của bạn"), {
        target: { value: "Nội dung mới chưa xác nhận" },
      });
      b.click();
    });
    expect(f.posts).toHaveLength(0);
    expect(client.loadPending(1)).toBeNull();
  });
  it("local validation keeps draft editable without a pending key", async () => {
    const f = setup();
    render(ui());
    await fill();
    fireEvent.change(screen.getByLabelText("Nhận xét của bạn"), {
      target: { value: "\t" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Tôi xác nhận nội dung và thao tác đang chọn.",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Gửi đánh giá" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Nhận xét của bạn")).toBeEnabled();
    expect(client.loadPending(1)).toBeNull();
    expect(f.posts).toHaveLength(0);
  });
  it("lost response, remount and explicit consent recover the same key without resending body", async () => {
    const f = setup({ lost: true });
    const mounted = render(ui());
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Gửi đánh giá" }));
    await screen.findByLabelText("Yêu cầu đánh giá chờ đối chiếu");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Tải lại đánh giá" }),
      ).toBeEnabled(),
    );
    const old = client.loadPending(1)!.raw;
    mounted.unmount();
    render(ui());
    await screen.findByLabelText("Yêu cầu đánh giá chờ đối chiếu");
    expect(
      screen.getByRole("button", { name: "Đối chiếu yêu cầu cũ" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Tôi đồng ý kiểm tra kết quả/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Đối chiếu yêu cầu cũ" }),
    );
    await screen.findByText(/Server đã xử lý yêu cầu trước đó/);
    expect(f.posts).toHaveLength(2);
    expect(f.posts[1]).not.toHaveProperty("body");
    expect((f.posts[1] as { commandId: string }).commandId).toBe(
      JSON.parse(old).commandId,
    );
    expect(client.loadPending(1)).toBeNull();
  });
  it("known receipt then GET failure offers only a read retry, no second POST", async () => {
    const f = setup({ readFails: true });
    render(ui());
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Gửi đánh giá" }));
    await screen.findByRole("alert");
    expect(client.loadPending(1)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Gửi đánh giá" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại đánh giá" }));
    await screen.findByLabelText("Nhận xét của bạn");
    expect(f.posts).toHaveLength(1);
  });
  it("wrong receipt retains metadata and blocks new transactions", async () => {
    setup({ badReceipt: true });
    render(ui());
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Gửi đánh giá" }));
    await screen.findByRole("alert");
    expect(client.loadPending(1)).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Đối chiếu yêu cầu cũ" }),
    ).toBeDisabled();
  });
  it("hard permission failure clears private draft but preserves recovery key", async () => {
    setup({ deny: true });
    render(ui());
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Gửi đánh giá" }));
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Nhận xét của bạn")).not.toBeInTheDocument();
    expect(client.loadPending(1)).not.toBeNull();
  });
  it("actor switch does not display the old pending command or draft", async () => {
    setup({ lost: true });
    const mounted = render(ui());
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Gửi đánh giá" }));
    await screen.findByLabelText("Yêu cầu đánh giá chờ đối chiếu");
    auth.user = { ...auth.user, id: 2, email: "other@example.invalid" };
    setAccessToken("other-session", 2);
    mounted.rerender(ui());
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Yêu cầu đánh giá chờ đối chiếu"),
      ).not.toBeInTheDocument(),
    );
    expect(client.loadPending(1)).not.toBeNull();
    expect(client.loadPending(2)).toBeNull();
  });
  it("rollout off prevents new writes while existing pending recovery stays available", async () => {
    const f = setup();
    await client.prepare(
      1,
      "BUYER",
      "create",
      12,
      { confirmed: true, rating: 5, body: "Earlier pending content" },
      null,
    );
    vi.stubEnv("VITE_PRODUCT_REVIEWS_ENABLED", "false");
    render(ui());
    await screen.findByLabelText("Yêu cầu đánh giá chờ đối chiếu");
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Tôi đồng ý kiểm tra kết quả/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Đối chiếu yêu cầu cũ" }),
    );
    await screen.findByText(/Server đã xử lý yêu cầu trước đó/);
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0]).not.toHaveProperty("body");
    expect(
      screen.getByRole("button", { name: "Lưu chỉnh sửa đánh giá" }),
    ).toBeDisabled();
  });
  it("unknown or duplicate target query cannot fetch or expose another item", () => {
    const f = setup();
    render(
      <MemoryRouter initialEntries={["/account/reviews?itemId=12&itemId=13"]}>
        <ReviewPage scope="BUYER" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Mã mặt hàng không hợp lệ",
    );
    expect(f.requester).not.toHaveBeenCalled();
  });
});
