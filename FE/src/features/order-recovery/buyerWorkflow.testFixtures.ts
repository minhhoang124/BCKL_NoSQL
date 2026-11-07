// Tests only. Handwritten HTTP fixtures are not live Backend/DB evidence.
import type { BuyerCommand } from "./buyerCommandFingerprint";
import { detailFixture } from "../order-readiness/testFixtures";
export const reason = {
  reasonCode: "OTHER" as const,
  reasonText: "Không còn nhu cầu",
};
export const time = "2026-10-23T01:00:00.000Z";
export const slot = "bckl-order-command-journal-v1:7";
export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
export function commandOrder(command: BuyerCommand = "cancel", id = 101) {
  const order = detailFixture(id);
  if (command === "complete") {
    order.status = "DELIVERED";
    order.payment!.status = "PAID";
    order.payment!.paidAt = time;
  }
  return order;
}
export function buyerReceipt(
  command: BuyerCommand = "cancel",
  replayed = false,
  id = 101,
) {
  const payment = {
    provider: "COD",
    status: command === "cancel" ? "CANCELLED" : "PAID",
    amount: "20000.00",
    currency: "VND",
    paidAt: command === "cancel" ? null : time,
  };
  return {
    orderId: id,
    commandId: 201,
    command,
    replayed,
    result:
      command === "cancel"
        ? {
            status: "CANCELLED",
            payment,
            cancellation: {
              cancelledBy: { type: "BUYER", id: 7 },
              ...reason,
              cancelledAt: time,
            },
            timeline: [
              {
                fromStatus: "PENDING_CONFIRMATION",
                toStatus: "CANCELLED",
                actorType: "BUYER",
                actorId: 7,
                ...reason,
                createdAt: time,
              },
            ],
          }
        : {
            status: "COMPLETED",
            deliveredAt: time,
            completedAt: time,
            payment,
            timeline: [
              {
                fromStatus: "DELIVERED",
                toStatus: "COMPLETED",
                actorType: "BUYER",
                actorId: 7,
                createdAt: time,
              },
            ],
          },
  };
}
export function finalOrder(command: BuyerCommand = "cancel", id = 101) {
  const order = commandOrder(command, id);
  order.status = command === "cancel" ? "CANCELLED" : "COMPLETED";
  if (command === "cancel") {
    order.payment!.status = "CANCELLED";
    order.cancellation = {
      cancelledBy: { type: "BUYER", id: 7 },
      ...reason,
      cancelledAt: time,
    };
  }
  return order;
}
