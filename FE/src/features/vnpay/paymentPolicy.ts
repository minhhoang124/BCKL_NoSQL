import type { OrderPayment } from "../../types/order";
export function cancellableUnpaidPayment(p: OrderPayment | null) {
  return (
    p !== null &&
    p.paidAt === null &&
    ((p.provider === "COD" && p.status === "UNPAID") ||
      (p.provider === "VNPAY" &&
        ["UNPAID", "PENDING", "FAILED", "CANCELLED", "EXPIRED"].includes(
          p.status,
        )))
  );
}
