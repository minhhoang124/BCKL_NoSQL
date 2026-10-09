import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  checkedLineTotal,
  checkedMoney,
  checkedSubtotal,
  parseExpectedUnitPrice,
} from './checkout-money.js';
import {
  buildCheckoutRequestV1,
  normalizeCheckoutRequest,
  validateCheckoutKey,
} from './checkout-request.js';
import { validateCheckoutReceiptV1 } from './checkout-receipt.js';

const request = () => ({
  addressId: 12,
  paymentProvider: 'COD',
  items: [{ variantId: 125, quantity: 2, expectedUnitPrice: '1290000.00' }],
});
const receipt = () => ({
  checkoutId: 42,
  status: 'COMPLETED',
  orders: [
    {
      id: 101,
      orderNumber: 'ORD-test-101',
      storeId: 8,
      status: 'PENDING_CONFIRMATION',
      payment: {
        provider: 'COD',
        status: 'UNPAID',
        amount: '2580000.00',
        currency: 'VND',
      },
      total: '2580000.00',
    },
  ],
});

function expectCode(
  fn: () => unknown,
  status: number,
  code: string,
  reason?: string,
) {
  expect.assertions(reason ? 4 : 3);
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(status);
    expect(exception.getResponse()).toMatchObject({ code });
    if (reason)
      expect(exception.getResponse()).toMatchObject({ details: { reason } });
  }
}

describe('Checkout v1 money arithmetic (foundation only)', () => {
  it.each(['1', '1.00', '999999999999', '999999999999.00'])(
    'normalizes %s',
    (value) => {
      expect(parseExpectedUnitPrice(value).toFixed(2)).toBe(
        value.includes('.') ? value : `${value}.00`,
      );
    },
  );
  it.each([
    0,
    1,
    true,
    null,
    undefined,
    '0',
    '0.00',
    '01',
    ' 1',
    '1 ',
    '-1',
    '1.0',
    '1.50',
    '1e3',
    'NaN',
    'Infinity',
    '1\n',
  ])('rejects invalid money %s', (value) => {
    expectCode(() => parseExpectedUnitPrice(value), 400, 'VALIDATION_ERROR');
  });
  it('reports bounds distinctly without exposing input', () => {
    expectCode(
      () => parseExpectedUnitPrice('1000000000000.00'),
      400,
      'VALIDATION_ERROR',
      'MONEY_LIMIT_EXCEEDED',
    );
  });
  it('multiplies and sums whole VND exactly', () => {
    const line = checkedLineTotal(new Prisma.Decimal('10000000001'), 99);
    expect(line.toFixed(2)).toBe('990000000099.00');
    expect(checkedSubtotal([line, new Prisma.Decimal(1)]).toFixed(2)).toBe(
      '990000000100.00',
    );
    expect(checkedSubtotal([]).toFixed(2)).toBe('0.00');
  });
  it.each(['-1', '0.1', 'NaN', 'Infinity'])(
    'rejects non-whole internal amounts %s',
    (value) => {
      expectCode(
        () => checkedMoney(new Prisma.Decimal(value)),
        400,
        'VALIDATION_ERROR',
      );
    },
  );
  it('rejects line overflow before database write', () => {
    expectCode(
      () => checkedLineTotal(new Prisma.Decimal('999999999999'), 2),
      400,
      'VALIDATION_ERROR',
      'MONEY_LIMIT_EXCEEDED',
    );
  });
  it('rejects aggregate overflow even when every Store total fits', () => {
    expectCode(
      () =>
        checkedSubtotal([
          new Prisma.Decimal('500000000000'),
          new Prisma.Decimal('500000000000'),
        ]),
      400,
      'VALIDATION_ERROR',
      'MONEY_LIMIT_EXCEEDED',
    );
  });
});

