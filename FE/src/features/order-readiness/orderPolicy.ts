import type { User } from '../../types/auth';
import type {
  OrderDetail,
  OrderScope,
  OrderStatus,
  PreparationCommand,
} from '../../types/order';
import { validOrderMoney } from '../../services/orderResponse';
import { ApiError, AuthSessionChangedError } from '../../services/apiClient';

export const orderStatusLabels: Record<OrderStatus, string> = {
  PENDING_CONFIRMATION: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  PACKING: 'Đang đóng gói',
  READY_TO_SHIP: 'Chờ bàn giao vận chuyển',
  SHIPPING: 'Đang giao',
  DELIVERY_FAILED: 'Giao không thành công',
  DELIVERED: 'Đã giao, chờ hoàn tất',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
};
export function orderMoney(value: string) {
  if (!validOrderMoney(value)) return 'Chưa có số tiền hợp lệ';
  return `${new Intl.NumberFormat('vi-VN').format(BigInt(value.slice(0, -3)))} đ`;
}
export function orderReadError(error: unknown) {
  if (error instanceof AuthSessionChangedError)
    return 'Phiên đăng nhập đã đổi. Vui lòng tải đơn của tài khoản hiện tại.';
  if (error instanceof ApiError) {
    if (error.status === 401)
      return 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.';
    if (error.status === 403) return 'Bạn không có quyền xem đơn hàng này.';
    if (error.status === 404)
      return 'Không tìm thấy đơn hàng hoặc bạn không có quyền truy cập.';
    if (error.status === 429)
      return 'Bạn đang tải đơn quá nhanh. Hãy chờ một chút rồi thử lại.';
    if (error.code === 'INVALID_ORDER_RESPONSE')
      return 'Dữ liệu Order API không hợp lệ; chưa hiển thị nội dung đơn.';
  }
  return 'Chưa tải được đơn hàng. Kiểm tra kết nối rồi thử tải lại.';
}
export interface OrderActionContext {
  closingConnected?: boolean;
  scope: OrderScope;
  user: User | null;
  store?: { id: number; status: string };
  fresh: boolean;
  busy: boolean;
  outcomeUnknown: boolean;
}
export interface OrderAction {
  id: PreparationCommand | 'cancel' | 'confirm-returned' | 'complete';
  label: string;
  enabled: boolean;
  reason?: string;
}
/** Display affordances only. Backend rechecks role/ownership/state/payment under DB locks. */
export function orderActions(
  order: OrderDetail,
  context: OrderActionContext,
): OrderAction[] {
  const next: Partial<Record<OrderStatus, PreparationCommand>> = {
    PENDING_CONFIRMATION: 'confirm',
    CONFIRMED: 'start-packing',
    PACKING: 'ready-to-ship',
  };
  const labels: Record<PreparationCommand, string> = {
    confirm: 'Xác nhận đơn',
    'start-packing': 'Bắt đầu đóng gói',
    'ready-to-ship': 'Sẵn sàng bàn giao',
  };
  const payment = order.payment;
  const paid =
    payment !== null &&
    payment.currency === 'VND' &&
    payment.amount === order.total &&
    ((payment.provider === 'COD' &&
      payment.status === 'UNPAID' &&
      payment.paidAt === null) ||
      (payment.provider !== 'COD' &&
        payment.status === 'PAID' &&
        payment.paidAt !== null));
  const common =
    context.user?.isActive &&
    !context.busy &&
    !context.outcomeUnknown &&
    context.fresh;
  const result: OrderAction[] = [];
  if (context.scope === 'seller') {
    const command = next[order.status];
    if (command) {
      const eligible = Boolean(
        common &&
        context.user?.role === 'SELLER' &&
        context.store?.id === order.store.id &&
        ['ACTIVE', 'SUSPENDED'].includes(context.store.status) &&
        paid,
      );
      result.push({
        id: command,
        label: labels[command],
        enabled: eligible,
        reason: eligible
          ? undefined
          : 'Cần quyền Store, dữ liệu mới và thanh toán phù hợp; không được còn yêu cầu chưa rõ kết quả.',
      });
    }
    if (!context.closingConnected && ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(order.status))
      result.push({
        id: 'cancel',
        label: 'Hủy đơn',
        enabled: false,
        reason: 'Chưa nối API hủy đơn; cần lý do và mã chống xử lý trùng.',
      });
    if (!context.closingConnected && order.status === 'DELIVERY_FAILED')
      result.push({
        id: 'confirm-returned',
        label: 'Xác nhận hàng quay về',
        enabled: false,
        reason:
          'Chờ tích hợp API và bằng chứng nhận hàng; giao thất bại chưa có nghĩa đã hoàn kho.',
      });
  } else {
    if (order.status === 'PENDING_CONFIRMATION')
      result.push({
        id: 'cancel',
        label: 'Hủy đơn',
        enabled: false,
        reason: 'Chưa nối API hủy đơn; không thay trạng thái bằng dữ liệu mẫu.',
      });
    if (order.status === 'DELIVERED')
      result.push({
        id: 'complete',
        label: 'Xác nhận đã nhận hàng',
        enabled: false,
        reason:
          'Chờ tích hợp API hoàn tất; chưa tự chuyển DELIVERED thành COMPLETED.',
      });
  }
  return result;
}
