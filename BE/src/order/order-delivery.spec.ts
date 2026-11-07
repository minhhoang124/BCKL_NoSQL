import { HttpException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import {
  deliveryDecision,
  deliveryTransitions,
  prepareDeliveryCommand,
  type DeliveryCommand,
} from './order-delivery-request.js';
import { validateDeliveryResult } from './order-delivery-receipt.js';
import { OrderDeliveryRateGuard } from './order-delivery-rate.guard.js';
import { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';

const key = 'delivery_command_key_123';
const prepare = (
  body: unknown,
  command: DeliveryCommand = 'ship',
  k: unknown = key,
) => prepareDeliveryCommand(1, 2, command, k, body);
const state = {
  status: OrderStatus.SHIPPING,
  currentDeliveryAttempt: 2,
  retryCount: 1,
  currentAttempt: { deliveryAttempt: 2, trackingReference: 'SAME-WAYBILL' },
};
const failed = {
  deliveryAttempt: 2,
  trackingReference: 'SAME-WAYBILL',
  reasonCode: 'OTHER' as const,
  reasonText: 'Unavailable',
};
function code(run: () => unknown, expected: string) {
  try {
    run();
    throw new Error('Expected failure');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getResponse()).toMatchObject({
      code: expected,
    });
  }
}
describe('Delivery request/policy/receipt boundary', () => {
  it('canonical hash ignores input ordering/trim but includes attempt/reason/command/order', () => {
    const a = prepare(failed, 'delivery-failed');
    expect(
      prepare(
        {
          reasonText: ' Unavailable ',
          trackingReference: ' SAME-WAYBILL ',
          reasonCode: 'OTHER',
          deliveryAttempt: 2,
        },
        'delivery-failed',
      ).requestHash,
    ).toBe(a.requestHash);
    for (const body of [
      { ...failed, deliveryAttempt: 1 },
      { ...failed, reasonText: 'Other' },
      { ...failed, reasonCode: 'ADDRESS_ISSUE' },
      { ...failed, trackingReference: 'X' },
    ])
      expect(prepare(body, 'delivery-failed').requestHash).not.toBe(
        a.requestHash,
      );
    expect(
      prepareDeliveryCommand(1, 3, 'delivery-failed', key, failed).requestHash,
    ).not.toBe(a.requestHash);
    expect(
      prepareDeliveryCommand(2, 2, 'delivery-failed', key, failed).requestHash,
    ).not.toBe(a.requestHash);
    expect(prepare({ trackingReference: 'X' }).requestHash).not.toBe(
      prepare({ trackingReference: 'X' }, 'retry-delivery').requestHash,
    );
    expect(
      prepare({ trackingReference: 'X' }, 'ship', key + '_new').requestHash,
    ).toBe(prepare({ trackingReference: 'X' }).requestHash);
    expect(Object.isFrozen(a.body)).toBe(true);
  });
  it.each([
    null,
    [],
    '',
    1,
    {},
    { trackingReference: '' },
    { trackingReference: ' '.repeat(5) },
    { trackingReference: 'x'.repeat(101) },
    { trackingReference: 1 },
    { trackingReference: 'X', actorId: 3 },
    { trackingReference: 'X', status: 'DELIVERED' },
    { trackingReference: 'X\u0000' },
  ])('rejects malformed ship body %#', (body) =>
    code(() => prepare(body), 'VALIDATION_ERROR'),
  );
  it.each([
    1,
    '',
    'short',
    'x'.repeat(129),
    'x'.repeat(16) + '!',
    ['x'.repeat(16)],
  ])('rejects key %#', (k) =>
    code(
      () => prepare({ trackingReference: 'X' }, 'ship', k),
      'VALIDATION_ERROR',
    ),
  );
  it('requires key', () =>
    code(
      () => prepare({ trackingReference: 'X' }, 'ship', null),
      'IDEMPOTENCY_KEY_REQUIRED',
    ));
  it.each(['2', 0, 5, 1.5, NaN, Infinity, null])(
    'requires numeric attempt 1..4 %#',
    (n) =>
      code(
        () => prepare({ ...failed, deliveryAttempt: n }, 'delivery-failed'),
        'VALIDATION_ERROR',
      ),
  );
  it.each([
    { ...failed, reasonCode: 'LOST' },
    { ...failed, reasonText: '' },
    { ...failed, reasonText: 'x'.repeat(501) },
    { ...failed, restockable: true },
  ])('rejects failed reason/extra %#', (body) =>
    code(() => prepare(body, 'delivery-failed'), 'VALIDATION_ERROR'),
  );
  for (const command of Object.keys(deliveryTransitions) as DeliveryCommand[]) {
    it.each(
      Object.values(OrderStatus).filter(
        (s) => s !== deliveryTransitions[command][0],
      ),
    )(command + ' rejects source %s', (status) => {
      const order =
        command === 'ship'
          ? {
              status,
              currentDeliveryAttempt: null,
              retryCount: null,
              currentAttempt: null,
            }
          : { ...state, status };
      code(
        () =>
          deliveryDecision(
            command,
            command === 'delivery-failed'
              ? failed
              : {
                  trackingReference: 'SAME-WAYBILL',
                  ...(command === 'mark-delivered'
                    ? { deliveryAttempt: 2 }
                    : {}),
                },
            order,
          ),
        'INVALID_ORDER_TRANSITION',
      );
    });
  }
  it('ship initializes 1/0, retry accepts third re-delivery but not fourth', () => {
    expect(
      deliveryDecision(
        'ship',
        { trackingReference: 'X' },
        {
          status: 'READY_TO_SHIP',
          currentDeliveryAttempt: null,
          retryCount: null,
          currentAttempt: null,
        },
      ),
    ).toMatchObject({ deliveryAttempt: 1, retryCount: 0 });
    expect(
      deliveryDecision(
        'retry-delivery',
        { trackingReference: 'SAME-WAYBILL' },
        {
          ...state,
          status: 'DELIVERY_FAILED',
          currentDeliveryAttempt: 3,
          retryCount: 2,
          currentAttempt: {
            deliveryAttempt: 3,
            trackingReference: 'SAME-WAYBILL',
          },
        },
      ),
    ).toMatchObject({ deliveryAttempt: 4, retryCount: 3 });
    code(
      () =>
        deliveryDecision(
          'retry-delivery',
          { trackingReference: 'SAME-WAYBILL' },
          {
            ...state,
            status: 'DELIVERY_FAILED',
            currentDeliveryAttempt: 4,
            retryCount: 3,
            currentAttempt: {
              deliveryAttempt: 4,
              trackingReference: 'SAME-WAYBILL',
            },
          },
        ),
      'DELIVERY_ATTEMPT_LIMIT',
    );
  });
  it('stale attempt/tracking rejected even when the waybill is reused', () => {
    code(
      () =>
        deliveryDecision(
          'delivery-failed',
          { ...failed, deliveryAttempt: 1 },
          state,
        ),
      'STALE_DELIVERY_ATTEMPT',
    );
    code(
      () =>
        deliveryDecision(
          'mark-delivered',
          { deliveryAttempt: 2, trackingReference: 'WRONG' },
          state,
        ),
      'STALE_DELIVERY_ATTEMPT',
    );
  });
  it('legacy identity remains fail-closed, never guesses history', () =>
    code(
      () =>
        deliveryDecision('delivery-failed', failed, {
          ...state,
          currentDeliveryAttempt: null,
          retryCount: null,
          currentAttempt: null,
        }),
      'DELIVERY_STATE_CONFLICT',
    ));
  const time = '2026-10-10T00:00:00.000Z';
  const receipt = () => ({
    status: 'DELIVERY_FAILED',
    delivery: {
      deliveryAttempt: 2,
      retryCount: 1,
      trackingReference: 'SAME-WAYBILL',
    },
    deliveredAt: null,
    payment: {
      provider: 'COD',
      status: 'UNPAID',
      amount: '10000.00',
      currency: 'VND',
      paidAt: null,
    },
    cancellation: null,
    timeline: [
      {
        fromStatus: 'SHIPPING',
        toStatus: 'DELIVERY_FAILED',
        actorType: 'ADMIN',
        actorId: 1,
        createdAt: time,
        ...failed,
      },
    ],
  });
  it('receipt allowlist returns a fresh projection', () => {
    const raw = receipt();
    expect(validateDeliveryResult(raw, 'delivery-failed', 1, failed)).toEqual(
      raw,
    );
    expect(validateDeliveryResult(raw, 'delivery-failed', 1, failed)).not.toBe(
      raw,
    );
  });
  it.each([
    (r: any) => {
      r.secret = 'X';
    },
    (r: any) => {
      r.delivery.retryCount = 3;
    },
    (r: any) => {
      r.payment.amount = 10000;
    },
    (r: any) => {
      r.payment.paidAt = time;
    },
    (r: any) => {
      r.timeline[0].actorId = 2;
    },
    (r: any) => {
      r.timeline[0].reasonText = 'changed';
    },
    (r: any) => {
      r.delivery.deliveryAttempt = 1;
    },
    (r: any) => {
      r.timeline[0].secret = 'X';
    },
    (r: any) => {
      r.timeline[0].createdAt = 'bad';
    },
  ])('rejects corrupt receipt %#', (mutate) => {
    const raw = receipt();
    mutate(raw);
    code(
      () => validateDeliveryResult(raw, 'delivery-failed', 1, failed),
      'INTERNAL_ERROR',
    );
  });
  it('all delivery commands share ingress quota with retry-after', () => {
    const guard = new OrderDeliveryRateGuard(
      new ConfigService({ ORDER_COMMAND_RATE_PER_MINUTE: '1' }),
    );
    let retry = '';
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 1 } }),
        getResponse: () => ({
          setHeader: (_: string, v: string) => {
            retry = v;
          },
        }),
      }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(context)).toBe(true);
    code(() => guard.canActivate(context), 'RATE_LIMITED');
    expect(Number(retry)).toBeGreaterThan(0);
  });
});
