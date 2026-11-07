import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  type AftersaleCommand,
  type AftersaleRequest,
} from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { PrismaService } from '../prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { canActAsBuyer } from '../auth/buyer-access.js';
import { isAccountStatusConflict } from '../auth/account-status-sql.js';
import { waitForTransactionRetry } from '../product/transaction-conflict.js';
import { listingInclude } from '../product/product-public-policy.js';
import { SearchOutboxService } from '../search/search-outbox.service.js';
import {
  commandHash,
  commandInput,
  pageInput,
  positiveId,
  reconcileInput,
  type Action,
  type Scope,
} from './aftersales-input.js';
import {
  AftersalesPolicyError,
  assertRequestWindow,
  fullItemRefund,
  nextReturnState,
  refundEffectiveAt,
  type ReturnKind,
  type ReturnState,
} from './aftersales-policy.js';

const error = (status: number, code: string): never => {
  throw new HttpException({ statusCode: status, code }, status);
};
const requestInclude = {
  item: {
    include: {
      order: { include: { store: true, payment: true, items: true } },
    },
  },
} as const;
const readContext = {
  orderId: true,
  storeId: true,
  productNameSnapshot: true,
  quantity: true,
  lineTotal: true,
  order: { select: { buyerId: true, store: { select: { name: true } } } },
} as const;
function context(item: {
  orderId: number;
  storeId: number;
  productNameSnapshot: string;
  quantity: number;
  lineTotal: Prisma.Decimal;
  order: { buyerId: number; store: { name: string } };
}) {
  return {
    orderId: item.orderId,
    storeId: item.storeId,
    buyerId: item.order.buyerId,
    storeName: item.order.store.name,
    productName: item.productNameSnapshot,
    quantity: item.quantity,
    lineTotal: item.lineTotal.toFixed(2),
  };
}
type RequestRow = Prisma.AftersaleRequestGetPayload<{
  include: typeof requestInclude;
}>;
type Tx = Prisma.TransactionClient;
const projection = (r: AftersaleRequest) => ({
  id: r.id,
  orderItemId: r.orderItemId,
  kind: r.kind,
  state: r.state,
  revision: r.revision,
});

/** Called only while completion already holds the canonical Order UPDATE lock. */
export async function activateAftersaleAdjustments(
  tx: Tx,
  orderId: number,
  completedAt: Date,
) {
  await tx.$executeRaw`UPDATE revenue_adjustments a SET "effectiveAt"=GREATEST(r."succeededAt",${completedAt})
    FROM refund_records r JOIN order_items i ON i.id=r."orderItemId"
    WHERE a."refundId"=r.id AND i."orderId"=${orderId} AND a."effectiveAt" IS NULL`;
}

