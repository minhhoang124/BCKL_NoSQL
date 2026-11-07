import { Prisma } from '@prisma/client';
import { checkoutError } from './checkout-error.js';
import { checkedSubtotal, MAX_CHECKOUT_MONEY } from './checkout-money.js';
import { exactObject, isPgId } from './checkout-request.js';

export interface CheckoutReceiptV1 {
  checkoutId: number;
  status: 'COMPLETED';
  orders: {
    id: number;
    orderNumber: string;
    storeId: number;
    status: 'PENDING_CONFIRMATION';
    payment: {
      provider: 'COD' | 'VNPAY';
      status: 'UNPAID';
      amount: string;
      currency: 'VND';
    };
    total: string;
  }[];
}

function corruptReceipt(): never {
  // No raw JSON, keys, hashes, SQL or personal data in the error.
  throw checkoutError(
    500,
    'INTERNAL_ERROR',
    'Không thể đọc kết quả đặt hàng đã lưu.',
  );
}

function validReceiptMoney(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,11}\.00$/.test(value) &&
    new Prisma.Decimal(value).lte(MAX_CHECKOUT_MONEY)
  );
}

export function validateCheckoutReceiptV1(
  input: unknown,
  checkoutId: number,
  provider:'COD'|'VNPAY'='COD',
): CheckoutReceiptV1 {
  if (
    !isPgId(checkoutId) ||
    !exactObject(input, ['checkoutId', 'status', 'orders']) ||
    input.checkoutId !== checkoutId ||
    input.status !== 'COMPLETED' ||
    !Array.isArray(input.orders) ||
    input.orders.length < 1 ||
    input.orders.length > 50
  )
    corruptReceipt();
  let previousStoreId = 0;
  const ids = new Set<number>();
  const numbers = new Set<string>();
  const orders = input.orders.map(
    (order: unknown): CheckoutReceiptV1['orders'][number] => {
      if (
        !exactObject(order, [
          'id',
          'orderNumber',
          'storeId',
          'status',
          'payment',
          'total',
        ]) ||
        !isPgId(order.id) ||
        !isPgId(order.storeId) ||
        order.storeId <= previousStoreId ||
        ids.has(order.id) ||
        typeof order.orderNumber !== 'string' ||
        !order.orderNumber.trim() ||
        numbers.has(order.orderNumber) ||
        order.status !== 'PENDING_CONFIRMATION' ||
        !validReceiptMoney(order.total) ||
        !exactObject(order.payment, [
          'provider',
          'status',
          'amount',
          'currency',
        ]) ||
        order.payment.provider !== provider ||
        order.payment.status !== 'UNPAID' ||
        order.payment.currency !== 'VND' ||
        order.payment.amount !== order.total
      )
        corruptReceipt();
      ids.add(order.id);
      numbers.add(order.orderNumber);
      previousStoreId = order.storeId;
      // Rebuild only from validated stored receipt, never from live Order rows.
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        storeId: order.storeId,
        status: 'PENDING_CONFIRMATION',
        total: order.total,
        payment: {
          provider,
          status: 'UNPAID',
          amount: order.total,
          currency: 'VND',
        },
      };
    },
  );
  try {
    checkedSubtotal(orders.map((order) => new Prisma.Decimal(order.total)));
  } catch {
    corruptReceipt();
  }
  return { checkoutId, status: 'COMPLETED', orders };
}
