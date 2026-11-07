// Maintenance CLI for the Redis cart. Run ONLY with the backend stopped.
//   node dist/cart/redis-cart-admin.cli.js bump-sequence [--apply]
//   node dist/cart/redis-cart-admin.cli.js import [--apply]
// Without --apply nothing is written (dry-run). DATABASE_URL must be a role allowed to
// setval cart_line_seq (migrator/owner) for bump-sequence. Prints a JSON report only.
import pg from 'pg';
import { Redis } from 'ioredis';
import { defineCartCommands, redisClientOptions } from '../redis/redis.service.js';
import { HW_FIELD, cartKey, encodeLine, isSeq } from './cart-redis-protocol.js';
import { bumpTarget, planImport, type ImportItem } from './redis-cart-admin.js';

async function maxHw(redis: Redis) {
  let cursor = '0';
  let max = 0n;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'cart:*', 'COUNT', 500);
    cursor = next;
    for (const key of keys) {
      if (!/^cart:[1-9][0-9]*$/.test(key)) continue;
      const hw = await redis.hget(key, HW_FIELD);
      if (hw === null) continue;
      if (!isSeq(hw)) throw new Error(`Invalid ${HW_FIELD} in ${key}`);
      if (BigInt(hw) > max) max = BigInt(hw);
    }
  } while (cursor !== '0');
  return max.toString();
}

async function bumpSequence(db: pg.Pool, redis: Redis, apply: boolean) {
  const seq = await db.query<{ last: string }>(
    'SELECT last_value::text AS last FROM cart_line_seq',
  );
  const fence = await db.query<{ max: string }>(
    'SELECT COALESCE(MAX("consumedSeq"), 0)::text AS max FROM cart_consumed_lines',
  );
  const input = {
    lastValue: seq.rows[0].last,
    fenceMax: fence.rows[0].max,
    hwMax: await maxHw(redis),
  };
  const target = bumpTarget(input);
  if (apply) await db.query("SELECT setval('cart_line_seq', $1::bigint, false)", [target]);
  return { command: 'bump-sequence', apply, ...input, nextValue: target };
}

async function importCarts(db: pg.Pool, redis: ReturnType<typeof defineCartCommands>, apply: boolean, ttl: number, maxQuantity: number) {
  const users = await db.query<{ userId: number }>(
    'SELECT DISTINCT c."userId" AS "userId" FROM carts c JOIN cart_items i ON i."cartId" = c.id ORDER BY 1',
  );
  const report = {
    command: 'import',
    apply,
    usersCreated: 0,
    usersSkippedKeyExists: [] as number[],
    linesImported: 0,
    skipped: [] as { userId: number; variantId: number; reason: string }[],
  };
  for (const { userId } of users.rows) {
    const client = await db.connect();
    const seqs: string[] = [];
    let plan: ReturnType<typeof planImport>;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const items = await client.query<ImportItem>(
        `SELECT i.id, i."variantId", i.quantity, i."updatedAt", (v.id IS NOT NULL) AS "variantExists"
         FROM cart_items i JOIN carts c ON c.id = i."cartId"
         LEFT JOIN product_variants v ON v.id = i."variantId"
         WHERE c."userId" = $1 ORDER BY i.id`,
        [userId],
      );
      const fences = await client.query<{ variantId: number; updatedAt: Date }>(
        'SELECT "variantId", "updatedAt" FROM cart_consumed_lines WHERE "buyerId" = $1',
        [userId],
      );
      plan = planImport(
        items.rows,
        new Map(fences.rows.map((row) => [row.variantId, row.updatedAt])),
        maxQuantity,
      );
      report.skipped.push(...plan.skipped.map((s) => ({ userId, ...s })));
      if (plan.lines.length && (await redis.exists(cartKey(userId)))) {
        report.usersSkippedKeyExists.push(userId);
        plan.lines = [];
      }
      if (apply)
        for (let i = 0; i < plan.lines.length; i++)
          seqs.push(
            (await client.query<{ seq: string }>("SELECT nextval('cart_line_seq')::text AS seq")).rows[0].seq,
          );
      // Commit the allocated seqs before they are used outside PostgreSQL.
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (!plan.lines.length) continue;
    if (!apply) {
      report.linesImported += plan.lines.length;
      continue;
    }
    const args: string[] = [];
    plan.lines.forEach((line, index) =>
      args.push(String(line.variantId), encodeLine(line.quantity, seqs[index], seqs[index])),
    );
    const created = await redis.cartImport(cartKey(userId), ttl, seqs[seqs.length - 1], ...args);
    if (created === 1) {
      report.usersCreated++;
      report.linesImported += plan.lines.length;
    } else report.usersSkippedKeyExists.push(userId);
  }
  return report;
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  const apply = flags.includes('--apply');
  if (!['bump-sequence', 'import'].includes(command ?? ''))
    throw new Error('Usage: redis-cart-admin.cli.js <bump-sequence|import> [--apply]');
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) throw new Error('DATABASE_URL and REDIS_URL are required');
  const ttl = Number(process.env.REDIS_CART_TTL_SECONDS ?? '604800');
  const maxQuantity = Number(process.env.CART_MAX_QUANTITY ?? '99');
  if (!Number.isSafeInteger(ttl) || ttl < 60) throw new Error('Invalid REDIS_CART_TTL_SECONDS');
  if (!Number.isSafeInteger(maxQuantity) || maxQuantity < 1 || maxQuantity > 99)
    throw new Error('Invalid CART_MAX_QUANTITY');
  const db = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const redis = defineCartCommands(new Redis(redisUrl, redisClientOptions(2000)));
  try {
    await redis.connect();
    const report =
      command === 'bump-sequence'
        ? await bumpSequence(db, redis, apply)
        : await importCarts(db, redis, apply, ttl, maxQuantity);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    redis.disconnect();
    await db.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`redis-cart-admin failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exitCode = 1;
});
