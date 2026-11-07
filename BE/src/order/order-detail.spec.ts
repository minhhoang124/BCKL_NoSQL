import {
  parseOrderDetailInput,
  readOrderOptions,
} from './order-detail.service.js';

describe('Order detail request and snapshot boundaries', () => {
  it('accepts positive PostgreSQL Int IDs and empty query only', () => {
    expect(parseOrderDetailInput('1', {})).toBe(1);
    expect(parseOrderDetailInput('2147483647', {})).toBe(2147483647);
  });
  it.each([
    '0',
    '-1',
    '01',
    '1.0',
    '1e2',
    ' 1',
    '1 ',
    '',
    'NaN',
    'Infinity',
    '2147483648',
    '9007199254740993',
    1,
    null,
    ['1'],
  ])('rejects invalid ID %j', (id) =>
    expect(() => parseOrderDetailInput(id, {})).toThrow(),
  );
  it.each([
    null,
    [],
    '',
    { buyerId: '1' },
    { storeId: '1' },
    { include: 'commands' },
    { status: 'CONFIRMED' },
  ])('rejects query/coercion %j', (query) =>
    expect(() => parseOrderDetailInput('1', query)).toThrow(),
  );
  it('maps canonical Checkout snapshots in saved order and excludes extra JSON', () => {
    expect(
      readOrderOptions([
        {
          groupId: 1,
          groupName: 'Color',
          valueId: 2,
          value: 'Black',
          secret: 'must not leak',
        },
        { groupId: 3, groupName: 'Length', valueId: 4, value: '1 m' },
      ]),
    ).toEqual(['Black', '1 m']);
  });
  it('supports saved legacy string arrays and empty default-variant options', () => {
    expect(readOrderOptions(['Black', '1 m'])).toEqual(['Black', '1 m']);
    expect(readOrderOptions([])).toEqual([]);
  });
  it.each([
    null,
    {},
    'Black',
    [123],
    [{ value: 'Black' }],
    [{ groupId: 0, groupName: 'Color', valueId: 1, value: 'Black' }],
  ])(
    'fails closed for unsupported snapshots %j, without guessing catalog data',
    (snapshot) =>
      expect(() => readOrderOptions(snapshot)).toThrow(
        'Invalid order option snapshot',
      ),
  );
});
