import {
  BIGINT_MAX,
  LUA_CLEANUP,
  LUA_IMPORT,
  LUA_WRITE,
  decodeLine,
  encodeLine,
  isSeq,
  seqGreater,
} from './cart-redis-protocol.js';

describe('Redis cart seq protocol (R9, JS side)', () => {
  const p53 = (2n ** 53n).toString();
  const p53m1 = (2n ** 53n - 1n).toString();
  const p53p1 = (2n ** 53n + 1n).toString();

  it('accepts canonical positive bigint strings only', () => {
    for (const ok of ['1', '9', '10', p53m1, p53, p53p1, BIGINT_MAX])
      expect(isSeq(ok)).toBe(true);
    for (const bad of [
      '',
      '0',
      '01',
      '-1',
      '1.0',
      ' 1',
      '1e3',
      '9223372036854775808',
      '10000000000000000000',
      1,
      null,
    ])
      expect(isSeq(bad)).toBe(false);
  });

  it('compares by length then lexicographically, exact around 2^53', () => {
    expect(seqGreater(p53p1, p53)).toBe(true);
    expect(seqGreater(p53, p53m1)).toBe(true);
    expect(seqGreater(p53, p53)).toBe(false);
    expect(seqGreater('10', '9')).toBe(true);
    expect(seqGreater('9', '10')).toBe(false);
    expect(seqGreater(BIGINT_MAX, '9223372036854775806')).toBe(true);
    // Number() would collapse these two; the protocol must not.
    expect(Number(p53p1)).toBe(Number(p53));
    expect(seqGreater(p53p1, p53)).not.toBe(seqGreater(p53, p53p1));
  });

  it('round-trips a line and rejects malformed fields/values', () => {
    expect(decodeLine('42', encodeLine(3, p53p1, p53))).toEqual({
      variantId: 42,
      quantity: 3,
      seq: p53p1,
      addedSeq: p53,
    });
    for (const [field, value] of [
      ['_hw', '1|1|1'],
      ['0', '1|1|1'],
      ['2147483648', '1|1|1'],
      ['42', '0|1|1'],
      ['42', '100|1|1'],
      ['42', '1|0|1'],
      ['42', '1|1'],
      ['42', '1|1|1|1'],
      ['42', `1|${'9'.repeat(20)}|1`],
    ])
      expect(decodeLine(field, value)).toBeNull();
  });

  it('Lua scripts avoid regex quantifiers and tonumber for seqs', () => {
    for (const lua of [LUA_WRITE, LUA_CLEANUP, LUA_IMPORT]) {
      expect(lua).not.toMatch(/\{0,|\{1,/);
      expect(lua).not.toContain('tonumber');
      expect(lua).toContain("'^[1-9]%d*$'");
      expect(lua).toContain(BIGINT_MAX);
    }
  });
});
