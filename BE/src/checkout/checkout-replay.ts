import type { Checkout } from '@prisma/client';
import { checkoutError } from './checkout-error.js';
import { validateCheckoutReceiptV1 } from './checkout-receipt.js';

type StoredCheckout = Pick<
  Checkout,
  | 'id'
  | 'buyerId'
  | 'requestHash'
  | 'hashVersion'
  | 'status'
  | 'completedAt'
  | 'receiptVersion'
  | 'receiptJson'
>;

// Pure classification only. The create service reads this row again
// under the Buyer DB lock before taking the new-intent path. No write/rebuild
// is allowed here, and lookup calls omit requestHash, not Buyer ownership.
export function resolveCheckoutReplay(
  stored: StoredCheckout | null,
  buyerId: number,
  requestHash?: string,
) {
  if (!stored) return null;
  if (stored.buyerId !== buyerId)
    throw checkoutError(
      404,
      'CHECKOUT_NOT_FOUND',
      'Không tìm thấy lần đặt hàng.',
    );
  // Classify provenance first: never compare a v1 hash to an unknown algorithm.
  if (stored.hashVersion !== 1)
    throw checkoutError(
      409,
      'CHECKOUT_LEGACY_REVIEW_REQUIRED',
      'Kết quả đặt hàng cũ cần được kiểm tra riêng.',
    );
  if (requestHash !== undefined && stored.requestHash !== requestHash)
    throw checkoutError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'Mã yêu cầu đã được dùng cho nội dung đặt hàng khác.',
    );
  if (stored.status === 'PENDING')
    throw checkoutError(
      409,
      'CHECKOUT_IN_PROGRESS',
      'Lần đặt hàng này đang được xử lý. Vui lòng kiểm tra lại.',
    );
  if (
    stored.status !== 'COMPLETED' ||
    stored.receiptVersion !== 1 ||
    !stored.completedAt ||
    !Number.isFinite(stored.completedAt.getTime())
  )
    throw checkoutError(
      500,
      'INTERNAL_ERROR',
      'Không thể đọc kết quả đặt hàng đã lưu.',
    );
  return {
    ...validateCheckoutReceiptV1(stored.receiptJson, stored.id),
    replayed: true as const,
  };
}
