import { afterEach, expect, it, vi } from "vitest";
import { setAccessToken } from "../../services/apiClient";
import { createEmailApi, tokenFromFragment } from "./emailClient";
afterEach(() => {
  setAccessToken(null);
  vi.restoreAllMocks();
});
const token = "A".repeat(43);
it.each([
  "",
  "#token=x",
  `#token=${token}&token=${token}`,
  `#token=${token}&email=other@example.invalid`,
  "#token=" + "A".repeat(42) + "B",
])("rejects missing/duplicate/extra/noncanonical fragment %s", (hash) =>
  expect(tokenFromFragment(hash)).toBeNull(),
);
it("accepts canonical fragment without logging or storing token", () =>
  expect(tokenFromFragment("#token=" + token)).toBe(token));
it("POST uses explicit consent and forbids unauthorized replay", async () => {
  const req = vi
    .fn()
    .mockResolvedValue({
      status: "PASSWORD_RESET",
      reauthenticationRequired: true,
    });
  await createEmailApi(req).confirm(token, "some new password");
  expect(req).toHaveBeenCalledWith(
    "/auth/password-reset/confirm",
    expect.objectContaining({
      method: "POST",
      retryOnUnauthorized: false,
      body: JSON.stringify({
        token,
        confirmed: true,
        newPassword: "some new password",
      }),
    }),
  );
});
it("rejects success with wrong action or extra identity fields", async () => {
  await expect(
    createEmailApi(
      vi.fn().mockResolvedValue({ status: "EMAIL_VERIFIED", userId: 4 }),
    ).confirm(token),
  ).rejects.toThrow();
  await expect(
    createEmailApi(
      vi
        .fn()
        .mockResolvedValue({
          status: "EMAIL_VERIFIED",
          reauthenticationRequired: true,
        }),
    ).confirm(token, "newpass123"),
  ).rejects.toThrow();
});
it("generic request never accepts server token or account existence", async () => {
  await expect(
    createEmailApi(
      vi
        .fn()
        .mockResolvedValue({
          status: "REQUEST_ACCEPTED",
          message: "ok",
          token,
        }),
    ).request("email@example.invalid"),
  ).rejects.toThrow();
});
it("discards response after session change", async () => {
  let resolve!: (value: unknown) => void;
  const req = vi.fn(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = createEmailApi(req as never).request(null);
  setAccessToken("other");
  resolve({ status: "REQUEST_ACCEPTED", message: "ok" });
  await expect(pending).rejects.toMatchObject({
    name: "AuthSessionChangedError",
  });
});
it("does not repeat uncertain reset", async () => {
  const req = vi.fn().mockRejectedValue(new Error("lost"));
  await expect(
    createEmailApi(req).confirm(token, "new pass"),
  ).rejects.toThrow();
  expect(req).toHaveBeenCalledTimes(1);
});