@Injectable()
export class AftersalesService {
  private readonly windowDays: number;
  constructor(
    private readonly db: PrismaService,
    private readonly outbox: SearchOutboxService,
    config: ConfigService,
  ) {
    const raw = config.get<string>('AFTERSALE_REQUEST_WINDOW_DAYS') ?? '7';
    if (!/^[1-9][0-9]?$/.test(String(raw)) || Number(raw) > 30)
      throw new Error('AFTERSALE_REQUEST_WINDOW_DAYS must be1..30');
    this.windowDays = Number(raw);
  }
  private async actor(tx: Tx, actor: AuthenticatedUser, scope: Scope) {
    const user = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { isActive: true, role: true, credentialVersion: true },
    });
    if (!user?.isActive || user.credentialVersion !== actor.credentialVersion)
      return error(401, 'UNAUTHORIZED');
    if (scope === 'BUYER' ? !canActAsBuyer(user.role) : user.role !== scope)
      return error(403, 'FORBIDDEN');
  }
  private owner(
    actor: AuthenticatedUser,
    scope: Scope,
  ): Prisma.OrderWhereInput {
    return scope === 'ADMIN'
      ? {}
      : scope === 'BUYER'
        ? { buyerId: actor.userId }
        : {
            store: {
              sellerId: actor.userId,
              status: { in: ['ACTIVE', 'SUSPENDED', 'CLOSED'] },
            },
          };
  }
  private permitted(scope: Scope, action: Action) {
    if (
      !(
        scope === 'BUYER'
          ? ['create', 'cancel', 'dispute']
          : ['approve', 'reject', 'receive']
      ).includes(action)
    )
      return error(403, 'FORBIDDEN');
  }
  private async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout='2s'`;
            await tx.$executeRaw`SET LOCAL statement_timeout='5s'`;
            return fn(tx);
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 3000,
            timeout: 10000,
          },
        );
      } catch (e) {
        if (e instanceof HttpException) throw e;
        if (e instanceof AftersalesPolicyError)
          return error(
            e.code === 'AFTERSALE_SNAPSHOT_REVIEW_REQUIRED' ? 422 : 409,
            e.code,
          );
        if (isAccountStatusConflict(e)) {
          if (attempt < 2) {
            await waitForTransactionRetry(attempt);
            continue;
          }
          return error(409, 'AFTERSALE_IN_PROGRESS');
        }
        return error(503, 'AFTERSALE_UNAVAILABLE');
      }
    }
    return error(503, 'AFTERSALE_UNAVAILABLE');
  }
  private async target(
    tx: Tx,
    actor: AuthenticatedUser,
    scope: Scope,
    action: Action,
    targetId: number,
  ) {
    const owner = this.owner(actor, scope);
    const reference =
      action === 'create'
        ? await tx.orderItem.findFirst({
            where: { id: targetId, order: owner },
            select: { id: true, orderId: true, storeId: true },
          })
        : (
            await tx.aftersaleRequest.findFirst({
              where: { id: targetId, item: { order: owner } },
              select: {
                item: { select: { id: true, orderId: true, storeId: true } },
              },
            })
          )?.item;
    if (!reference) return error(404, 'AFTERSALE_NOT_FOUND');
    await tx.$queryRaw`SELECT id FROM stores WHERE id=${reference.storeId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM orders WHERE id=${reference.orderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM payments WHERE "orderId"=${reference.orderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM order_items WHERE id=${reference.id} FOR UPDATE`;
    if (action !== 'create')
      await tx.$queryRaw`SELECT id FROM aftersale_requests WHERE id=${targetId} FOR UPDATE`;
    const item = await tx.orderItem.findFirst({
      where: { id: reference.id, order: owner },
      include: {
        order: { include: { store: true, payment: true, items: true } },
      },
    });
    if (!item) return error(404, 'AFTERSALE_NOT_FOUND');
    const current =
      action === 'create'
        ? null
        : await tx.aftersaleRequest.findUnique({
            where: { id: targetId },
            include: requestInclude,
          });
    if (action !== 'create' && !current)
      return error(404, 'AFTERSALE_NOT_FOUND');
    return { item, current };
  }
  private async receipt(tx: Tx, row: AftersaleCommand, scope: Scope) {
    if (row.outcome === 'CLOSED') {
      if (row.receipt !== null) return error(503, 'AFTERSALE_RECEIPT_INVALID');
      return null;
    }
    if (
      row.outcome !== 'APPLIED' ||
      !row.receipt ||
      typeof row.receipt !== 'object' ||
      Array.isArray(row.receipt)
    )
      return error(503, 'AFTERSALE_RECEIPT_INVALID');
    const json = row.receipt as Record<string, Prisma.JsonValue>;
    if (
      typeof json.historyId !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(json.historyId) ||
      BigInt(json.historyId) > 9223372036854775807n
    )
      return error(503, 'AFTERSALE_RECEIPT_INVALID');
    const history = await tx.aftersaleHistory.findUnique({
      where: { id: BigInt(json.historyId) },
      include: { request: true },
    });
    if (
      !history ||
      history.actorId !== row.actorId ||
      history.request.revision < history.toRevision ||
      (history.request.revision === history.toRevision &&
        history.request.state !== history.toState) ||
      (row.action === 'create'
        ? history.request.orderItemId !== row.targetId
        : history.requestId !== row.targetId)
    )
      return error(503, 'AFTERSALE_RECEIPT_INVALID');
    let expectedState: ReturnState;
    if (row.action === 'create') {
      if (
        history.fromRevision !== 0 ||
        history.toRevision !== 1 ||
        history.fromState !== null
      )
        return error(503, 'AFTERSALE_RECEIPT_INVALID');
      expectedState = 'PENDING';
    } else {
      try {
        expectedState = nextReturnState(
          history.fromState as ReturnState,
          history.request.kind as ReturnKind,
          scope,
          row.action as Exclude<Action, 'create'>,
        );
      } catch {
        return error(503, 'AFTERSALE_RECEIPT_INVALID');
      }
    }
    if (history.toState !== expectedState)
      return error(503, 'AFTERSALE_RECEIPT_INVALID');
    const originalBody: Record<string, string | number | boolean> =
      row.action === 'create'
        ? {
            kind: history.request.kind,
            reasonCode: history.request.reasonCode,
            description: history.reason,
          }
        : {
            expectedRevision: history.fromRevision,
            reason: history.reason,
            ...(row.action === 'receive'
              ? { restockable: history.request.restockable! }
              : {}),
          };
    if (
      commandHash(scope, row.action as Action, row.targetId, {
        commandId: row.commandId,
        body: originalBody,
      }) !== row.requestHash
    )
      return error(503, 'AFTERSALE_RECEIPT_INVALID');
    const refund =
      history.toState === 'REFUNDED'
        ? await tx.refundRecord.findUnique({
            where: { requestId: history.requestId },
          })
        : null;
    if (history.toState === 'REFUNDED' && !refund)
      return error(503, 'AFTERSALE_RECEIPT_INVALID');
    const expected = {
      request: {
        ...projection(history.request),
        state: history.toState,
        revision: history.toRevision,
      },
      historyId: history.id.toString(),
      refund: refund
        ? {
            id: refund.id.toString(),
            amount: refund.amount.toFixed(2),
            currency: 'VND',
            mode: 'SIMULATED',
          }
        : null,
    };
    if (!isDeepStrictEqual(row.receipt, expected))
      return error(503, 'AFTERSALE_RECEIPT_INVALID');
    return expected;
  }
  async execute(
    actor: AuthenticatedUser,
    scope: Scope,
    action: Action,
    targetId: number,
    value: unknown,
    reconcile = false,
  ) {
    positiveId(targetId);
    this.permitted(scope, action);
    const command = reconcile ? null : commandInput(action, value);
    const input = reconcile
      ? reconcileInput(value)
      : {
          commandId: command!.commandId,
          requestHash: commandHash(scope, action, targetId, command!),
        };
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.userId} FOR UPDATE`;
      await this.actor(tx, actor, scope);
      const { item, current } = await this.target(
        tx,
        actor,
        scope,
        action,
        targetId,
      );
      const stored = await tx.aftersaleCommand.findUnique({
        where: {
          actorId_commandId: {
            actorId: actor.userId,
            commandId: input.commandId,
          },
        },
      });
      if (stored) {
        if (
          stored.action !== action ||
          stored.targetId !== targetId ||
          stored.requestHash !== input.requestHash
        )
          return error(409, 'AFTERSALE_COMMAND_MISMATCH');
        const receipt = await this.receipt(tx, stored, scope);
        if (!reconcile && stored.outcome === 'CLOSED')
          return error(409, 'AFTERSALE_COMMAND_CLOSED');
        return {
          commandId: input.commandId,
          outcome: stored.outcome,
          receipt,
          current: current ? projection(current) : null,
        };
      }
      if (reconcile) {
        await tx.aftersaleCommand.create({
          data: {
            actorId: actor.userId,
            ...input,
            action,
            targetId,
            outcome: 'CLOSED',
          },
        });
        return {
          commandId: input.commandId,
          outcome: 'CLOSED',
          receipt: null,
          current: current ? projection(current) : null,
        };
      }
      const clock = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT CURRENT_TIMESTAMP::timestamp(3) AS now`;
      const now = clock[0]!.now,
        order = item.order,
        body = command!.body;
      let changed: AftersaleRequest,
        before: RequestRow | null = current;
      if (action === 'create') {
        const deadlineAt = assertRequestWindow(
          order.status,
          order.deliveredAt,
          now,
          this.windowDays,
        );
        this.amount(item.order, item.id, now);
        await this.budget(tx, item.id);
        changed = await tx.aftersaleRequest.create({
          data: {
            orderItemId: item.id,
            kind: body.kind as string,
            reasonCode: body.reasonCode as string,
            description: body.description as string,
            deadlineAt,
            createdAt: now,
            updatedAt: now,
          },
        });
      } else {
        before = current!;
        if (current!.revision !== body.expectedRevision)
          return error(409, 'AFTERSALE_REVISION_CONFLICT');
        if (current!.revision === 2147483647)
          return error(409, 'AFTERSALE_VERSION_EXHAUSTED');
        const state = nextReturnState(
          current!.state as ReturnState,
          current!.kind as ReturnKind,
          scope,
          action,
        );
        if (action === 'dispute') await this.budget(tx, item.id, current!.id);
        if (state === 'REFUNDED') this.amount(order, item.id, now);
        changed = await tx.aftersaleRequest.update({
          where: { id: current!.id },
          data: {
            state,
            revision: { increment: 1 },
            updatedAt: now,
            ...(action === 'receive'
              ? { receivedAt: now, restockable: body.restockable as boolean }
              : {}),
          },
        });
      }
      let refund: {
        id: string;
        amount: string;
        currency: string;
        mode: string;
      } | null = null;
      if (changed.state === 'REFUNDED') {
        await this.budget(tx, item.id, changed.id);
        const amount = this.amount(order, item.id, now);
        const recorded = await tx.refundRecord.create({
          data: {
            requestId: changed.id,
            orderItemId: item.id,
            paymentId: order.payment!.id,
            amount,
            succeededAt: now,
          },
        });
        await tx.revenueAdjustment.create({
          data: {
            refundId: recorded.id,
            amount: new Prisma.Decimal(amount).negated(),
            effectiveAt: refundEffectiveAt(now, order.completedAt),
            createdAt: now,
          },
        });
        if (action === 'receive' && body.restockable === true)
          await this.restock(tx, item, changed.id);
        refund = {
          id: recorded.id.toString(),
          amount,
          currency: 'VND',
          mode: 'SIMULATED',
        };
      }
      const history = await tx.aftersaleHistory.create({
        data: {
          requestId: changed.id,
          actorId: actor.userId,
          fromState: before?.state ?? null,
          toState: changed.state,
          fromRevision: before?.revision ?? 0,
          toRevision: changed.revision,
          reason: (action === 'create'
            ? body.description
            : body.reason) as string,
          createdAt: now,
        },
      });
      const receipt = {
        request: projection(changed),
        historyId: history.id.toString(),
        refund,
      };
      await tx.aftersaleCommand.create({
        data: {
          actorId: actor.userId,
          ...input,
          action,
          targetId,
          outcome: 'APPLIED',
          receipt,
        },
      });
      return {
        commandId: input.commandId,
        outcome: 'APPLIED',
        receipt,
        current: projection(changed),
      };
    });
  }
  private amount(
    order: RequestRow['item']['order'],
    itemId: number,
    now: Date,
  ) {
    if (
      !['DELIVERED', 'COMPLETED'].includes(order.status) ||
      !order.deliveredAt ||
      order.deliveredAt > now ||
      (order.status === 'COMPLETED'
        ? !order.completedAt || order.completedAt > now
        : order.completedAt !== null) ||
      !order.payment
    )
      return error(409, 'AFTERSALE_ORDER_NOT_ELIGIBLE');
    return fullItemRefund(
      {
        subtotal: order.subtotal.toFixed(2),
        total: order.total.toFixed(2),
        shippingFee: order.shippingFee.toFixed(2),
        discountTotal: order.discountTotal.toFixed(2),
        payment: {
          amount: order.payment.amount.toFixed(2),
          currency: order.payment.currency,
          status: order.payment.status,
          paidAt: order.payment.paidAt,
        },
        items: order.items.map((i) => ({
          id: i.id,
          unitPrice: i.unitPrice.toFixed(2),
          quantity: i.quantity,
          lineTotal: i.lineTotal.toFixed(2),
        })),
      },
      itemId,
      now,
    );
  }
  private async budget(tx: Tx, itemId: number, exceptId?: number) {
    if (
      (await tx.refundRecord.findUnique({ where: { orderItemId: itemId } })) ||
      (await tx.aftersaleRequest.findFirst({
        where: {
          orderItemId: itemId,
          state: { in: ['PENDING', 'DISPUTED', 'AWAITING_RETURN'] },
          ...(exceptId ? { id: { not: exceptId } } : {}),
        },
        select: { id: true },
      }))
    )
      return error(409, 'ORDER_ITEM_ALREADY_FULLY_REFUNDED');
  }
  private async restock(tx: Tx, item: RequestRow['item'], requestId: number) {
    await tx.$queryRaw`SELECT id FROM products WHERE id=${item.productId} FOR UPDATE`;
    const movements = await tx.stockMovement.findMany({
      where: {
        orderItemId: item.id,
        type: {
          in: ['CHECKOUT_DECREMENT', 'CANCELLATION_RESTORE', 'RETURN_RESTORE'],
        },
      },
    });
    if (
      movements.length !== 1 ||
      movements[0]!.type !== 'CHECKOUT_DECREMENT' ||
      movements[0]!.variantId !== item.variantId ||
      movements[0]!.quantityDelta !== -item.quantity
    )
      return error(409, 'ORDER_INVENTORY_REVIEW_REQUIRED');
    const changed = await tx.productVariant.updateMany({
      where: {
        id: item.variantId,
        productId: item.productId,
        storeId: item.storeId,
        stock: { lte: 2147483647 - item.quantity },
      },
      data: { stock: { increment: item.quantity } },
    });
    if (changed.count !== 1) return error(409, 'INVENTORY_STATE_CONFLICT');
    const variant = await tx.productVariant.findUniqueOrThrow({
      where: { id: item.variantId },
      select: { stock: true },
    });
    await tx.stockMovement.create({
      data: {
        variantId: item.variantId,
        orderItemId: item.id,
        type: 'RETURN_RESTORE',
        quantityDelta: item.quantity,
        balanceAfter: variant.stock,
        idempotencyKey: `aftersale:request:${requestId}:item:${item.id}`,
        reason: 'AFTERSALE_RESTOCKABLE',
      },
    });
    const productChanged = await tx.product.updateMany({
      where: { id: item.productId, version: { lt: 2147483647 } },
      data: { version: { increment: 1 } },
    });
    if (productChanged.count !== 1)
      return error(409, 'INVENTORY_STATE_CONFLICT');
    const product = await tx.product.findUniqueOrThrow({
      where: { id: item.productId },
      include: listingInclude,
    });
    const categories = await tx.category.findMany({
      select: { id: true, parentId: true, isActive: true },
    });
    await this.outbox.writeOutboxEvent(
      tx,
      product,
      categories,
      product.version,
    );
  }
  list(actor: AuthenticatedUser, scope: Scope, url: string) {
    const page = pageInput(url);
    return this.read(actor, scope, async (tx) => {
      const rows = await tx.aftersaleRequest.findMany({
        where: {
          item: { order: this.owner(actor, scope) },
          ...(page.before ? { id: { lt: page.before } } : {}),
        },
        orderBy: { id: 'desc' },
        take: page.limit + 1,
        include: { item: { select: readContext } },
      });
      return {
        items: rows
          .slice(0, page.limit)
          .map((row) => ({ ...projection(row), context: context(row.item) })),
        nextBeforeId:
          rows.length > page.limit ? rows[page.limit - 1]!.id : null,
      };
    });
  }
  detail(actor: AuthenticatedUser, scope: Scope, id: number, url: string) {
    positiveId(id);
    const page = pageInput(url, true);
    return this.read(actor, scope, async (tx) => {
      const row = await tx.aftersaleRequest.findFirst({
        where: { id, item: { order: this.owner(actor, scope) } },
        include: { item: { select: readContext } },
      });
      if (!row) return error(404, 'AFTERSALE_NOT_FOUND');
      const history = await tx.aftersaleHistory.findMany({
        where: {
          requestId: id,
          ...(page.before ? { toRevision: { lt: page.before } } : {}),
        },
        orderBy: { toRevision: 'desc' },
        take: page.limit + 1,
        select: {
          id: true,
          actorId: true,
          fromState: true,
          toState: true,
          fromRevision: true,
          toRevision: true,
          reason: true,
          createdAt: true,
        },
      });
      const refund = await tx.refundRecord.findUnique({
        where: { requestId: id },
        select: {
          id: true,
          amount: true,
          currency: true,
          mode: true,
          succeededAt: true,
        },
      });
      return {
        context: context(row.item),
        request: {
          ...projection(row),
          reasonCode: row.reasonCode,
          description: row.description,
          deadlineAt: row.deadlineAt,
          receivedAt: row.receivedAt,
          restockable: row.restockable,
        },
        history: history
          .slice(0, page.limit)
          .map((h) => ({ ...h, id: h.id.toString() })),
        nextBeforeRevision:
          history.length > page.limit
            ? history[page.limit - 1]!.toRevision
            : null,
        refund: refund
          ? {
              ...refund,
              id: refund.id.toString(),
              amount: refund.amount.toFixed(2),
            }
          : null,
      };
    });
  }
  private read<T>(
    actor: AuthenticatedUser,
    scope: Scope,
    fn: (tx: Tx) => Promise<T>,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout='5s'`;
        await this.actor(tx, actor, scope);
        return fn(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 7000,
        maxWait: 2000,
      },
    );
  }
}
