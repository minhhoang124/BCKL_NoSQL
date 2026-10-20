import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { checkoutConfigInt } from '../checkout/checkout-create-rate.js';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from '../product/transaction-conflict.js';
import { orderCommandError } from './order-command-policy.js';
import { assertResolutionIdentity } from './order-command-fence.js';
import {
  buyerResolutionInput,
  assertCompleteFingerprint,
  replayBuyerReceipt,
} from './buyer-command-resolution-request.js';
import {
  resolutionSqlState,
  scopeKeyConflict,
} from './order-command-resolution.service.js';

@Injectable()
export class BuyerCommandResolutionService {
  private readonly logger = new Logger(BuyerCommandResolutionService.name);
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
        'Buyer resolution requires lock <= statement <= transaction and bounded deadline',
      );
  }
  async resolve(actorId: number, orderId: number, key: unknown, body: unknown) {
    const input = buyerResolutionInput(actorId, orderId, key, body);
    const deadline = Date.now() + this.deadlineMs;
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= this.waitMs) break;
      const timeout = Math.min(this.transactionMs, remaining - this.waitMs);
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(Math.min(this.statementMs, timeout))}, true)`;
            await tx.$queryRaw`SELECT set_config('lock_timeout', ${String(Math.min(this.lockMs, timeout))}, true)`;
            // Same lock order as Buyer execution. SSI + DB opposing-table triggers
            // protect stale snapshots across processes, not an in-memory mutex.
            await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId} FOR UPDATE`;
            const actor = await tx.user.findUnique({
              where: { id: actorId },
              select: { isActive: true, role: true },
            });
            if (!actor?.isActive) throw orderCommandError(401, 'UNAUTHORIZED');
            if (actor.role !== Role.USER)
              throw orderCommandError(403, 'FORBIDDEN');
            const ref = await tx.order.findFirst({
              where: { id: orderId, buyerId: actorId },
              select: { storeId: true },
            });
            if (!ref) throw orderCommandError(404, 'ORDER_NOT_FOUND');
            await tx.$queryRaw`SELECT id FROM stores WHERE id=${ref.storeId} FOR SHARE`;
            await tx.$queryRaw`SELECT id FROM orders WHERE id=${orderId} FOR UPDATE`;
            if (
              !(await tx.order.findFirst({
                where: { id: orderId, buyerId: actorId },
                select: { id: true },
              }))
            )
              throw orderCommandError(404, 'ORDER_NOT_FOUND');
            const where = {
              actorScope_idempotencyKey: {
                actorScope: input.actorScope,
                idempotencyKey: input.idempotencyKey,
              },
            };
            const stored = await tx.orderCommand.findUnique({ where });
            const closed = await tx.orderCommandResolution.findUnique({
              where,
            });
            if (stored && closed)
              throw orderCommandError(500, 'INTERNAL_ERROR');
            if (stored)
              return {
                outcome: 'COMMITTED' as const,
                receipt: replayBuyerReceipt(stored, input),
              };
            if (closed) {
              assertResolutionIdentity(closed);
              if (
                closed.orderId !== orderId ||
                closed.command !== input.command ||
                closed.actorType !== 'BUYER' ||
                closed.requestHash !== input.requestHash
              )
                throw orderCommandError(409, 'IDEMPOTENCY_CONFLICT');
              assertCompleteFingerprint(input, 500);
            } else {
              // No-record cancel fingerprint is only a key fence, never proof of
              // the original reason and never permission to execute cancellation.
              assertCompleteFingerprint(input, 400);
            }
            const resolution =
              closed ??
              (await tx.orderCommandResolution.create({
                data: {
                  orderId,
                  actorId,
                  actorType: 'BUYER',
                  actorScope: input.actorScope,
                  idempotencyKey: input.idempotencyKey,
                  command: input.command,
                  requestHash: input.requestHash,
                  hashVersion: 1,
                },
              }));
            return {
              outcome: 'CLOSED_WITHOUT_EXECUTION' as const,
              resolutionId: resolution.id,
              orderId,
              command: input.command,
              resolvedAt: resolution.resolvedAt.toISOString(),
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: this.waitMs,
            timeout,
          },
        );
        this.logger.log(
          `Buyer command resolved: actorId=${actorId} orderId=${orderId} outcome=${result.outcome} attempt=${attempt + 1}`,
        );
        return result;
      } catch (error) {
        const state = resolutionSqlState(error);
        const retry =
          isTransactionConflict(error) ||
          ['40001', '40P01'].includes(state) ||
          scopeKeyConflict(error);
        if (retry && attempt < 2) {
          await waitForTransactionRetry(attempt);
          continue;
        }
        if (
          retry ||
          ['55P03', '57014'].includes(state) ||
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2028')
        )
          break;
        throw error;
      }
    }
    throw orderCommandError(409, 'ORDER_COMMAND_IN_PROGRESS');
  }
}
