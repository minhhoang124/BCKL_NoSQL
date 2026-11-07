import { describe, expect, it } from "vitest";
import { paymentText } from "./OrderPanels";

describe("paymentText", () => {
  it.each([
    ["COD", "UNPAID", "Thanh toán khi nhận hàng · Chưa thanh toán"],
    ["COD", "PAID", "Thanh toán khi nhận hàng · Đã thanh toán"],
    ["VNPAY", "PAID", "VNPay (sandbox) · Đã thanh toán"],
    ["VNPAY", "REFUNDED", "VNPay (sandbox) · Đã hoàn tiền (mô phỏng)"],
  ])("%s/%s → %s", (provider, status, text) => {
    expect(paymentText(provider, status)).toBe(text);
  });
  it("shows unknown values as-is instead of guessing", () => {
    expect(paymentText("NEWPAY", "ODD")).toBe("NEWPAY · ODD");
  });
});
