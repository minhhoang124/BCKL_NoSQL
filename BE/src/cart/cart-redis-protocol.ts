// Redis cart wire protocol (design: docs/agent-context/handoffs/2026-11-07-NOSQL24-redis-cart-design-v3.md).
// Key cart:{userId} is a Hash: field variantId -> "qty|seq|addedSeq", field _hw -> highest
// accepted seq. Seqs are positive bigint decimal strings; never converted to Number.

export const HW_FIELD = '_hw';
export const BIGINT_MAX = '9223372036854775807';

export function cartKey(userId: number) {
  return `cart:${userId}`;
}

export function isSeq(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]*$/.test(value) &&
    (value.length < 19 || (value.length === 19 && value <= BIGINT_MAX))
  );
}

/** a > b for canonical seq strings: length first, then lexicographic (same as Lua). */
export function seqGreater(a: string, b: string) {
  return a.length !== b.length ? a.length > b.length : a > b;
}

export interface RedisCartLine {
  variantId: number;
  quantity: number;
  seq: string;
  addedSeq: string;
}

export function encodeLine(quantity: number, seq: string, addedSeq: string) {
  return `${quantity}|${seq}|${addedSeq}`;
}

/** Returns null for a malformed field/value; callers skip it rather than trust it. */
export function decodeLine(field: string, value: string): RedisCartLine | null {
  if (!/^[1-9][0-9]{0,9}$/.test(field)) return null;
  const variantId = Number(field);
  if (variantId > 2147483647) return null;
  const parts = value.split('|');
  if (parts.length !== 3 || !/^[1-9][0-9]?$/.test(parts[0])) return null;
  if (!isSeq(parts[1]) || !isSeq(parts[2])) return null;
  return {
    variantId,
    quantity: Number(parts[0]),
    seq: parts[1],
    addedSeq: parts[2],
  };
}

// Shared Lua helpers. Lua patterns have no {m,n}: check digits, then length, then the
// 19-digit bound. Comparison is length then byte order; tonumber() is never used for seqs.
const LUA_SEQ = `
local MAX = '${BIGINT_MAX}'
local function valid(s)
  if type(s) ~= 'string' or not string.match(s, '^[1-9]%d*$') then return false end
  local n = #s
  if n > 19 then return false end
  if n == 19 and s > MAX then return false end
  return true
end
local function gt(a, b)
  if #a ~= #b then return #a > #b end
  return a > b
end
`;

export type CartWriteOp = 'set' | 'del' | 'hw';

/**
 * KEYS[1]=cart key; ARGV: seq, op, field, value, ttlSeconds. op: 'set' writes the line,
 * 'del' removes it, 'hw' only raises _hw (a successful PUT/DELETE that changes no data
 * still fences every older in-flight command). Applies only when seq > _hw. A rejected
 * (stale) command creates nothing and does not extend the TTL. Returns 1 applied, 0 rejected.
 */
export const LUA_WRITE = `${LUA_SEQ}
local seq, op = ARGV[1], ARGV[2]
if not valid(seq) then return redis.error_reply('CART_BAD_SEQ') end
if op ~= 'set' and op ~= 'del' and op ~= 'hw' then return redis.error_reply('CART_BAD_OP') end
if op == 'set' and (ARGV[4] == nil or ARGV[4] == '') then return redis.error_reply('CART_BAD_VALUE') end
local hw = redis.call('HGET', KEYS[1], '${HW_FIELD}')
if hw then
  if not valid(hw) then return redis.error_reply('CART_BAD_HW') end
  if not gt(seq, hw) then return 0 end
end
redis.call('HSET', KEYS[1], '${HW_FIELD}', seq)
if op == 'set' then
  redis.call('HSET', KEYS[1], ARGV[3], ARGV[4])
elseif op == 'del' then
  redis.call('HDEL', KEYS[1], ARGV[3])
end
redis.call('EXPIRE', KEYS[1], ARGV[5])
return 1
`;

/**
 * KEYS[1]=cart key; ARGV: pairs (field, consumedSeq). Deletes a line only when its seq is
 * <= the consumed seq. Never touches _hw and never extends the TTL. Returns lines removed.
 */
export const LUA_CLEANUP = `${LUA_SEQ}
local removed = 0
for i = 1, #ARGV, 2 do
  local v = redis.call('HGET', KEYS[1], ARGV[i])
  if v and valid(ARGV[i + 1]) then
    local s = string.match(v, '^%d+|(%d+)|%d+$')
    if s and valid(s) and not gt(s, ARGV[i + 1]) then
      redis.call('HDEL', KEYS[1], ARGV[i])
      removed = removed + 1
    end
  end
end
return removed
`;

/**
 * Import only. KEYS[1]=cart key; ARGV: ttlSeconds, hw, then pairs (field, value).
 * Initialises a key only when it does not exist; returns 1 created, 0 skipped.
 */
export const LUA_IMPORT = `${LUA_SEQ}
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
if not valid(ARGV[2]) then return redis.error_reply('CART_BAD_SEQ') end
for i = 3, #ARGV, 2 do
  redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call('HSET', KEYS[1], '${HW_FIELD}', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[1])
return 1
`;
