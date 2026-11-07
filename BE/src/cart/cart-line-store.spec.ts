import { Prisma } from '@prisma/client';
import { vi } from 'vitest';
import { CartLineStore } from './cart-line-store.js';
import type { RedisService } from '../redis/redis.service.js';

type Hash = Record<string, string>;

function fixture(hash: Hash = {}, fences: { variantId: number; consumedSeq: bigint }[] = []) {
  const client = {
    hgetall: vi.fn(async () => ({ ...hash })),
    hget: vi.fn(async (_key: string, field: string) => hash[field] ?? null),
    cartWrite: vi.fn(async () => 1),
    cartCleanup: vi.fn(async () => 0),
  };
  const redis = {
    enabled: true,
    cart: { ttlSeconds: 604800 },
    client,
  } as unknown as RedisService;
  const seqs: string[] = [];
  let fenceMax = '0';
  const tx = {
    cartConsumedLine: {
      findMany: vi.fn(async () => fences),
    },
    $queryRaw: vi.fn(async (sql: TemplateStringsArray) => {
      const text = sql.join('?');
      if (text.includes('nextval')) return [{ seq: seqs.shift() ?? '1000' }];
      if (text.includes('MAX("consumedSeq")')) return [{ fence: fenceMax }];
      throw new Error(`unexpected SQL ${text}`);
    }),
    $executeRaw: vi.fn(async (..._args: unknown[]) => 1),
  };
  return {
    store: new CartLineStore(redis),
    client,
    tx: tx as unknown as Prisma.TransactionClient,
    rawTx: tx,
    nextSeqs: (...values: string[]) => seqs.push(...values),
    setFenceMax: (value: string) => (fenceMax = value),
  };
}