describe('Checkout v1 request normalization and hash', () => {
  it('matches a fixed independently calculated canonical SHA-256 vector', () => {
    expect(buildCheckoutRequestV1(7, request()).requestHash).toBe(
      'd74a5d8c5fe267a21e8c7e48be45dd20686a6f85fafe79d4421ea4a15537928d',
    );
    expect(buildCheckoutRequestV1(7, request()).hashVersion).toBe(1);
  });
  it('ignores input key/item ordering and equivalent permitted money formats without mutating input', () => {
    const original = {
      ...request(),
      items: [
        { variantId: 200, quantity: 1, expectedUnitPrice: '10' },
        { variantId: 125, quantity: 2, expectedUnitPrice: '1290000' },
      ],
    };
    const before = structuredClone(original);
    const permuted = {
      items: [...original.items].reverse().map((item) => ({
        expectedUnitPrice: `${item.expectedUnitPrice}.00`,
        quantity: item.quantity,
        variantId: item.variantId,
      })),
      paymentProvider: 'COD',
      addressId: 12,
    };
    expect(buildCheckoutRequestV1(7, original).requestHash).toBe(
      buildCheckoutRequestV1(7, permuted).requestHash,
    );
    expect(original).toEqual(before);
  });
  it('changes the hash with buyer, address, selected SKU, quantity or expected price', () => {
    const baseline = buildCheckoutRequestV1(7, request()).requestHash;
    const changes = [
      buildCheckoutRequestV1(8, request()),
      buildCheckoutRequestV1(7, { ...request(), addressId: 13 }),
      buildCheckoutRequestV1(7, {
        ...request(),
        items: [{ ...request().items[0], variantId: 126 }],
      }),
      buildCheckoutRequestV1(7, {
        ...request(),
        items: [{ ...request().items[0], quantity: 3 }],
      }),
      buildCheckoutRequestV1(7, {
        ...request(),
        items: [{ ...request().items[0], expectedUnitPrice: '1' }],
      }),
    ];
    expect(changes.every((value) => value.requestHash !== baseline)).toBe(true);
    expect(new Set(changes.map((value) => value.requestHash)).size).toBe(5);
  });
  it('rejects empty and oversized requests; does not truncate', () => {
    expectCode(
      () => normalizeCheckoutRequest({ ...request(), items: [] }),
      400,
      'EMPTY_CHECKOUT',
    );
  });
  it('accepts 50 unique lines and rejects 51', () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      variantId: index + 1,
      quantity: 99,
      expectedUnitPrice: '1',
    }));
    expect(
      normalizeCheckoutRequest({ ...request(), items }).items,
    ).toHaveLength(50);
    expect(() =>
      normalizeCheckoutRequest({
        ...request(),
        items: [...items, { ...items[0], variantId: 51 }],
      }),
    ).toThrow(HttpException);
  });
  it.each([0, -1, 2147483648, 1.5, '12', null, NaN, Infinity])(
    'rejects invalid address ID %s',
    (addressId) => {
      expectCode(
        () => normalizeCheckoutRequest({ ...request(), addressId }),
        400,
        'VALIDATION_ERROR',
      );
    },
  );
  it.each([0, -1, 100, 1.5, '2', null, NaN, Infinity])(
    'rejects invalid quantity %s',
    (quantity) => {
      expectCode(
        () =>
          normalizeCheckoutRequest({
            ...request(),
            items: [{ ...request().items[0], quantity }],
          }),
        400,
        'VALIDATION_ERROR',
      );
    },
  );
  it.each(['VNPAY', 'MOMO', null, 'cod'])(
    'rejects unsupported provider %s',
    (paymentProvider) => {
      expectCode(
        () => normalizeCheckoutRequest({ ...request(), paymentProvider }),
        400,
        'VALIDATION_ERROR',
      );
    },
  );
  it('rejects duplicates, nested/top-level extra fields and missing fields', () => {
    const invalid = [
      { ...request(), items: [request().items[0], request().items[0]] },
      { ...request(), buyerId: 7 },
      { ...request(), items: [{ ...request().items[0], storeId: 8 }] },
      { addressId: 12, items: request().items },
      { ...request(), items: [{ variantId: 125, quantity: 2 }] },
      null,
      [],
    ];
    for (const value of invalid)
      expect(() => normalizeCheckoutRequest(value)).toThrow(HttpException);
    expect(() => buildCheckoutRequestV1(0, request())).toThrow(HttpException);
    expect(() =>
      normalizeCheckoutRequest({
        ...request(),
        items: [{ ...request().items[0], variantId: '125' }],
      }),
    ).toThrow(HttpException);
  });
  it('validates a case-sensitive ASCII header without trimming', () => {
    expect(validateCheckoutKey('A'.repeat(16))).toBe('A'.repeat(16));
    expect(validateCheckoutKey('a-_'.repeat(42))).toBe('a-_'.repeat(42));
    for (const key of [
      '',
      'a'.repeat(15),
      'a'.repeat(129),
      'a'.repeat(16) + ' ',
      'a'.repeat(16) + '\n',
      'é'.repeat(16),
      123,
    ])
      expect(() => validateCheckoutKey(key)).toThrow(HttpException);
  });
});

