import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { listingInclude } from '../product/product-public-policy.js';
import { RedisService } from '../redis/redis.service.js';
import { cartError } from './cart-http.js';
import {
  HW_FIELD,
  cartKey,
  decodeLine,
  encodeLine,
  isSeq,
  seqGreater,
  type CartWriteOp,
  type RedisCartLine,
} from './cart-redis-protocol.js';

/** One cart line, independent of the backing store. seq/addedSeq exist only for Redis. */
export interface CartLine {
  variantId: number;
  quantity: number;
  seq: string | null;
  addedSeq: string | null;
}

export type CartVariant = Prisma.ProductVariantGetPayload<{
  include: { product: { include: typeof listingInclude } };
}>;

export interface CartRow extends CartLine {
  /** Null only in Redis mode: Redis has no FK, so a variant may no longer exist. */
  variant: CartVariant | null;
}

/** Raw Redis state read before (and re-checked after) a PostgreSQL snapshot. */
export interface RedisCartSnapshot {
  hw: string | null;
  lines: Map<number, RedisCartLine>;
}

const READ_ATTEMPTS = 3;

export function storeUnavailable() {
  return cartError(
    503,
    'CART_STORE_UNAVAILABLE',
    'Giỏ hàng tạm thời không khả dụng. Vui lòng thử lại sau.',
  );
}

@Injectable()
export class CartLineStore {
  private readonly logger = new Logger(CartLineStore.name);
  constructor(@Optional() private readonly redis?: RedisService) {}