describe('CartLineStore Redis mode', () => {
  it('without Redis service it is the PostgreSQL store', () => {
    expect(new CartLineStore().redisMode).toBe(false);
  });

  it('filters lines at or below the fence and orders by addedSeq as bigint', async () => {
    const big = (2n ** 53n).toString();
    const { store, tx } = fixture(
      {
        _hw: '9007199254740999',
        '1': `1|${big}1|${big}1`, // addedSeq has 17 digits: last
        '2': '2|50|50', // consumed below
        '3': '3|9007199254740993|9007199254740993',
        '4': 'garbage',
      },
      [{ variantId: 2, consumedSeq: 50n }],
    );
    const lines = await store.lines(tx, 7, await store.snapshot(7));
    expect(lines.map((line) => line.variantId)).toEqual([3, 1]);
  });

  it('F1: PUT with the same quantity raises _hw only, keeping the line seq/addedSeq', async () => {
    const { store, tx, client, nextSeqs } = fixture({ _hw: '5', '9': '2|5|5' });
    nextSeqs('6');
    await store.put(tx, 7, 9, 2);
    expect(client.cartWrite).toHaveBeenCalledWith('cart:7', '6', 'hw', '9', '', 604800);
  });

  it('PUT keeps addedSeq of an effective line and uses the new seq', async () => {
    const { store, tx, client, nextSeqs } = fixture({ _hw: '5', '9': '2|5|4' });
    nextSeqs('6');
    await store.put(tx, 7, 9, 3);
    expect(client.cartWrite).toHaveBeenCalledWith('cart:7', '6', 'set', '9', '3|6|4', 604800);
  });

  it('re-adding a consumed line starts a new addedSeq', async () => {
    const { store, tx, client, nextSeqs } = fixture(
      { _hw: '5', '9': '2|5|4' },
      [{ variantId: 9, consumedSeq: 5n }],
    );
    nextSeqs('6');
    await store.put(tx, 7, 9, 2);
    expect(client.cartWrite).toHaveBeenCalledWith('cart:7', '6', 'set', '9', '2|6|6', 604800);
  });

  it('F1: DELETE of a missing or consumed line still raises _hw', async () => {
    const { store, tx, client, nextSeqs } = fixture(
      { _hw: '5', '9': '2|5|4' },
      [{ variantId: 9, consumedSeq: 5n }],
    );
    nextSeqs('6', '7');
    await store.remove(tx, 7, 9);
    await store.remove(tx, 7, 10);
    expect(client.cartWrite.mock.calls).toEqual([
      ['cart:7', '6', 'del', '9', '', 604800],
      ['cart:7', '7', 'del', '10', '', 604800],
    ]);
  });

  it('R8a/R17: seq at or below _hw or fence fails closed with 503, no write, no setval', async () => {
    const behindHw = fixture({ _hw: '1000', '9': '1|1000|1000' });
    behindHw.nextSeqs('900');
    await expect(behindHw.store.put(behindHw.tx, 7, 9, 2)).rejects.toMatchObject({
      response: { code: 'CART_SEQUENCE_BEHIND' },
      status: 503,
    });
    expect(behindHw.client.cartWrite).not.toHaveBeenCalled();
    // Redis empty (flushed), fence still 1000.
    const behindFence = fixture({});
    behindFence.setFenceMax('1000');
    behindFence.nextSeqs('900');
    await expect(behindFence.store.put(behindFence.tx, 7, 9, 2)).rejects.toMatchObject({
      response: { code: 'CART_SEQUENCE_BEHIND' },
    });
    expect(behindFence.client.cartWrite).not.toHaveBeenCalled();
    for (const call of behindFence.rawTx.$queryRaw.mock.calls)
      expect((call[0] as unknown as string[]).join('')).not.toContain('setval');
  });

  it('a rejected Lua write is reported as 503, never as success', async () => {
    const { store, tx, client, nextSeqs } = fixture({ _hw: '5' });
    nextSeqs('6');
    client.cartWrite.mockResolvedValueOnce(0);
    await expect(store.put(tx, 7, 9, 1)).rejects.toMatchObject({
      response: { code: 'CART_SEQUENCE_BEHIND' },
    });
  });

  it('Redis command failure maps to 503 CART_STORE_UNAVAILABLE', async () => {
    const { store, tx, client, nextSeqs } = fixture({ _hw: '5' });
    nextSeqs('6');
    client.cartWrite.mockRejectedValueOnce(new Error('Command timed out'));
    await expect(store.put(tx, 7, 9, 1)).rejects.toMatchObject({
      response: { code: 'CART_STORE_UNAVAILABLE' },
      status: 503,
    });
    client.hgetall.mockRejectedValueOnce(new Error('Connection is closed.'));
    await expect(store.snapshot(7)).rejects.toMatchObject({
      response: { code: 'CART_STORE_UNAVAILABLE' },
    });
  });

  it('invalid _hw in Redis is treated as unavailable, not as empty', async () => {
    const { store } = fixture({ _hw: '1.5' });
    await expect(store.snapshot(7)).rejects.toMatchObject({
      response: { code: 'CART_STORE_UNAVAILABLE' },
    });
  });

  it('R7: versioned read retries while _hw changes, then gives up with 409', async () => {
    const { store, client } = fixture({ _hw: '5' });
    client.hget
      .mockResolvedValueOnce('6')
      .mockResolvedValueOnce('5');
    const run = vi.fn(async () => 'ok');
    await expect(store.versioned(7, run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
    client.hget.mockResolvedValue('99');
    await expect(store.versioned(7, run)).rejects.toMatchObject({
      response: { code: 'CART_READ_CONFLICT' },
      status: 409,
    });
  });

  it('consume writes a GREATEST fence per line; cleanup failure is swallowed', async () => {
    const { store, tx, rawTx, client } = fixture();
    const lines = [
      { variantId: 9, quantity: 1, seq: '6', addedSeq: '6' },
      { variantId: 10, quantity: 2, seq: '7', addedSeq: '7' },
    ];
    await expect(store.consume(tx, 7, 55, lines)).resolves.toBe(true);
    expect(rawTx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(
      (rawTx.$executeRaw.mock.calls[0][0] as unknown as string[]).join(''),
    ).toContain('GREATEST');
    await expect(
      store.consume(tx, 7, 55, [{ variantId: 9, quantity: 1, seq: null, addedSeq: null }]),
    ).resolves.toBe(false);
    client.cartCleanup.mockRejectedValueOnce(new Error('down'));
    await expect(store.cleanup(7, lines)).resolves.toBeUndefined();
    expect(client.cartCleanup).toHaveBeenCalledWith('cart:7', '9', '6', '10', '7');
  });
});
