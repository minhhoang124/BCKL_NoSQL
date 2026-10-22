import { validOrderId } from "../../services/orderResponse";
import { OrderRecoveryBlockedError } from "./orderIntentJournal";

export type BuyerCommand = "cancel" | "complete";
export type BuyerCancellationBody = Readonly<{
  reasonCode: "CHANGED_MIND" | "OTHER";
  reasonText: string;
}>;
export type BuyerCommandBody =
  BuyerCancellationBody | Readonly<Record<string, never>>;
function blocked(): never {
  throw new OrderRecoveryBlockedError();
}
/** Only original normalized body in RAM. Never persist the returned body. */
export function normalizeBuyerCommand(
  command: BuyerCommand,
  raw: unknown,
): BuyerCommandBody {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  )
    blocked();
  const fields = Reflect.ownKeys(raw),
    r = raw as Record<string, unknown>;
  if (
    fields.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      return !descriptor || !Object.hasOwn(descriptor, "value");
    })
  )
    blocked();
  if (command === "complete") {
    if (fields.length) blocked();
    return Object.freeze({});
  }
  if (
    command !== "cancel" ||
    fields.length !== 2 ||
    !Object.hasOwn(r, "reasonCode") ||
    !Object.hasOwn(r, "reasonText") ||
    (r.reasonCode !== "CHANGED_MIND" && r.reasonCode !== "OTHER") ||
    typeof r.reasonText !== "string"
  )
    blocked();
  const text = r.reasonText.trim();
  if (!text.length || text.length > 500) blocked();
  // Keep property order/UTF-16 length/trim aligned with canonical Backend v1.
  // No NFC conversion or whitespace collapse.
  return Object.freeze({ reasonCode: r.reasonCode, reasonText: text });
}
export async function fingerprintBuyerCommand(
  actorId: number,
  orderId: number,
  command: BuyerCommand,
  raw: unknown,
): Promise<string> {
  if (!validOrderId(actorId) || !validOrderId(orderId)) blocked();
  const body = normalizeBuyerCommand(command, raw);
  const canonical = JSON.stringify({
    actorScope: `USER:${actorId}`,
    body,
    command,
    orderId,
  });
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical),
    );
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    blocked();
  }
}
