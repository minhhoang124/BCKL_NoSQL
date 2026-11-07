import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { prepareOrderCommand } from './order-command-request.js';

describe('Order command input/hash preparation (no database replay)', () => {
  const base: Parameters<typeof prepareOrderCommand>[0] = {
    actorId: 7,
    actorType: 'SELLER',
    orderId: 101,
    command: 'confirm',
    idempotencyKey: 'Order_demo_key_01',
    body: {},
  };
  const cancel: Parameters<typeof prepareOrderCommand>[0] = {
    ...base,
    command: 'cancel',
    body: { reasonCode: 'OTHER', reasonText: '  Đổi kế hoạch  ' },
  };

  function invalid(
    overrides: Partial<typeof base>,
    status = 400,
    code = 'VALIDATION_ERROR',
  ) {
    const run = () => prepareOrderCommand({ ...base, ...overrides });
    expect(run).toThrow(HttpException);
    try {
      run();
    } catch (error) {
      expect(error).toMatchObject({
        status,
        response: { statusCode: status, code },
      });
    }
  }

  it('matches an independent exact canonical v1 envelope', () => {
    const canonical =
      '{"actorScope":"USER:7","body":{},"command":"confirm","orderId":101}';
    const prepared = prepareOrderCommand(base);
    expect(prepared.requestHash).toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    );
    expect(prepared).toMatchObject({ actorScope: 'USER:7', hashVersion: 1 });
  });
  it('canonicalizes field order and trimmed Unicode text without changing case', () => {
    const prepared = prepareOrderCommand(cancel);
    const reordered = prepareOrderCommand({
      ...cancel,
      body: { reasonText: 'Đổi kế hoạch', reasonCode: 'OTHER' },
    });
    const canonical =
      '{"actorScope":"USER:7","body":{"reasonCode":"OTHER","reasonText":"Đổi kế hoạch"},"command":"cancel","orderId":101}';
    expect(prepared.requestHash).toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    );
    expect(prepared.requestHash).toBe(reordered.requestHash);
    expect(prepared.body).toEqual({
      reasonCode: 'OTHER',
      reasonText: 'Đổi kế hoạch',
    });
  });
  it('copies/freezes normalized data so original body cannot change the hash meaning', () => {
    const body = { reasonCode: 'OTHER', reasonText: 'Lý do' };
    const prepared = prepareOrderCommand({ ...cancel, body });
    body.reasonText = 'Changed';
    expect(prepared.body).toEqual({ reasonCode: 'OTHER', reasonText: 'Lý do' });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.body)).toBe(true);
  });
  it('excludes key from intent hash but preserves exact case-sensitive key', () => {
    const first = prepareOrderCommand(base);
    const other = prepareOrderCommand({
      ...base,
      idempotencyKey: 'order_demo_key_01',
    });
    expect(first.requestHash).toBe(other.requestHash);
    expect(first.idempotencyKey).not.toBe(other.idempotencyKey);
  });
  it('different actor/order/command yields different intent hash', () => {
    const hash = prepareOrderCommand(base).requestHash;
    for (const overrides of [
      { actorId: 8 },
      { orderId: 102 },
      { command: 'start-packing' as const },
    ]) {
      expect(
        prepareOrderCommand({ ...base, ...overrides }).requestHash,
      ).not.toBe(hash);
    }
  });
  it('changed reason code/text/case yields different intent hash', () => {
    const hash = prepareOrderCommand(cancel).requestHash;
    for (const body of [
      { reasonCode: 'OTHER', reasonText: 'đổi kế hoạch' },
      { reasonCode: 'OTHER', reasonText: 'Lý do khác' },
      { reasonCode: 'OUT_OF_STOCK', reasonText: 'Đổi kế hoạch' },
    ]) {
      expect(prepareOrderCommand({ ...cancel, body }).requestHash).not.toBe(
        hash,
      );
    }
  });
  it.each([undefined, null])(
    'missing header %s has a specific safe code',
    (key) => {
      invalid({ idempotencyKey: key }, 400, 'IDEMPOTENCY_KEY_REQUIRED');
    },
  );
  it.each([
    '',
    'a'.repeat(15),
    'a'.repeat(129),
    'invalid.key.123456',
    'x'.repeat(16) + '\n',
    ' '.repeat(16),
    'á'.repeat(16),
    ['a'.repeat(16)],
    123,
  ])('rejects invalid header %j', (key) => invalid({ idempotencyKey: key }));
  it.each([16, 128])('accepts key boundary %i', (length) => {
    expect(
      prepareOrderCommand({
        ...base,
        idempotencyKey: '_-aA09'.repeat(22).slice(0, length),
      }).idempotencyKey,
    ).toHaveLength(length);
  });
  it.each([0, -1, 1.2, NaN, Infinity, 2147483648])('rejects ID %s', (id) => {
    invalid({ actorId: id });
    invalid({ orderId: id });
  });
  it('accepts the PostgreSQL Int boundary', () => {
    expect(prepareOrderCommand({ ...base, orderId: 2147483647 }).orderId).toBe(
      2147483647,
    );
  });
  it.each([
    null,
    undefined,
    [],
    '',
    1,
    new Date(),
    { status: 'CONFIRMED' },
    { actorId: 8 },
    { restockable: false },
  ])('rejects non-empty/non-object command body %j', (body) =>
    invalid({ body }),
  );
  it('rejects hidden extra fields and symbols in body', () => {
    invalid({
      body: Object.defineProperty({}, 'status', { value: 'CONFIRMED' }),
    });
    invalid({ body: { [Symbol('extra')]: true } });
  });
  it.each(['CHANGED_MIND', 'OTHER'])(
    'accepts Buyer reason %s',
    (reasonCode) => {
      expect(
        prepareOrderCommand({
          ...cancel,
          actorType: 'BUYER',
          body: { reasonCode, reasonText: 'Lý do' },
        }).body,
      ).toEqual({ reasonCode, reasonText: 'Lý do' });
    },
  );
  it.each(['OUT_OF_STOCK', 'CANNOT_FULFIL', 'OTHER'])(
    'accepts Seller reason %s',
    (reasonCode) => {
      expect(
        prepareOrderCommand({
          ...cancel,
          body: { reasonCode, reasonText: 'Lý do' },
        }).command,
      ).toBe('cancel');
    },
  );
  it('rejects reasons for the other actor and unknown codes', () => {
    invalid({
      ...cancel,
      body: { reasonCode: 'CHANGED_MIND', reasonText: 'Lý do' },
    });
    invalid({
      ...cancel,
      actorType: 'BUYER',
      body: { reasonCode: 'OUT_OF_STOCK', reasonText: 'Lý do' },
    });
    invalid({
      ...cancel,
      body: { reasonCode: 'UNKNOWN', reasonText: 'Lý do' },
    });
  });
  it.each([
    {},
    { reasonCode: 'OTHER' },
    { reasonCode: 'OTHER', reasonText: null },
    { reasonCode: 'OTHER', reasonText: '  ' },
    { reasonCode: 'OTHER', reasonText: 1 },
    { reasonCode: 'OTHER', reasonText: 'x'.repeat(501) },
    { reasonCode: 'OTHER', reasonText: 'Lý do', actorType: 'SELLER' },
    { reasonCode: 'OTHER', reasonText: 'Lý do', restockable: false },
  ])('rejects incomplete/extra cancellation body %j', (body) =>
    invalid({ ...cancel, body }),
  );
  it.each([1, 500])('accepts reasonText boundary %i after trim', (length) => {
    expect(
      prepareOrderCommand({
        ...cancel,
        body: {
          reasonCode: 'OTHER',
          reasonText: ' ' + 'x'.repeat(length) + ' ',
        },
      }).body,
    ).toEqual({ reasonCode: 'OTHER', reasonText: 'x'.repeat(length) });
  });
  it.each(['confirm', 'start-packing', 'ready-to-ship'] as const)(
    'Buyer cannot prepare %s',
    (command) => {
      invalid({ actorType: 'BUYER', command }, 403, 'FORBIDDEN');
    },
  );
  it('never echoes a submitted secret or key in the validation error', () => {
    const secret = 'DO_NOT_ECHO_PRIVATE_VALUE';
    try {
      prepareOrderCommand({ ...base, body: { secret } });
      expect.fail('must reject extra body');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(base.idempotencyKey);
    }
  });

  it('rejects unsupported actors/commands even if runtime bypasses TypeScript', () => {
    for (const actorType of ['ADMIN', 'SYSTEM', 'USER', null]) {
      invalid(
        { actorType } as unknown as Partial<typeof base>,
        403,
        'FORBIDDEN',
      );
    }
    for (const command of ['complete', 'mark-delivered', '__proto__', null]) {
      invalid({ command } as unknown as Partial<typeof base>);
    }
  });

  it('does not coerce string IDs or inherit body fields', () => {
    invalid({ orderId: '101' } as unknown as Partial<typeof base>);
    invalid({ actorId: '7' } as unknown as Partial<typeof base>);
    invalid({
      ...cancel,
      body: Object.create({ reasonCode: 'OTHER', reasonText: 'Lý do' }),
    });
  });
});
