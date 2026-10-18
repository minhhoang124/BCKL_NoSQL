import { Injectable } from '@nestjs/common';
import { assertOrderCommandNotClosed } from './order-command-fence.js';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { checkoutConfigInt } from '../checkout/checkout-create-rate.js';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from '../product/transaction-conflict.js';
import { orderCommandError } from './order-command-policy.js';
import { completeInput, autoCompleteKey } from './order-completion-request.js';
import { validateCompletionResult } from './order-completion-receipt.js';
type Input = ReturnType<typeof completeInput>;
type JobClaim = { id: number; token: string };
@Injectable()
export class OrderCompletionService {
  private readonly logger = new Logger(OrderCompletionService.name);
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

  async completeBuyer(
    actorId: number,
    orderId: number,
    key: unknown,
    body: unknown,
  ) {
    return this.execute(completeInput(actorId, orderId, key, body));
  }
  // Internal scheduler path only; no SYSTEM identity can be supplied via HTTP.
  async completeJob(id: number, token: string) {
    const job = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(this.statementMs)}, true)`;
        return tx.orderCompletionJob.findUnique({ where: { id } });
      },
      { maxWait: this.waitMs, timeout: this.transactionMs },
    );
    if (!job) throw orderCommandError(409, 'JOB_LEASE_LOST');
    return this.execute(
      completeInput(
        null,
        job.orderId,
        autoCompleteKey(job.orderId, job.deliveredAt, job.ruleVersion),
        {},
      ),
      { id, token },
    );
  }
  private async execute(input: Input, jobClaim?: JobClaim) {
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
            if (input.actorId !== null) {
              await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.actorId} FOR UPDATE`;
              const actor = await tx.user.findUnique({
                where: { id: input.actorId },
                select: { isActive: true, role: true },
              });
              if (!actor?.isActive)
                throw orderCommandError(401, 'UNAUTHORIZED');
              if (actor.role !== Role.USER)
                throw orderCommandError(403, 'FORBIDDEN');
            }
            const owner =
              input.actorId === null ? {} : { buyerId: input.actorId };
            const ref = await tx.order.findFirst({
              where: { id: input.orderId, ...owner },
              select: { storeId: true },
            });
            if (!ref) throw orderCommandError(404, 'ORDER_NOT_FOUND');
            await tx.$queryRaw`SELECT id FROM stores WHERE id = ${ref.storeId} FOR SHARE`;
            await tx.$queryRaw`SELECT id FROM orders WHERE id = ${input.orderId} FOR UPDATE`;
            const order = await tx.order.findFirst({
              where: { id: input.orderId, ...owner },
            });
            if (!order) throw orderCommandError(404, 'ORDER_NOT_FOUND');
            const clock = await tx.$queryRaw<
              { now: Date }[]
            >`SELECT CURRENT_TIMESTAMP::timestamp(3) AS now`;
            const now = clock[0]!.now;
            let job: Prisma.OrderCompletionJobGetPayload<
              Record<string, never>
            > | null = null;
            if (jobClaim) {
              await tx.$queryRaw`SELECT id FROM order_completion_jobs WHERE id = ${jobClaim.id} FOR UPDATE`;
              job = await tx.orderCompletionJob.findUnique({
                where: { id: jobClaim.id },
              });
              if (
                !job ||
                job.status !== 'RUNNING' ||
                job.leaseToken !== jobClaim.token ||
                job.orderId !== input.orderId ||
                !job.leaseExpiresAt ||
                job.leaseExpiresAt <= now
              )
                throw orderCommandError(409, 'JOB_LEASE_LOST');
            }
            const stored = await tx.orderCommand.findUnique({
              where: {
                actorScope_idempotencyKey: {
                  actorScope: input.actorScope,
                  idempotencyKey: input.idempotencyKey,
                },
              },
            });
            await assertOrderCommandNotClosed(
              tx,
              { ...input, command: 'complete' },
              stored !== null,
            );
            if (stored) {
              const response = this.replay(stored, input);
              if (job) await this.finishJob(tx, job.id, 'SUCCEEDED', now);
              return response;
            }
            if (
              job &&
              (order.status !== 'DELIVERED' ||
                !order.deliveredAt ||
                order.deliveredAt.getTime() !== job.deliveredAt.getTime())
            ) {
              await this.finishJob(tx, job.id, 'SKIPPED', now);
              return null; // Buyer won or canonical delivery changed while work waited.
            }
            if (order.status !== 'DELIVERED')
              throw orderCommandError(409, 'INVALID_ORDER_TRANSITION');
            if (
              !order.deliveredAt ||
              order.deliveredAt > now ||
              order.completedAt ||
              order.cancelledAt
            )
              throw orderCommandError(409, 'DELIVERY_STATE_CONFLICT');
            if (job && job.dueAt > now)
              throw orderCommandError(409, 'COMPLETION_NOT_DUE');
            await tx.$queryRaw`SELECT id FROM payments WHERE "orderId" = ${input.orderId} FOR UPDATE`;
            const payment = await tx.payment.findUnique({
              where: { orderId: input.orderId },
            });
            if (
              !payment ||
              !['COD', 'VNPAY', 'MOMO'].includes(payment.provider) ||
              payment.status !== 'PAID' ||
              !payment.paidAt ||
              payment.paidAt > now ||
              payment.currency !== 'VND' ||
              !payment.amount.equals(order.total)
            )
              throw orderCommandError(409, 'PAYMENT_STATE_CONFLICT');
            const claim = await tx.orderCommand.create({
              data: { ...input, command: 'complete', createdAt: now },
            });
            const changed = await tx.order.updateMany({
              where: {
                id: order.id,
                status: 'DELIVERED',
                deliveredAt: order.deliveredAt,
              },
              data: { status: 'COMPLETED', completedAt: now },
            });
            if (changed.count !== 1)
              throw orderCommandError(409, 'INVALID_ORDER_TRANSITION');
            await tx.orderStatusHistory.create({
              data: {
                orderId: order.id,
                fromStatus: 'DELIVERED',
                toStatus: 'COMPLETED',
                actorType: input.actorType,
                actorId: input.actorId,
                commandId: claim.id,
                createdAt: now,
              },
            });
            const result = validateCompletionResult(
              {
                status: 'COMPLETED',
                deliveredAt: order.deliveredAt.toISOString(),
                completedAt: now.toISOString(),
                payment: {
                  provider: payment.provider,
                  status: 'PAID',
                  amount: payment.amount.toFixed(2),
                  currency: 'VND',
                  paidAt: payment.paidAt.toISOString(),
                },
                timeline: [
                  {
                    fromStatus: 'DELIVERED',
                    toStatus: 'COMPLETED',
                    actorType: input.actorType,
                    actorId: input.actorId,
                    createdAt: now.toISOString(),
                  },
                ],
              },
              input.actorId,
            );
            await tx.orderCommand.update({
              where: { id: claim.id },
              data: {
                status: 'SUCCEEDED',
                responseStatus: 200,
                resultSnapshot: result as unknown as Prisma.InputJsonObject,
                completedAt: now,
              },
            });
            if (job) await this.finishJob(tx, job.id, 'SUCCEEDED', now);
            return {
              orderId: order.id,
              commandId: claim.id,
              command: 'complete',
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
          `Completion transaction committed: orderId=${input.orderId} actorType=${input.actorType} outcome=${response ? 'SUCCEEDED' : 'SKIPPED'} replayed=${response?.replayed ?? false}`,
        );
        return response;
      } catch (error) {
        if (
          isTransactionConflict(error) ||
          ['40001', '40P01'].includes(this.sqlState(error)) ||
          this.isScopeKeyConflict(error)
        ) {
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
  private async finishJob(
    tx: Prisma.TransactionClient,
    id: number,
    status: 'SUCCEEDED' | 'SKIPPED',
    at: Date,
  ) {
    await tx.orderCompletionJob.update({
      where: { id },
      data: {
        status,
        completedAt: at,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
  }
  private replay(
    stored: Prisma.OrderCommandGetPayload<Record<string, never>>,
    input: Input,
  ) {
    if (
      stored.orderId !== input.orderId ||
      stored.command !== 'complete' ||
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
      command: 'complete',
      replayed: true,
      result: validateCompletionResult(stored.resultSnapshot, input.actorId),
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
