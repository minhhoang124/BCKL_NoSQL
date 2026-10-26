import { afterEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../../services/apiClient";
import {
  createNotificationApi,
  noticeId,
  parseNoticePage,
} from "./notificationClient";
const stamp = "2026-10-27T00:00:00.000Z";
const item = (id = "9007199254740993") => ({
  id,
  title: "Đơn hàng",
  text: "Trạng thái đã thay đổi.",
  link: "/account/orders/12",
  eventAt: stamp,
  createdAt: stamp,
  readAt: null,
});
const page = () => ({
  items: [item()],
  nextBeforeId: null,
  unreadCount: 1,
  throughId: "9007199254740993",
  syncPending: false,
});
afterEach(() => {
  setAccessToken(null);
  vi.restoreAllMocks();
});
describe("notification response boundaries", () => {
  it("keeps bigint identity exact above Number.MAX_SAFE_INTEGER", () =>
    expect(parseNoticePage(page()).items[0].id).toBe("9007199254740993"));
  it.each(["0", "01", "-1", "1e2", "9223372036854775808", "1.1", 2, null])(
    "rejects noncanonical id %s",
    (value) => expect(() => noticeId(value)).toThrow(),
  );
  it.each([
    "https://evil.invalid",
    "//evil.invalid",
    "javascript:alert(1)",
    "/admin/unknown",
    "/account/orders/2147483648",
    "/messages/1?next=//evil.invalid",
  ])("rejects untrusted route %s", (link) =>
    expect(() =>
      parseNoticePage({ ...page(), items: [{ ...item(), link }] }),
    ).toThrow(),
  );
  it("rejects extra private response fields", () =>
    expect(() => parseNoticePage({ ...page(), recipientId: 7 })).toThrow());
  it("rejects duplicate or reversed ids", () =>
    expect(() =>
      parseNoticePage({ ...page(), items: [item(), item()] }),
    ).toThrow());
  it("rejects mismatched cursor or head", () => {
    expect(() => parseNoticePage({ ...page(), nextBeforeId: "2" })).toThrow();
    expect(() => parseNoticePage({ ...page(), throughId: "2" })).toThrow();
  });
  it("rejects read time before created time", () =>
    expect(() =>
      parseNoticePage({
        ...page(),
        items: [{ ...item(), readAt: "2026-10-26T00:00:00.000Z" }],
      }),
    ).toThrow());
  it("rejects controls in text", () =>
    expect(() =>
      parseNoticePage({ ...page(), items: [{ ...item(), text: "x\nsecret" }] }),
    ).toThrow());
});
describe("notification client", () => {
  it("sends explicit consent without automatic unauthorized replay", async () => {
    const request = vi.fn(async () => ({ id: "8", readAt: stamp }));
    await createNotificationApi(request as never).read("8");
    expect(request).toHaveBeenCalledWith(
      "/account/notifications/8/read",
      expect.objectContaining({
        method: "POST",
        retryOnUnauthorized: false,
        body: '{"confirmed":true}',
      }),
    );
  });
  it("sends exact displayed watermark as string", async () => {
    const request = vi.fn(async () => ({
      throughId: "9007199254740993",
      changed: 2,
    }));
    await createNotificationApi(request as never).readAll("9007199254740993");
    expect(request).toHaveBeenCalledWith(
      "/account/notifications/read-all",
      expect.objectContaining({
        body: JSON.stringify({
          confirmed: true,
          throughId: "9007199254740993",
        }),
      }),
    );
  });
  it("does not retry failed POST", async () => {
    const request = vi.fn().mockRejectedValue(new TypeError("lost response"));
    await expect(createNotificationApi(request).read("8")).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects a success for another id", async () =>
    await expect(
      createNotificationApi(
        vi.fn().mockResolvedValue({ id: "9", readAt: stamp }),
      ).read("8"),
    ).rejects.toThrow());
  it("rejects late response after account/session change", async () => {
    let resolve!: (p: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = createNotificationApi(request as never).list();
    setAccessToken("another-session");
    resolve(page());
    await expect(pending).rejects.toMatchObject({
      name: "AuthSessionChangedError",
    });
  });
  it("rejects wrong cursor and unread filter result", async () => {
    await expect(
      createNotificationApi(vi.fn().mockResolvedValue(page())).list("2"),
    ).rejects.toThrow();
    await expect(
      createNotificationApi(vi.fn().mockResolvedValue(page())).list(
        null,
        false,
      ),
    ).rejects.toThrow();
  });
});