  get redisMode() {
    return this.redis?.enabled === true;
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // Timeout, disconnect or script error: outcome of a write is unknown.
      this.logger.warn(
        `Redis cart command failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      throw storeUnavailable();
    }
  }

  /** HGETALL of the user's cart. Malformed entries are skipped, never trusted. */
  async snapshot(userId: number): Promise<RedisCartSnapshot> {
    const raw = await this.call(() =>
      this.redis!.client.hgetall(cartKey(userId)),
    );
    const result: RedisCartSnapshot = { hw: null, lines: new Map() };
    for (const [field, value] of Object.entries(raw)) {
      if (field === HW_FIELD) {
        if (!isSeq(value)) {
          this.logger.error(`Redis cart has invalid ${HW_FIELD}: userId=${userId}`);
          throw storeUnavailable();
        }
        result.hw = value;
        continue;
      }
      const line = decodeLine(field, value);
      if (!line) {
        this.logger.warn(`Redis cart skipped malformed line: userId=${userId}`);
        continue;
      }
      result.lines.set(line.variantId, line);
    }
    return result;
  }

  private async hw(userId: number) {
    return this.call(() => this.redis!.client.hget(cartKey(userId), HW_FIELD));
  }

  /**
   * PostgreSQL mode: run once. Redis mode: read Redis, run the PostgreSQL snapshot, then
   * re-read _hw; if Redis changed meanwhile, repeat. A result is the true state at the
   * PostgreSQL snapshot because Redis did not change across it.
   */
  async versioned<T>(
    userId: number,
    run: (snapshot: RedisCartSnapshot | null) => Promise<T>,
  ): Promise<T> {
    if (!this.redisMode) return run(null);
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
      const snapshot = await this.snapshot(userId);
      const result = await run(snapshot);
      if ((await this.hw(userId)) === snapshot.hw) return result;
    }
    throw cartError(
      409,
      'CART_READ_CONFLICT',
      'Giỏ hàng đang được cập nhật. Vui lòng tải lại.',
    );
  }

  /**
   * Effective lines in display order. Redis mode filters by the PostgreSQL fence
   * (seq > consumedSeq); a snapshot must be given, or one is read now (writers hold the
   * buyer lock, so a fresh read is consistent for them).
   */
  async lines(
    tx: Prisma.TransactionClient,
    userId: number,
    snapshot: RedisCartSnapshot | null,
    variantIds?: number[],
  ): Promise<CartLine[]> {
    if (!this.redisMode) {
      const items = await tx.cartItem.findMany({
        where: {
          cart: { userId },
          ...(variantIds ? { variantId: { in: variantIds } } : {}),
        },
        orderBy: { id: 'asc' },
        select: { variantId: true, quantity: true },
      });
      return items.map((item) => ({ ...item, seq: null, addedSeq: null }));
    }
    const state = snapshot ?? (await this.snapshot(userId));
    const wanted = variantIds ? new Set(variantIds) : null;
    const candidates = [...state.lines.values()].filter(
      (line) => !wanted || wanted.has(line.variantId),
    );
    if (!candidates.length) return [];
    const fences = await tx.cartConsumedLine.findMany({
      where: {
        buyerId: userId,
        variantId: { in: candidates.map((line) => line.variantId) },
      },
      select: { variantId: true, consumedSeq: true },
    });
    const consumed = new Map(fences.map((f) => [f.variantId, f.consumedSeq]));
    return candidates
      .filter((line) => BigInt(line.seq) > (consumed.get(line.variantId) ?? 0n))
      .sort((a, b) =>
        a.addedSeq === b.addedSeq
          ? a.variantId - b.variantId
          : seqGreater(a.addedSeq, b.addedSeq)
            ? 1
            : -1,
      )
      .map((line) => ({ ...line }));
  }

  async withVariants(
    tx: Prisma.TransactionClient,
    lines: CartLine[],
  ): Promise<CartRow[]> {
    if (!lines.length) return [];
    const variants = await tx.productVariant.findMany({
      where: { id: { in: lines.map((line) => line.variantId) } },
      include: { product: { include: listingInclude } },
    });
    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    return lines.map((line) => ({
      ...line,
      variant: byId.get(line.variantId) ?? null,
    }));
  }

  /** Absolute quantity; the caller holds the buyer lock and has validated the variant. */
  async put(
    tx: Prisma.TransactionClient,
    userId: number,
    variantId: number,
    quantity: number,
  ) {
    if (!this.redisMode) {
      const cart = await tx.cart.upsert({
        where: { userId },
        create: { userId },
        update: {},
        select: { id: true },
      });
      const existing = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
      });
      // A replay of absolute quantity does not mutate even updatedAt.
      if (!existing)
        await tx.cartItem.create({
          data: { cartId: cart.id, variantId, quantity },
        });
      else if (existing.quantity !== quantity)
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity },
        });
      return;
    }
    const snapshot = await this.snapshot(userId);
    const [current] = await this.lines(tx, userId, snapshot, [variantId]);
    // Every successful PUT gets a new seq, even when nothing changes: raising _hw fences
    // older in-flight commands. An unchanged line keeps its seq/addedSeq.
    const seq = await this.allocate(tx, userId, snapshot.hw);
    if (current?.quantity === quantity)
      await this.write(userId, seq, 'hw', String(variantId), '');
    else
      await this.write(
        userId,
        seq,
        'set',
        String(variantId),
        encodeLine(quantity, seq, current?.addedSeq ?? seq),
      );
  }

  async remove(tx: Prisma.TransactionClient, userId: number, variantId: number) {
    if (!this.redisMode) {
      // Missing cart/item is already the requested end state; do not create rows.
      await tx.cartItem.deleteMany({ where: { variantId, cart: { userId } } });
      return;
    }
    // Every successful DELETE raises _hw, also for an absent or consumed line, so an
    // older in-flight PUT cannot re-add it afterwards.
    const snapshot = await this.snapshot(userId);
    const seq = await this.allocate(tx, userId, snapshot.hw);
    await this.write(userId, seq, 'del', String(variantId), '');
  }

  /**
   * nextval() after the buyer lock is held. Never setval() here: a seq at or below the
   * Redis _hw or the user's fence means the sequence went backwards (crash/restore) and
   * needs the admin recovery command; fail closed instead of guessing.
   */
  private async allocate(
    tx: Prisma.TransactionClient,
    userId: number,
    hw: string | null,
  ) {
    const [{ seq }] = await tx.$queryRaw<{ seq: string }[]>`
      SELECT nextval('cart_line_seq')::text AS seq`;
    const [{ fence }] = await tx.$queryRaw<{ fence: string }[]>`
      SELECT COALESCE(MAX("consumedSeq"), 0)::text AS fence
      FROM cart_consumed_lines WHERE "buyerId" = ${userId}`;
    const floor = [hw ?? '0', fence].reduce((a, b) =>
      BigInt(a) >= BigInt(b) ? a : b,
    );
    if (BigInt(seq) <= BigInt(floor)) {
      this.logger.error(
        `cart_line_seq is behind Redis/fence: userId=${userId} seq=${seq} floor=${floor}; run redis-cart-admin bump-sequence`,
      );
      throw cartError(
        503,
        'CART_SEQUENCE_BEHIND',
        'Giỏ hàng tạm thời không khả dụng. Vui lòng thử lại sau.',
      );
    }
    return seq;
  }

  private async write(
    userId: number,
    seq: string,
    op: CartWriteOp,
    field: string,
    value: string,
  ) {
    const applied = await this.call(() =>
      this.redis!.client.cartWrite(
        cartKey(userId),
        seq,
        op,
        field,
        value,
        this.redis!.cart.ttlSeconds,
      ),
    );
    // Under the buyer lock seq > _hw was just checked; a rejection means _hw moved
    // ahead of the sequence, i.e. the same condition as CART_SEQUENCE_BEHIND.
    if (applied !== 1) {
      this.logger.error(`Redis cart write rejected: userId=${userId} seq=${seq}`);
      throw cartError(
        503,
        'CART_SEQUENCE_BEHIND',
        'Giỏ hàng tạm thời không khả dụng. Vui lòng thử lại sau.',
      );
    }
  }

  /**
   * In the order transaction. PostgreSQL mode deletes the rows (count must match, the
   * original race guard). Redis mode records the fence; Redis itself is cleaned later.
   */
  async consume(
    tx: Prisma.TransactionClient,
    buyerId: number,
    checkoutId: number,
    lines: CartLine[],
  ): Promise<boolean> {
    if (!this.redisMode) {
      const removed = await tx.cartItem.deleteMany({
        where: {
          cart: { userId: buyerId },
          variantId: { in: lines.map((line) => line.variantId) },
        },
      });
      return removed.count === lines.length;
    }
    for (const line of lines) {
      if (!isSeq(line.seq)) return false;
      await tx.$executeRaw`
        INSERT INTO cart_consumed_lines ("buyerId", "variantId", "consumedSeq", "checkoutId", "updatedAt")
        VALUES (${buyerId}, ${line.variantId}, ${line.seq}::bigint, ${checkoutId}, CURRENT_TIMESTAMP)
        ON CONFLICT ("buyerId", "variantId") DO UPDATE SET
          "consumedSeq" = GREATEST(cart_consumed_lines."consumedSeq", EXCLUDED."consumedSeq"),
          "checkoutId" = EXCLUDED."checkoutId",
          "updatedAt" = EXCLUDED."updatedAt"`;
    }
    return true;
  }

  /** After commit, best effort: the fence already hides these lines. */
  async cleanup(buyerId: number, lines: CartLine[]) {
    if (!this.redisMode || !lines.length) return;
    const pairs = lines.flatMap((line) =>
      isSeq(line.seq) ? [String(line.variantId), line.seq] : [],
    );
    try {
      await this.redis!.client.cartCleanup(cartKey(buyerId), ...pairs);
    } catch {
      this.logger.warn(`Redis cart cleanup failed (fence holds): buyerId=${buyerId}`);
    }
  }
}
