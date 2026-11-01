import { fetchApi, ApiError } from '../../services/apiClient';

export interface Address { id: number; recipientName: string; phone?: string; addressLine: string; ward: string; province: string; district?: string | null; postalCode?: string | null; deliveryNote?: string | null; isDefault: boolean; }
export interface CartItem { variantId: number; quantity: number; available: boolean; currentUnitPrice?: string; productName?: string; unavailableReason: string | null; imageUrl?: string; optionValues?: string[]; lineTotal?: string; }
export interface Cart { groups: { store: { id: number; name: string }; items: CartItem[] }[]; unavailableItems: CartItem[] }
export interface CheckoutBody { addressId: number; paymentProvider: 'COD'|'VNPAY'; items: { variantId: number; quantity: number; expectedUnitPrice: string }[] }
export interface Preview { canCheckout: boolean; groups: { store: { id: number; name: string }; items: { variantId: number; unitPrice: string; quantity: number; errors: string[] }[] }[]; unavailableItems: { variantId: number }[]; totals: { total: string } | null }
export interface Receipt { checkoutId: number; status: 'COMPLETED'; replayed: boolean; orders: { id: number; orderNumber: string; total: string; storeId: number; status: 'PENDING_CONFIRMATION'; payment: { provider: 'COD'|'VNPAY'; status: 'UNPAID'; amount: string; currency: 'VND' } }[] }
const pgId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
function invalidReceipt(): never { throw new ApiError('Phản hồi chưa đủ để xác nhận thành công. Giữ yêu cầu cũ để đối chiếu, không tạo mã mới.', 502, 'INVALID_RECEIPT'); }
// Minimum display/identity checks, not a substitute for Backend's full receipt
// validator. Never discard a replay identity just because HTTP returned 200.
export function validateReceipt(value: Receipt,expectedProvider: 'COD'|'VNPAY'='COD'): Receipt {
  if (!value || !pgId(value.checkoutId) || value.status !== 'COMPLETED' || typeof value.replayed !== 'boolean' || !Array.isArray(value.orders) || !value.orders.length || value.orders.length > 50) invalidReceipt();
  const ids = new Set<number>();
  const stores = new Set<number>();
  for (const order of value.orders) {
    if (!order || !pgId(order.id) || ids.has(order.id) || !pgId(order.storeId) || typeof order.orderNumber !== 'string' || !order.orderNumber.trim() || typeof order.total !== 'string' || !/^[1-9][0-9]{0,11}\.00$/.test(order.total)) invalidReceipt();
    if (stores.has(order.storeId) || order.status !== 'PENDING_CONFIRMATION' || !order.payment || order.payment.provider !== expectedProvider || order.payment.status !== 'UNPAID' || order.payment.currency !== 'VND' || order.payment.amount !== order.total) invalidReceipt();
    ids.add(order.id);
    stores.add(order.storeId);
  }
  return value;
}
// Never use floating-point arithmetic to compute/display business money.
export function money(value: string): string {
  if (!/^(0|[1-9][0-9]*)\.00$/.test(value)) return 'Số tiền không hợp lệ';
  return BigInt(value.split('.')[0]!).toLocaleString('vi-VN') + ' ₫';
}
export async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  return fetchApi<T>(path, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
}
export async function write<T>(path: string, body: object, key?: string): Promise<T> {
  return fetchApi<T>(path, { method: 'POST', body: JSON.stringify(body), headers: key ? { 'Idempotency-Key': key } : undefined, signal: AbortSignal.timeout(30000) });
}
export function lookupReceipt(key: string): Promise<Receipt> {
  return fetchApi<Receipt>('/checkouts/by-key', { headers: { 'Idempotency-Key': key }, signal: AbortSignal.timeout(30000) });
}
// Only explicit rollback/business rejections release an intent. Network, 5xx,
// throttling, 404 lookup and IN_PROGRESS are NOT proof of non-commit.
export function rejectedWithoutCommit(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 412 && error.code === 'EMAIL_VERIFICATION_REQUIRED') return true;
  return error instanceof ApiError && [400, 404, 409].includes(error.status ?? 0) &&
    ['ADDRESS_NOT_FOUND', 'CART_ITEM_NOT_FOUND', 'CART_CHANGED', 'SELF_PURCHASE_FORBIDDEN', 'VARIANT_NOT_AVAILABLE', 'INSUFFICIENT_STOCK', 'PRICE_CHANGED', 'INVALID_ORDER_TRANSITION', 'ORDER_CANNOT_CANCEL', 'PAYMENT_STATE_CONFLICT', 'STORE_STATE_CONFLICT', 'STALE_DELIVERY_ATTEMPT', 'DELIVERY_ATTEMPT_LIMIT'].includes(error.code ?? '');
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 412 && error.code === 'EMAIL_VERIFICATION_REQUIRED') return 'Cần xác minh email trong Tài khoản trước khi đặt hàng. Đơn chưa được tạo; tải lại giỏ sau khi xác minh rồi chủ động đặt lại.';
  return error instanceof ApiError ? error.message : 'Mất kết nối hoặc hết thời gian chờ. Chưa xác định yêu cầu đã được ghi nhận hay chưa.';
}
export type Intent = { path: string; key: string; body: object };
// IDs/quantities/prices only for checkout; no JWT or recipient address content.
// Command reasons are scoped to this user's current tab, removed after success.
export function intentSlot(userId: number, task: string) { return `bckl-order-intent-v1:${userId}:${task}`; }
export function loadIntent(slot: string): Intent | null {
  const raw = sessionStorage.getItem(slot);
  if (!raw) return null;
  const value = JSON.parse(raw) as Intent;
  if (!value || typeof value.path !== 'string' || !value.path.startsWith('/') || typeof value.key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.key) || !value.body || typeof value.body !== 'object' || Array.isArray(value.body)) throw new Error('Yêu cầu đang chờ bị hỏng. Không tạo mã mới; hãy đối chiếu danh sách đơn trước.');
  return value;
}
export function initialIntent(slot: string, acceptsPath: (path: string) => boolean) {
  try {
    const pending = loadIntent(slot);
    if (pending && !acceptsPath(pending.path)) throw new Error('Yêu cầu lưu không khớp luồng hiện tại. Hãy đối chiếu trước khi tạo thao tác mới.');
    return { pending, blocked: false, error: '' };
  } catch (error) {
    return { pending: null, blocked: true, error: error instanceof Error ? error.message : 'Không đọc được yêu cầu đang chờ.' };
  }
}
export function saveIntent(slot: string, path: string, body: object): Intent {
  const value = { path, body, key: crypto.randomUUID() };
  // Storage failure must block the write: replay identity could otherwise be lost.
  try { sessionStorage.setItem(slot, JSON.stringify(value)); }
  catch { throw new ApiError('Chưa gửi yêu cầu: trình duyệt không lưu được mã chống đặt trùng. Kiểm tra dung lượng/quyền lưu trữ rồi thử lại.', 0, 'LOCAL_STORAGE_UNAVAILABLE'); }
  return value;
}
// A response from an unmounted view must not erase a newer purchase identity.
export function clearMatchingIntent(slot: string, key: string): void {
  if (loadIntent(slot)?.key === key) sessionStorage.removeItem(slot);
}
