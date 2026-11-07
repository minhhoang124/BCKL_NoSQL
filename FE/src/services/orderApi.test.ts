import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL, setAccessToken, AuthSessionChangedError } from './apiClient';
import {
  orderApi,
  prepareSellerCommand,
  sendSellerCommand,
  type PreparedSellerCommand,
} from './orderApi';
import {
  validateOrderDetail,
  validateOrderList,
  validateSellerReceipt,
  preparationTransitions,
} from './orderResponse';
import {
  detailFixture,
  summaryFixture,
  receiptFixture,
  seller,
} from '../features/order-readiness/testFixtures';
import {
  ORDER_STATUSES,
  PREPARATION_COMMANDS,
  type OrderListQuery,
} from '../types/order';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
beforeEach(() => setAccessToken('seller-fixture-token', seller.id));
afterEach(() => {
  setAccessToken(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Order HTTP adapter — mocked transport, NOT live integration', () => {
  it.each(['buyer', 'seller'] as const)(
    'reads %s list/detail with scoped paths, no body and no cache',
    async (scope) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          json({ items: [summaryFixture()], nextCursor: 19 }),
        )
        .mockResolvedValueOnce(json(detailFixture()));
      vi.stubGlobal('fetch', fetch);
      await orderApi.list(scope, {
        limit: 1,
        afterId: 20,
        status: 'PENDING_CONFIRMATION',
      });
      await orderApi.detail(scope, 19);
      const prefix = scope === 'buyer' ? '/orders' : '/seller/orders';
      expect(fetch.mock.calls[0][0]).toBe(
        `${API_URL}${prefix}?limit=1&afterId=20&status=PENDING_CONFIRMATION`,
      );
      expect(fetch.mock.calls[1][0]).toBe(`${API_URL}${prefix}/19`);
      for (const [, options] of fetch.mock.calls) {
        expect(options).toMatchObject({
          cache: 'no-store',
          credentials: 'include',
        });
        expect(options.body).toBeUndefined();
        expect(options.headers.get('Authorization')).toBe(
          'Bearer seller-fixture-token',
        );
        expect(options.signal).toBeInstanceOf(AbortSignal);
      }
    },
  );
  it.each([
    { limit: 0 },
    { limit: 51 },
    { afterId: '19' },
    { afterId: 2147483648 },
    { status: 'unknown' },
    { buyerId: 9 },
  ])('rejects invalid query before HTTP: %j', async (query) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      orderApi.list('buyer', query as OrderListQuery),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN, Infinity, 2147483648])(
    'rejects invalid detail ID %s without HTTP',
    async (id) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      await expect(orderApi.detail('buyer', id)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    { query: { limit: 1 }, items: [summaryFixture(19), summaryFixture(18)] },
    { query: { afterId: 19 }, items: [summaryFixture(19)] },
    { query: { status: 'COMPLETED' }, items: [summaryFixture(19)] },
  ])(
    'rejects a page inconsistent with requested filters',
    async ({ query, items }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ items, nextCursor: null })),
      );
      await expect(
        orderApi.list('buyer', query as OrderListQuery),
      ).rejects.toMatchObject({ code: 'INVALID_ORDER_RESPONSE' });
    },
  );
  it('rejects malformed HTTP 200 before exposing detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ ...detailFixture(), buyerEmail: 'must-not-display' }),
        ),
    );
    await expect(orderApi.detail('buyer', 19)).rejects.toMatchObject({
      code: 'INVALID_ORDER_RESPONSE',
    });
  });
  it('bounds a stalled read and respects external cancellation', async () => {
    const timeout = new AbortController(),
      external = new AbortController();
    const spy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeout.signal);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url, options: RequestInit) =>
          new Promise((_yes, no) => {
            options.signal!.addEventListener(
              'abort',
              () => no(options.signal!.reason),
              { once: true },
            );
          }),
      ),
    );
    const timed = expect(orderApi.detail('buyer', 19)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    timeout.abort(new DOMException('Timeout', 'TimeoutError'));
    await timed;
    expect(spy).toHaveBeenCalledWith(15000);
    spy.mockReturnValue(new AbortController().signal);
    const cancelled = expect(
      orderApi.list('buyer', {}, external.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    external.abort();
    await cancelled;
  });
  it('keeps the same key on an explicit replay and never replaces GET detail with a receipt', async () => {
    const replay = { ...receiptFixture(), replayed: true };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(receiptFixture()))
      .mockResolvedValueOnce(json(replay))
      .mockResolvedValueOnce(json({ ...detailFixture(), status: 'PACKING' }));
    vi.stubGlobal('fetch', fetch);
    const intent = prepareSellerCommand(19, 'confirm', seller.id);
    expect(Object.isFrozen(intent)).toBe(true);
    await sendSellerCommand(intent);
    await sendSellerCommand(intent);
    const latest = await orderApi.detail('seller', 19);
    expect(latest.status).toBe('PACKING');
    for (const [url, options] of fetch.mock.calls.slice(0, 2)) {
      expect(url).toBe(`${API_URL}/seller/orders/19/confirm`);
      expect(options.body).toBe('{}');
      expect(options.method).toBe('POST');
      expect(options.headers.get('Idempotency-Key')).toBe(
        intent.idempotencyKey,
      );
    }
  });
  it.each([401, 409, 429, 500])(
    'does not auto replay/refresh a command on HTTP %s',
    async (status) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          json({ message: 'safe', code: 'COMMAND_ERROR' }, status),
        );
      vi.stubGlobal('fetch', fetch);
      await expect(
        sendSellerCommand(prepareSellerCommand(19, 'confirm', seller.id)),
      ).rejects.toMatchObject({ status });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('does not retry a timed-out write; the caller retains the same intent', async () => {
    const timeout = new AbortController();
    const spy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeout.signal);
    const fetch = vi.fn().mockImplementation(
      (_url, options: RequestInit) =>
        new Promise((_yes, no) => {
          options.signal!.addEventListener(
            'abort',
            () => no(options.signal!.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const intent = prepareSellerCommand(19, 'confirm', seller.id);
    const outcome = expect(sendSellerCommand(intent)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    timeout.abort(new DOMException('Timeout', 'TimeoutError'));
    await outcome;
    expect(spy).toHaveBeenCalledWith(30000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(intent.idempotencyKey).toBeTruthy();
  });
  it('rejects forged intents and old-session intents before HTTP', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const intent = prepareSellerCommand(19, 'confirm', seller.id);
    await expect(
      sendSellerCommand({ ...intent } as PreparedSellerCommand),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    setAccessToken('other', 9);
    await expect(sendSellerCommand(intent)).rejects.toBeInstanceOf(
      AuthSessionChangedError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Order response contracts derived from local Backend DTOs', () => {
  it.each(ORDER_STATUSES)(
    'accepts canonical status %s and nullable legacy payment',
    (status) => {
      expect(
        validateOrderDetail({ ...detailFixture(), status, payment: null }, 19)
          .status,
      ).toBe(status);
    },
  );
  it('accepts nullable legacy audit and same-timestamp events', () => {
    const d = detailFixture();
    d.timeline[0].actorType = null;
    d.timeline[0].actorId = null;
    d.timeline.push({ ...d.timeline[0] });
    d.cancellation = {
      cancelledBy: { type: null, id: null },
      reasonCode: null,
      reasonText: null,
      cancelledAt: null,
    };
    expect(validateOrderDetail(d, 19)).toEqual(d);
  });
  it.each([
    [
      'extra envelope',
      (d: any) => {
        d.receipt = {};
      },
    ],
    [
      'extra item',
      (d: any) => {
        d.items[0].currentProduct = {};
      },
    ],
    [
      'extra address',
      (d: any) => {
        d.shippingAddress.userId = 7;
      },
    ],
    [
      'missing field',
      (d: any) => {
        delete d.subtotal;
      },
    ],
    [
      'number money',
      (d: any) => {
        d.total = 20000;
      },
    ],
    [
      'fraction money',
      (d: any) => {
        d.total = '20000.01';
      },
    ],
    [
      'large money',
      (d: any) => {
        d.total = '1000000000000.00';
      },
    ],
    [
      'bad date',
      (d: any) => {
        d.createdAt = '2026-02-30T00:00:00.000Z';
      },
    ],
    [
      'string ID',
      (d: any) => {
        d.id = '19';
      },
    ],
    [
      'bad enum',
      (d: any) => {
        d.status = 'DONE';
      },
    ],
    [
      'bad provider',
      (d: any) => {
        d.payment.provider = {};
      },
    ],
    [
      'non-finite quantity',
      (d: any) => {
        d.items[0].quantity = Infinity;
      },
    ],
    [
      'duplicate item',
      (d: any) => {
        d.items.push({ ...d.items[0] });
      },
    ],
    [
      'bad option',
      (d: any) => {
        d.items[0].options = [{}];
      },
    ],
    [
      'invalid attempt',
      (d: any) => {
        d.timeline[0].deliveryAttempt = 5;
      },
    ],
    [
      'bad actor',
      (d: any) => {
        d.timeline[0].actorType = 'OWNER';
      },
    ],
    [
      'reverse history',
      (d: any) => {
        d.timeline.push({
          ...d.timeline[0],
          createdAt: '2026-10-13T01:00:00.000Z',
        });
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const d = detailFixture();
    mutate(d);
    expect(() => validateOrderDetail(d, 19)).toThrow();
  });
  it('rejects a different order identity', () =>
    expect(() => validateOrderDetail(detailFixture(20), 19)).toThrow());
  it.each([
    { items: [summaryFixture(), summaryFixture()], nextCursor: null },
    { items: [summaryFixture(18), summaryFixture(19)], nextCursor: null },
    { items: [], nextCursor: 19 },
    { items: [summaryFixture()], nextCursor: 18 },
    { items: [summaryFixture()], nextCursor: null, secret: 'extra' },
  ])('rejects malformed list/cursor %j', (page) =>
    expect(() => validateOrderList(page)).toThrow(),
  );
  it.each(PREPARATION_COMMANDS)(
    'accepts %s receipt but requires exact identity/transition/actor',
    (command) => {
      const r = receiptFixture();
      const [from, to] = preparationTransitions[command];
      r.command = command;
      r.result.status = to;
      r.result.timeline[0].fromStatus = from;
      r.result.timeline[0].toStatus = to;
      expect(validateSellerReceipt(r, 19, command, seller.id)).toEqual(r);
      expect(() => validateSellerReceipt(r, 19, command, 9)).toThrow();
      expect(() =>
        validateSellerReceipt({ ...r, orderId: 20 }, 19, command, seller.id),
      ).toThrow();
      expect(() =>
        validateSellerReceipt({ ...r, extra: true }, 19, command, seller.id),
      ).toThrow();
    },
  );
  it('accepts order list with itemPreview projection conforming to BE-UX-01', () => {
    const orderWithPreview = {
      ...summaryFixture(19),
      itemPreview: [
        {
          orderItemId: 501,
          productId: 88,
          variantId: 301,
          productName: 'Tai nghe X',
          options: ['Đen'],
          quantity: 2,
          unitPrice: '20000.00',
          lineTotal: '40000.00',
          imageUrl: '/uploads/products/88/main.webp',
        },
      ],
      itemCount: 1,
      totalQuantity: 2,
      hasMoreItems: false,
    };
    const validated = validateOrderList({ items: [orderWithPreview], nextCursor: null });
    expect(validated.items[0].itemPreview).toHaveLength(1);
    expect(validated.items[0].itemPreview?.[0].productName).toBe('Tai nghe X');
  });

  it('accepts order detail with items[].imageUrl conforming to BE-UX-01', () => {
    const detail = detailFixture(19);
    detail.items[0] = {
      ...detail.items[0],
      imageUrl: '/uploads/products/88/main.webp',
    } as any;
    const validated = validateOrderDetail(detail, 19);
    expect(validated.items[0].imageUrl).toBe('/uploads/products/88/main.webp');
  });

});
