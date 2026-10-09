import { createHash } from 'node:crypto';
import { checkoutError, invalidCheckout } from './checkout-error.js';
import { parseExpectedUnitPrice } from './checkout-money.js';

export interface CheckoutItemInput {
  variantId: number;
  quantity: number;
  expectedUnitPrice: string;
}
export interface CheckoutRequestInput {
  addressId: number;
  paymentProvider: 'COD';
  items: CheckoutItemInput[];
}
export interface CanonicalCheckoutRequestV1 extends CheckoutRequestInput {
  buyerId: number;
}

export function exactObject(
  input: unknown,
  keys: readonly string[],
): input is Record<string, unknown> {
  return (
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Object.keys(input).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(input, key))
  );
}

export function isPgId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 2147483647
  );
}

export function validateCheckoutKey(key: unknown): string {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
    invalidCheckout();
  return key;
}

export function normalizeCheckoutRequest(input: unknown): CheckoutRequestInput {
  if (
    !exactObject(input, ['addressId', 'paymentProvider', 'items']) ||
    !isPgId(input.addressId) ||
    input.paymentProvider !== 'COD' ||
    !Array.isArray(input.items)
  )
    invalidCheckout();
  if (input.items.length === 0)
    throw checkoutError(
      400,
      'EMPTY_CHECKOUT',
      'Chưa chọn sản phẩm để đặt hàng.',
    );
  if (input.items.length > 50) invalidCheckout();
  const ids = new Set<number>();
  const items = input.items.map((item: unknown): CheckoutItemInput => {
    if (
      !exactObject(item, ['variantId', 'quantity', 'expectedUnitPrice']) ||
      !isPgId(item.variantId) ||
      typeof item.quantity !== 'number' ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 99 ||
      ids.has(item.variantId)
    )
      invalidCheckout();
    ids.add(item.variantId);
    return {
      variantId: item.variantId,
      quantity: item.quantity,
      expectedUnitPrice: parseExpectedUnitPrice(item.expectedUnitPrice).toFixed(
        2,
      ),
    };
  });
  items.sort((a, b) => a.variantId - b.variantId);
  return { addressId: input.addressId, paymentProvider: 'COD', items };
}

export function buildCheckoutRequestV1(buyerId: number, input: unknown) {
  if (!isPgId(buyerId)) invalidCheckout();
  const request = normalizeCheckoutRequest(input);
  const canonicalRequest: CanonicalCheckoutRequestV1 = { buyerId, ...request };
  // Reviewed recursive lexicographic order, expressed using a fixed allowlist.
  // No key, timestamp, current Cart/address/price or extra field enters v1.
  const canonicalJson = JSON.stringify({
    addressId: request.addressId,
    buyerId,
    items: request.items.map((item) => ({
      expectedUnitPrice: item.expectedUnitPrice,
      quantity: item.quantity,
      variantId: item.variantId,
    })),
    paymentProvider: request.paymentProvider,
  });
  return {
    hashVersion: 1 as const,
    requestHash: createHash('sha256')
      .update(canonicalJson, 'utf8')
      .digest('hex'),
    canonicalRequest,
  };
}
