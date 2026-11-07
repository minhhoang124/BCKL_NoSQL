// Test fixtures only: not PostgreSQL records and not evidence of real transactions.
import type { User } from '../../types/auth';
import type {
  OrderDetail,
  OrderSummary,
  SellerCommandReceipt,
} from '../../types/order';

export const buyer: User = {
  id: 7,
  email: 'buyer@example.test',
  fullName: 'Buyer fixture',
  role: 'USER',
  isActive: true,
};
export const seller: User = {
  id: 8,
  email: 'seller@example.test',
  fullName: 'Seller fixture',
  role: 'SELLER',
  isActive: true,
};
export const createdAt = '2026-10-14T01:00:00.000Z';
export function detailFixture(id = 19): OrderDetail {
  return {
    id,
    orderNumber: `FIXTURE-${id}`,
    status: 'PENDING_CONFIRMATION',
    store: { id: 4, name: 'Store fixture' },
    total: '20000.00',
    subtotal: '20000.00',
    shippingFee: '0.00',
    discountTotal: '0.00',
    payment: {
      provider: 'COD',
      status: 'UNPAID',
      amount: '20000.00',
      currency: 'VND',
      paidAt: null,
    },
    shippingAddress: {
      recipientName: 'Tên đã lưu',
      phone: '0900000000',
      province: 'Tỉnh fixture',
      district: null,
      ward: 'Phường fixture',
      addressLine: 'Địa chỉ đã lưu',
      postalCode: null,
      deliveryNote: null,
    },
    items: [
      {
        id: 1,
        productId: 2,
        variantId: 3,
        productName: 'Tên sản phẩm lúc mua',
        sku: 'SKU-SNAPSHOT',
        options: ['Đen', 'M'],
        unitPrice: '10000.00',
        quantity: 2,
        lineTotal: '20000.00',
      },
    ],
    cancellation: null,
    timeline: [
      {
        fromStatus: null,
        toStatus: 'PENDING_CONFIRMATION',
        actorType: 'BUYER',
        actorId: 7,
        reason: null,
        reasonCode: null,
        reasonText: null,
        restockable: null,
        receiptReference: null,
        trackingReference: null,
        deliveryAttempt: null,
        createdAt,
      },
    ],
    createdAt,
    updatedAt: createdAt,
  };
}
export function summaryFixture(id = 19): OrderSummary {
  const { orderNumber, status, store, total, payment, createdAt, updatedAt } =
    detailFixture(id);
  return {
    id,
    orderNumber,
    status,
    store,
    total,
    payment,
    createdAt,
    updatedAt,
  };
}
export function receiptFixture(): SellerCommandReceipt {
  return {
    orderId: 19,
    commandId: 12,
    command: 'confirm',
    replayed: false,
    result: {
      status: 'CONFIRMED',
      payment: detailFixture().payment!,
      cancellation: null,
      timeline: [
        {
          fromStatus: 'PENDING_CONFIRMATION',
          toStatus: 'CONFIRMED',
          actorType: 'SELLER',
          actorId: seller.id,
          createdAt,
        },
      ],
    },
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