describe('Checkout stored receipt v1 allowlist', () => {
  it('returns a fresh copy of only the stored initial receipt', () => {
    const stored = receipt();
    const result = validateCheckoutReceiptV1(stored, 42);
    expect(result).toEqual(stored);
    expect(result).not.toBe(stored);
    result.orders[0].payment.amount = '1.00';
    expect(stored.orders[0].payment.amount).toBe('2580000.00');
  });
  it('rejects malformed, extra, live-state or foreign receipts with a safe server error', () => {
    const samples = [
      null,
      [],
      {},
      { ...receipt(), replayed: true },
      { ...receipt(), checkoutId: 43 },
      { ...receipt(), orders: [] },
      { ...receipt(), status: 'PENDING' },
      {
        ...receipt(),
        orders: [{ ...receipt().orders[0], address: 'private' }],
      },
      {
        ...receipt(),
        orders: [{ ...receipt().orders[0], status: 'DELIVERED' }],
      },
      { ...receipt(), orders: [{ ...receipt().orders[0], total: '1' }] },
      { ...receipt(), orders: [{ ...receipt().orders[0], total: '0.00' }] },
      { ...receipt(), orders: [{ ...receipt().orders[0], id: '101' }] },
      {
        ...receipt(),
        orders: [
          {
            ...receipt().orders[0],
            payment: { ...receipt().orders[0].payment, status: 'PAID' },
          },
        ],
      },
      {
        ...receipt(),
        orders: [
          {
            ...receipt().orders[0],
            payment: { ...receipt().orders[0].payment, amount: '1.00' },
          },
        ],
      },
      {
        ...receipt(),
        orders: [
          {
            ...receipt().orders[0],
            payment: { ...receipt().orders[0].payment, secret: 'hidden' },
          },
        ],
      },
    ];
    for (const sample of samples) {
      try {
        validateCheckoutReceiptV1(sample, 42);
        throw new Error('must reject');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const exception = error as HttpException;
        expect(exception.getStatus()).toBe(500);
        expect(exception.getResponse()).toEqual({
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: 'Không thể đọc kết quả đặt hàng đã lưu.',
        });
      }
    }
  });
  it('requires distinct IDs/numbers, ascending unique Store and bounded combined totals', () => {
    const first = receipt().orders[0];
    const second = {
      ...first,
      id: 102,
      orderNumber: 'ORD-test-102',
      storeId: 9,
      payment: { ...first.payment },
    };
    expect(
      validateCheckoutReceiptV1({ ...receipt(), orders: [first, second] }, 42)
        .orders,
    ).toHaveLength(2);
    for (const orders of [
      [second, first],
      [first, first],
      [first, { ...second, id: 101 }],
      [first, { ...second, orderNumber: first.orderNumber }],
    ])
      expect(() =>
        validateCheckoutReceiptV1({ ...receipt(), orders }, 42),
      ).toThrow(HttpException);
    const oversized = [first, second].map((order) => ({
      ...order,
      total: '999999999999.00',
      payment: { ...order.payment, amount: '999999999999.00' },
    }));
    expect(() =>
      validateCheckoutReceiptV1({ ...receipt(), orders: oversized }, 42),
    ).toThrow(HttpException);
  });
});
