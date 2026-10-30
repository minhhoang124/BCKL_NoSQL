import { Injectable, Logger } from '@nestjs/common';
import { assertCurrentWriteEpoch } from '../auth/write-epoch.js';
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
  resolutionSqlState,
  scopeKeyConflict,
} from './order-command-resolution.service.js';
import {
  sellerCloseResolutionInput,
  replaySellerCloseReceipt,
} from './seller-close-resolution-request.js';

@Injectable()
export class SellerCloseResolutionService {
  private readonly logger = new Logger(SellerCloseResolutionService.name);
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
        'Seller close resolution requires lock <= statement <= transaction and bounded deadline',
      );
  }
  async resolve(actorId: number, orderId: number, key: unknown, body: unknown, expectedCredentialVersion?: number) {
    const input = sellerCloseResolutionInput(actorId, orderId, key, body);
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
            // Same actor -> Store -> Order order as command execution. SSI and the
            // existing opposing-table triggers protect no-record outcomes too.
            await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId} FOR UPDATE`;
            const actor = await tx.user.findUnique({
              where: { id: actorId },
              select: { isActive: true, role: true, credentialVersion: true },
            });
            if (!actor?.isActive) throw orderCommandError(401, 'UNAUTHORIZED');
            assertCurrentWriteEpoch(actor, expectedCredentialVersion);
            if (actor.role !== Role.SELLER)
              throw orderCommandError(403, 'FORBIDDEN');
            const ref = await tx.order.findFirst({
              where: { id: orderId, store: { sellerId: actorId } },
              select: { storeId: true },
            });
            if (!ref) throw orderCommandError(404, 'ORDER_NOT_FOUND');
            await tx.$queryRaw`SELECT id FROM stores WHERE id=${ref.storeId} FOR SHARE`;
            await tx.$queryRaw`SELECT id FROM orders WHERE id=${orderId} FOR UPDATE`;
            if (
              !(await tx.order.findFirst({
                where: { id: orderId, store: { sellerId: actorId } },
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
                receipt: replaySellerCloseReceipt(stored, input),
              };
            if (closed) {
              assertResolutionIdentity(closed);
              if (
                closed.actorId !== input.actorId ||
                closed.actorScope !== input.actorScope ||
                closed.actorType !== 'SELLER' ||
                closed.orderId !== input.orderId ||
                closed.command !== input.command ||
                closed.idempotencyKey !== input.idempotencyKey ||
                closed.hashVersion !== input.hashVersion ||
                closed.requestHash !== input.requestHash
              )
                throw orderCommandError(409, 'IDEMPOTENCY_CONFLICT');
            }
            // An absent command has no authoritative original body. The submitted
            // hash is ONLY a durable key fence, never proof or execution permission.
            const resolution =
              closed ??
              (await tx.orderCommandResolution.create({
                data: {
                  actorId: input.actorId,
                  actorType: 'SELLER',
                  actorScope: input.actorScope,
                  orderId: input.orderId,
                  idempotencyKey: input.idempotencyKey,
                  command: input.command,
                  hashVersion: 1,
                  requestHash: input.requestHash,
                },
              }));
            return {
              outcome: 'CLOSED_WITHOUT_EXECUTION' as const,
              resolutionId: resolution.id,
              orderId: input.orderId,
              command: input.command,
              hashVersion: 1 as const,
              requestHash: input.requestHash,
              actorId: input.actorId,
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
          `Seller close resolved: actorId=${actorId} orderId=${orderId} outcome=${result.outcome} attempt=${attempt + 1}`,
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
