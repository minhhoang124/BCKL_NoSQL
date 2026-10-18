import { Injectable, Logger } from '@nestjs/common';
import { assertOrderCommandNotClosed } from './order-command-fence.js';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { checkoutConfigInt } from '../checkout/checkout-create-rate.js';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from '../product/transaction-conflict.js';
import {
  prepareDeliveryCommand,
  deliveryDecision,
  type DeliveryCommand,
} from './order-delivery-request.js';
import { orderCommandError } from './order-command-policy.js';
import { validateDeliveryResult } from './order-delivery-receipt.js';

type Prepared = ReturnType<typeof prepareDeliveryCommand>;

@Injectable()
export class OrderDeliveryService {
  private readonly logger = new Logger(OrderDeliveryService.name);
  private readonly statementMs: number;
  private readonly lockMs: number;
  private readonly transactionMs: number;
  private readonly waitMs: number;
  private readonly deadlineMs: number;
  constructor(
    private readonly prisma: PrismaService,
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
      throw new Error(
        'Order command requires lock <= statement <= transaction and deadline > pool wait',
      );
  }

  async execute(
    actorId: number,
    orderId: number,
    command: DeliveryCommand,
    key: unknown,
    body: unknown,
  ) {
    const input = prepareDeliveryCommand(actorId, orderId, command, key, body);
    const deadline = Date.now() + this.deadlineMs;
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= this.waitMs) break;
      try {
        const timeout = Math.min(this.transactionMs, remaining - this.waitMs);
        const response = await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(Math.min(this.statementMs, timeout))}, true)`;
            await tx.$queryRaw`SELECT set_config('lock_timeout', ${String(Math.min(this.lockMs, timeout))}, true)`;
            // One actor-wide DB lock also serializes scope/key across DIFFERENT Orders.
            // Every future command writer must follow User -> Store -> Order -> Product.
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
            const actor = await tx.user.findUnique({
              where: { id: actorId },
              select: { isActive: true, role: true },
            });
            if (!actor?.isActive) throw orderCommandError(401, 'UNAUTHORIZED');
            if (actor.role !== Role.ADMIN)
              throw orderCommandError(403, 'FORBIDDEN');
            const reference = await tx.order.findFirst({
              where: { id: orderId },
              select: { storeId: true },
            });
            if (!reference) throw orderCommandError(404, 'ORDER_NOT_FOUND');
            await tx.$queryRaw`SELECT id FROM stores WHERE id = ${reference.storeId} FOR SHARE`;
            await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
            const order = await tx.order.findFirst({
              where: { id: orderId },
              select: {
                id: true,
                status: true,
                total: true,
                currentDeliveryAttempt: true,
                retryCount: true,
                currentAttempt: {
                  select: { deliveryAttempt: true, trackingReference: true },
                },
                deliveredAt: true,
                cancelledAt: true,
                completedAt: true,
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
            if (stored) return this.replay(stored, input, command);
            const decision = deliveryDecision(command, input.body, order);
            const target = decision.status;
            if (order.deliveredAt || order.cancelledAt || order.completedAt)
              throw orderCommandError(409, 'DELIVERY_STATE_CONFLICT');
            await tx.$queryRaw`SELECT id FROM payments WHERE "orderId" = ${orderId} FOR UPDATE`;
            const payment = await tx.payment.findUnique({ where: { orderId } });
            if (
              !payment ||
              payment.currency !== 'VND' ||
              !payment.amount.equals(order.total) ||
              !(
                (payment.provider === 'COD' &&
                  payment.status === 'UNPAID' &&
                  payment.paidAt === null) ||
                (['VNPAY', 'MOMO'].includes(payment.provider) &&
                  payment.status === 'PAID' &&
                  payment.paidAt !== null)
              )
            )
              throw orderCommandError(409, 'PAYMENT_STATE_CONFLICT');
            // The deferred DB trigger prohibits committing this claim unfinished.
            const claim = await tx.orderCommand.create({
              data: {
                orderId,
                actorScope: input.actorScope,
                actorType: 'ADMIN',
                actorId,
                idempotencyKey: input.idempotencyKey,
                command,
                requestHash: input.requestHash,
                hashVersion: 1,
              },
            });
            if (decision.newAttempt)
              await tx.deliveryAttempt.create({
                data: {
                  orderId,
                  deliveryAttempt: decision.deliveryAttempt,
                  trackingReference: input.body.trackingReference,
                },
              });
            const now = new Date(
              Math.max(Date.now(), claim.createdAt.getTime()),
            );
            const delivered = command === 'mark-delivered';
            if (delivered && payment.provider === 'COD')
              await tx.payment.update({
                where: { id: payment.id },
                data: { status: 'PAID', paidAt: now },
              });
            const updated = await tx.order.updateMany({
              where: {
                id: orderId,
                status: order.status,
                currentDeliveryAttempt: order.currentDeliveryAttempt,
              },
              data: {
                status: target,
                ...(decision.newAttempt
                  ? {
                      currentDeliveryAttempt: decision.deliveryAttempt,
                      retryCount: decision.retryCount,
                    }
                  : {}),
                ...(delivered ? { deliveredAt: now } : {}),
              },
            });
            if (updated.count !== 1)
              throw orderCommandError(409, 'INVALID_ORDER_TRANSITION');
            const history = await tx.orderStatusHistory.create({
              data: {
                orderId,
                commandId: claim.id,
                fromStatus: order.status,
                toStatus: target,
                actorId,
                actorType: 'ADMIN',
                deliveryAttempt: decision.deliveryAttempt,
                trackingReference: input.body.trackingReference,
                reasonCode: input.body.reasonCode ?? null,
                reasonText: input.body.reasonText ?? null,
              },
            });
            const result = validateDeliveryResult(
              {
                status: target,
                delivery: {
                  deliveryAttempt: decision.deliveryAttempt,
                  retryCount: decision.retryCount,
                  trackingReference: input.body.trackingReference,
                },
                deliveredAt: delivered ? now.toISOString() : null,
                payment: {
                  provider: payment.provider,
                  status:
                    delivered && payment.provider === 'COD'
                      ? 'PAID'
                      : payment.status,
                  amount: payment.amount.toFixed(2),
                  currency: payment.currency,
                  paidAt:
                    delivered && payment.provider === 'COD'
                      ? now.toISOString()
                      : (payment.paidAt?.toISOString() ?? null),
                },
                cancellation: null,
                timeline: [
                  {
                    fromStatus: history.fromStatus,
                    toStatus: history.toStatus,
                    actorId,
                    actorType: 'ADMIN',
                    createdAt: history.createdAt.toISOString(),
                    deliveryAttempt: decision.deliveryAttempt,
                    trackingReference: input.body.trackingReference,
                    reasonCode: input.body.reasonCode ?? null,
                    reasonText: input.body.reasonText ?? null,
                  },
                ],
              },
              command,
              actorId,
              input.body,
            );
            await tx.orderCommand.update({
              where: { id: claim.id },
              data: {
                status: 'SUCCEEDED',
                responseStatus: 200,
                resultSnapshot: result as unknown as Prisma.InputJsonObject,
                // Avoid clock skew between application and PostgreSQL defaults.
                completedAt: new Date(
                  Math.max(
                    Date.now(),
                    claim.createdAt.getTime(),
                    history.createdAt.getTime(),
                  ),
                ),
              },
            });
            return {
              orderId,
              commandId: claim.id,
              command,
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
          `Order command committed: actorId=${actorId} orderId=${orderId} command=${command} replayed=${response.replayed}`,
        );
        return response;
      } catch (error) {
        if (
          isTransactionConflict(error) ||
          ['40001', '40P01'].includes(this.sqlState(error)) ||
          this.isScopeKeyConflict(error)
        ) {
          this.logger.warn(
            `Order command conflict: actorId=${actorId} orderId=${orderId} command=${command} attempt=${attempt + 1}`,
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
    input: Prepared,
    command: DeliveryCommand,
  ) {
    if (stored.orderId !== input.orderId || stored.command !== command)
      throw orderCommandError(409, 'IDEMPOTENCY_CONFLICT');
    if (
      stored.actorScope !== input.actorScope ||
      stored.actorType !== 'ADMIN' ||
      stored.actorId !== input.actorId ||
      stored.hashVersion !== 1
    )
      throw orderCommandError(500, 'INTERNAL_ERROR');
    if (stored.requestHash !== input.requestHash)
      throw orderCommandError(409, 'IDEMPOTENCY_CONFLICT');
    if (stored.status !== 'SUCCEEDED')
      throw orderCommandError(409, 'ORDER_COMMAND_IN_PROGRESS');
    if (stored.responseStatus !== 200 || !stored.completedAt)
      throw orderCommandError(500, 'INTERNAL_ERROR');
    return {
      orderId: input.orderId,
      commandId: stored.id,
      command,
      replayed: true,
      result: validateDeliveryResult(
        stored.resultSnapshot,
        command,
        input.actorId,
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
  private isScopeKeyConflict(error: unknown): boolean {
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
