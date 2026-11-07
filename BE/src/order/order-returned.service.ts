import { Injectable, Logger } from '@nestjs/common';
import { assertCurrentWriteEpoch } from '../auth/write-epoch.js';
import { assertOrderCommandNotClosed } from './order-command-fence.js';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { checkoutConfigInt } from '../checkout/checkout-create-rate.js';
import { PrismaService } from '../prisma.service.js';
import { listingInclude } from '../product/product-public-policy.js';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from '../product/transaction-conflict.js';
import { SearchOutboxService } from '../search/search-outbox.service.js';
import { orderCommandError } from './order-command-policy.js';
import {
  prepareReturnedCommand,
  type ReturnedActor,
} from './order-returned-request.js';
import { validateReturnedResult } from './order-returned-receipt.js';

type Input = ReturnType<typeof prepareReturnedCommand>;
const MAX_INT = 2147483647;

@Injectable()
export class OrderReturnedService {
  private readonly logger = new Logger(OrderReturnedService.name);
  private readonly statementMs: number;
  private readonly lockMs: number;
  private readonly transactionMs: number;
  private readonly waitMs: number;
  private readonly deadlineMs: number;
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: SearchOutboxService,
    config: ConfigService,
  ) {
    this.statementMs = checkoutConfigInt(
      config,
      'ORDER_COMMAND_STATEMENT_TIMEOUT_MS',
      2000,
    );
    this.lockMs = checkoutConfigInt(
      config,
      'ORDER_COMMAND_LOCK_TIMEOUT_MS',
      1000,
    );
    this.transactionMs = checkoutConfigInt(
      config,
      'ORDER_COMMAND_TRANSACTION_TIMEOUT_MS',
      5000,
    );
    this.waitMs = checkoutConfigInt(config, 'ORDER_COMMAND_MAX_WAIT_MS', 2000);
    this.deadlineMs = checkoutConfigInt(
      config,
      'ORDER_COMMAND_DEADLINE_MS',
      22000,
    );
    if (
      this.lockMs > this.statementMs ||
      this.statementMs > this.transactionMs ||
      this.deadlineMs <= this.waitMs
    )
      throw new Error('Order command timeout hierarchy invalid');
  }
  async execute(
    actorId: number,
    actorType: ReturnedActor,
    orderId: number,
    key: unknown,
    body: unknown,
    expectedCredentialVersion?: number,
  ) {
    const input = prepareReturnedCommand(
      actorId,
      actorType,
      orderId,
      key,
      body,
    );
    const deadline = Date.now() + this.deadlineMs;
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= this.waitMs) break;
      const timeout = Math.min(this.transactionMs, remaining - this.waitMs);
      try {
        const response = await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(Math.min(this.statementMs, timeout))}, true)`;
            await tx.$queryRaw`SELECT set_config('lock_timeout', ${String(Math.min(this.lockMs, timeout))}, true)`;
            // User-wide lock protects scope/key even across distinct Orders/processes.
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
            const actor = await tx.user.findUnique({
              where: { id: actorId },
              select: { isActive: true, role: true, credentialVersion: true },
            });
            if (!actor?.isActive) throw orderCommandError(401, 'UNAUTHORIZED');
            assertCurrentWriteEpoch(actor, expectedCredentialVersion);
            if (
              actor.role !== (actorType === 'ADMIN' ? Role.ADMIN : Role.SELLER)
            )
              throw orderCommandError(403, 'FORBIDDEN');
            const owner =
              actorType === 'SELLER' ? { store: { sellerId: actorId } } : {};
            const reference = await tx.order.findFirst({
              where: { id: orderId, ...owner },
              select: { storeId: true },
            });
            if (!reference) throw orderCommandError(404, 'ORDER_NOT_FOUND');
            await tx.$queryRaw`SELECT id FROM stores WHERE id = ${reference.storeId} FOR SHARE`;
            await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
            const order = await tx.order.findFirst({
              where: { id: orderId, ...owner },
              include: {
                store: { select: { status: true } },
                items: { orderBy: { id: 'asc' } },
                currentAttempt: true,
              },
            });
            if (!order) throw orderCommandError(404, 'ORDER_NOT_FOUND');
            const stored = await tx.orderCommand.findUnique({
              where: {
                actorScope_idempotencyKey: {
                  actorScope: input.actorScope,
                  idempotencyKey: input.idempotencyKey,
                },
              },
            });
            await assertOrderCommandNotClosed(tx, input, stored !== null);
            if (stored) return this.replay(stored, input);
            if (
              actorType === 'SELLER' &&
              !['ACTIVE', 'SUSPENDED'].includes(order.store.status)
            )
              throw orderCommandError(409, 'STORE_STATE_CONFLICT');
            if (order.status !== 'DELIVERY_FAILED')
              throw orderCommandError(409, 'INVALID_ORDER_TRANSITION');
            if (
              !order.currentAttempt ||
              order.currentDeliveryAttempt === null ||
              order.retryCount !== order.currentDeliveryAttempt - 1 ||
              order.currentAttempt.deliveryAttempt !==
                order.currentDeliveryAttempt ||
              order.deliveredAt ||
              order.completedAt ||
              order.cancelledAt
            )
              throw orderCommandError(409, 'DELIVERY_STATE_CONFLICT');
            await tx.$queryRaw`SELECT id FROM payments WHERE "orderId" = ${orderId} FOR UPDATE`;
            const payment = await tx.payment.findUnique({ where: { orderId } });
            if (
              !payment ||
              payment.provider !== 'COD' ||
              payment.status !== 'UNPAID' ||
              payment.paidAt !== null ||
              payment.currency !== 'VND' ||
              !payment.amount.equals(order.total)
            )
              throw orderCommandError(409, 'PAYMENT_STATE_CONFLICT');
            if (input.body.restockable && !order.items.length)
              throw orderCommandError(409, 'ORDER_INVENTORY_REVIEW_REQUIRED');
            const productIds = input.body.restockable
              ? [...new Set(order.items.map((item) => item.productId))].sort(
                  (a, b) => a - b,
                )
              : [];
            if (productIds.length)
              await tx.$queryRaw(
                Prisma.sql`SELECT id FROM products WHERE id IN (${Prisma.join(productIds)}) ORDER BY id FOR UPDATE`,
              );
            const movements = await tx.stockMovement.findMany({
              where: {
                orderItemId: { in: order.items.map((item) => item.id) },
                type: {
                  in: [
                    'CHECKOUT_DECREMENT',
                    'CANCELLATION_RESTORE',
                    'RETURN_RESTORE',
                  ],
                },
              },
            });
            for (const item of input.body.restockable ? order.items : []) {
              const own = movements.filter(
                (movement) => movement.orderItemId === item.id,
              );
              if (
                own.length !== 1 ||
                own[0]!.type !== 'CHECKOUT_DECREMENT' ||
                own[0]!.variantId !== item.variantId ||
                own[0]!.quantityDelta !== -item.quantity
              )
                throw orderCommandError(409, 'ORDER_INVENTORY_REVIEW_REQUIRED');
            }
            const claim = await tx.orderCommand.create({
              data: {
                orderId,
                actorScope: input.actorScope,
                actorType,
                actorId,
                idempotencyKey: input.idempotencyKey,
                command: 'confirm-returned',
                requestHash: input.requestHash,
                hashVersion: 1,
              },
            });
            for (const item of input.body.restockable ? order.items : []) {
              const changed = await tx.productVariant.updateMany({
                where: {
                  id: item.variantId,
                  productId: item.productId,
                  storeId: item.storeId,
                  stock: { lte: MAX_INT - item.quantity },
                },
                data: { stock: { increment: item.quantity } },
              });
              if (changed.count !== 1)
                throw orderCommandError(409, 'INVENTORY_STATE_CONFLICT');
              const variant = await tx.productVariant.findUniqueOrThrow({
                where: { id: item.variantId },
                select: { stock: true },
              });
              await tx.stockMovement.create({
                data: {
                  variantId: item.variantId,
                  orderItemId: item.id,
                  type: 'CANCELLATION_RESTORE',
                  quantityDelta: item.quantity,
                  balanceAfter: variant.stock,
                  idempotencyKey: `returned:order:${orderId}:item:${item.id}`,
                  reason: input.body.reasonCode,
                },
              });
            }
            const categories = await tx.category.findMany({
              select: { id: true, parentId: true, isActive: true },
            });
            for (const id of productIds) {
              const changed = await tx.product.updateMany({
                where: { id, version: { lt: MAX_INT } },
                data: { version: { increment: 1 } },
              });
              if (changed.count !== 1)
                throw orderCommandError(409, 'INVENTORY_STATE_CONFLICT');
              const product = await tx.product.findUniqueOrThrow({
                where: { id },
                include: listingInclude,
              });
              await this.outbox.writeOutboxEvent(
                tx,
                product,
                categories,
                product.version,
              );
            }
            const now = new Date(
              Math.max(Date.now(), claim.createdAt.getTime()),
            );
            const updated = await tx.order.updateMany({
              where: { id: orderId, status: order.status },
              data: {
                status: 'CANCELLED',
                cancelledById: actorId,
                cancelledByType: actorType,
                cancellationReasonCode: input.body.reasonCode,
                cancellationReasonText: input.body.reasonText,
                cancelledAt: now,
              },
            });
            if (updated.count !== 1)
              throw orderCommandError(409, 'ORDER_CANNOT_CANCEL');
            const paid = await tx.payment.updateMany({
              where: {
                id: payment.id,
                status: 'UNPAID',
                provider: 'COD',
                paidAt: null,
              },
              data: { status: 'CANCELLED' },
            });
            if (paid.count !== 1)
              throw orderCommandError(409, 'PAYMENT_STATE_CONFLICT');
            const history = await tx.orderStatusHistory.create({
              data: {
                orderId,
                commandId: claim.id,
                fromStatus: order.status,
                toStatus: 'CANCELLED',
                actorId,
                actorType,
                reasonCode: input.body.reasonCode,
                reasonText: input.body.reasonText,
                restockable: input.body.restockable,
                receiptReference: input.body.receiptReference,
                deliveryAttempt: order.currentDeliveryAttempt,
                trackingReference: order.currentAttempt.trackingReference,
                createdAt: now,
              },
            });
            const result = validateReturnedResult(
              {
                status: 'CANCELLED',
                payment: {
                  provider: 'COD',
                  status: 'CANCELLED',
                  amount: payment.amount.toFixed(2),
                  currency: 'VND',
                  paidAt: null,
                },
                cancellation: {
                  cancelledBy: { type: actorType, id: actorId },
                  reasonCode: input.body.reasonCode,
                  reasonText: input.body.reasonText,
                  cancelledAt: now.toISOString(),
                },
                restockable: input.body.restockable,
                receiptReference: input.body.receiptReference,
                delivery: {
                  deliveryAttempt: order.currentDeliveryAttempt,
                  retryCount: order.retryCount,
                  trackingReference: order.currentAttempt.trackingReference,
                },
                timeline: [
                  {
                    fromStatus: history.fromStatus,
                    toStatus: 'CANCELLED',
                    actorType,
                    actorId,
                    reasonCode: input.body.reasonCode,
                    reasonText: input.body.reasonText,
                    restockable: input.body.restockable,
                    receiptReference: input.body.receiptReference,
                    deliveryAttempt: order.currentDeliveryAttempt,
                    trackingReference: order.currentAttempt.trackingReference,
                    createdAt: now.toISOString(),
                  },
                ],
              },
              actorId,
              actorType,
              input.body,
            );
            await tx.orderCommand.update({
              where: { id: claim.id },
              data: {
                status: 'SUCCEEDED',
                responseStatus: 200,
                resultSnapshot: result as unknown as Prisma.InputJsonObject,
                completedAt: new Date(Math.max(Date.now(), now.getTime())),
              },
            });
            return {
              orderId,
              commandId: claim.id,
              command: 'confirm-returned',
              replayed: false,
              result,
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: this.waitMs,
            timeout,
          },
        );
        this.logger.log(
          `Return closure committed: orderId=${orderId} actorType=${actorType} replayed=${response.replayed}`,
        );
        return response;
      } catch (error) {
        if (
          isTransactionConflict(error) ||
          ['40001', '40P01'].includes(this.sqlState(error)) ||
          this.scopeConflict(error)
        ) {
          this.logger.warn(
            `Return closure conflict: orderId=${orderId} attempt=${attempt + 1}`,
          );
          if (attempt < 2) {
            await waitForTransactionRetry(attempt);
            continue;
          }
          break;
        }
        if (
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2028') ||
          ['55P03', '57014'].includes(this.sqlState(error))
        )
          break;
        throw error;
      }
    }
    throw orderCommandError(409, 'ORDER_COMMAND_IN_PROGRESS');
  }
  private replay(
    stored: Prisma.OrderCommandGetPayload<Record<string, never>>,
    input: Input,
  ) {
    if (
      stored.orderId !== input.orderId ||
      stored.command !== 'confirm-returned' ||
      stored.requestHash !== input.requestHash
    )
      throw orderCommandError(409, 'IDEMPOTENCY_CONFLICT');
    if (
      stored.actorScope !== input.actorScope ||
      stored.actorType !== input.actorType ||
      stored.actorId !== input.actorId ||
      stored.hashVersion !== 1
    )
      throw orderCommandError(500, 'INTERNAL_ERROR');
    if (stored.status !== 'SUCCEEDED')
      throw orderCommandError(409, 'ORDER_COMMAND_IN_PROGRESS');
    if (stored.responseStatus !== 200 || !stored.completedAt)
      throw orderCommandError(500, 'INTERNAL_ERROR');
    return {
      orderId: input.orderId,
      commandId: stored.id,
      command: 'confirm-returned',
      replayed: true,
      result: validateReturnedResult(
        stored.resultSnapshot,
        input.actorId,
        input.actorType,
        input.body,
      ),
    };
  }
  private sqlState(error: unknown): string {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2010'
    )
      return '';
    const adapter = error.meta?.driverAdapterError;
    const cause =
      adapter && typeof adapter === 'object' && 'cause' in adapter
        ? adapter.cause
        : null;
    return String(
      error.meta?.code ??
        (cause && typeof cause === 'object' && 'originalCode' in cause
          ? cause.originalCode
          : ''),
    );
  }
  private scopeConflict(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    )
      return false;
    const target = error.meta?.target;
    return (
      Array.isArray(target) &&
      target.length === 2 &&
      target.includes('actorScope') &&
      target.includes('idempotencyKey')
    );
  }
}
