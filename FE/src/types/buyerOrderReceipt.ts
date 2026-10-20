/** Existing merged Buyer APIs only. No resolver/journal v2 contract here. */
export type BuyerCancellationReason = Readonly<{
  reasonCode: 'CHANGED_MIND' | 'OTHER';
  reasonText: string;
}>;

type Receipt<C extends string, R> = {
  orderId: number;
  commandId: number;
  command: C;
  replayed: boolean;
  result: R;
};

export type BuyerCancellationReceipt = Receipt<'cancel', {
  status: 'CANCELLED';
  payment: {
    provider: 'COD'; status: 'CANCELLED'; amount: string;
    currency: 'VND'; paidAt: null;
  };
  cancellation: {
    cancelledBy: { type: 'BUYER'; id: number };
    reasonCode: BuyerCancellationReason['reasonCode'];
    reasonText: string;
    cancelledAt: string;
  };
  timeline: [{
    fromStatus: 'PENDING_CONFIRMATION'; toStatus: 'CANCELLED';
    actorType: 'BUYER'; actorId: number;
    reasonCode: BuyerCancellationReason['reasonCode']; reasonText: string;
    createdAt: string;
  }];
}>;

export type BuyerCompletionReceipt = Receipt<'complete', {
  status: 'COMPLETED';
  deliveredAt: string;
  completedAt: string;
  payment: {
    provider: 'COD' | 'VNPAY' | 'MOMO'; status: 'PAID'; amount: string;
    currency: 'VND'; paidAt: string;
  };
  timeline: [{
    fromStatus: 'DELIVERED'; toStatus: 'COMPLETED';
    actorType: 'BUYER'; actorId: number; createdAt: string;
  }];
}>;

/** Capture from the verified actor and immutable Order total before invocation.
 * Never take these expectations from the response being validated.
 */
export type BuyerReceiptExpectation = Readonly<{
  orderId: number;
  actorId: number;
  total: string;
}>;
