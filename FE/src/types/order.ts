export const ORDER_STATUSES = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'PACKING',
  'READY_TO_SHIP',
  'SHIPPING',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'DELIVERY_FAILED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderScope = 'buyer' | 'seller';
export type OrderActor = 'BUYER' | 'SELLER' | 'ADMIN' | 'SYSTEM';
export interface OrderPayment {
  provider: 'COD' | 'VNPAY' | 'MOMO';
  status:
    | 'UNPAID'
    | 'PENDING'
    | 'PAID'
    | 'FAILED'
    | 'CANCELLED'
    | 'EXPIRED'
    | 'REFUND_PENDING'
    | 'REFUNDED';
  amount: string;
  currency: 'VND';
  paidAt: string | null;
}
export interface OrderSummary {
  id: number;
  orderNumber: string;
  status: OrderStatus;
  store: { id: number; name: string };
  total: string;
  payment: OrderPayment | null;
  createdAt: string;
  updatedAt: string;
}
export interface OrderList {
  items: OrderSummary[];
  nextCursor: number | null;
}
export interface OrderListQuery {
  limit?: number;
  afterId?: number;
  status?: OrderStatus;
}
export interface OrderDetail extends OrderSummary {
  shippingAddress: {
    recipientName: string;
    phone: string;
    province: string;
    district: string | null;
    ward: string;
    addressLine: string;
    postalCode: string | null;
    deliveryNote: string | null;
  };
  items: {
    id: number;
    productId: number;
    variantId: number;
    productName: string;
    sku: string;
    options: string[];
    unitPrice: string;
    quantity: number;
    lineTotal: string;
  }[];
  subtotal: string;
  shippingFee: string;
  discountTotal: string;
  cancellation: {
    cancelledBy: { type: OrderActor | null; id: number | null };
    reasonCode: string | null;
    reasonText: string | null;
    cancelledAt: string | null;
  } | null;
  timeline: {
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    actorType: OrderActor | null;
    actorId: number | null;
    reason: string | null;
    reasonCode: string | null;
    reasonText: string | null;
    restockable: boolean | null;
    receiptReference: string | null;
    trackingReference: string | null;
    deliveryAttempt: number | null;
    createdAt: string;
  }[];
}
export const PREPARATION_COMMANDS = [
  'confirm',
  'start-packing',
  'ready-to-ship',
] as const;
export type PreparationCommand = (typeof PREPARATION_COMMANDS)[number];
export interface SellerCommandReceipt {
  orderId: number;
  commandId: number;
  command: PreparationCommand;
  replayed: boolean;
  result: {
    status: OrderStatus;
    payment: OrderPayment;
    cancellation: null;
    timeline: {
      fromStatus: OrderStatus;
      toStatus: OrderStatus;
      actorType: 'SELLER';
      actorId: number;
      createdAt: string;
    }[];
  };
}
export type OrderReadState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };
