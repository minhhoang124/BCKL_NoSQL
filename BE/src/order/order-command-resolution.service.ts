import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { checkoutConfigInt } from '../checkout/checkout-create-rate.js';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from '../product/transaction-conflict.js';
import { prepareOrderCommand } from './order-command-request.js';
import { orderCommandError } from './order-command-policy.js';
import { SellerOrderCommandService } from './seller-order-command.service.js';
import type { SellerPreparationCommand } from './seller-order-command-receipt.js';

export function parseResolutionCommand(
  body: unknown,
): SellerPreparationCommand {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Reflect.ownKeys(body).length !== 1 ||
    !Object.hasOwn(body, 'command')
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  const value = (body as { command: unknown }).command;
  if (
    value !== 'confirm' &&
    value !== 'start-packing' &&
    value !== 'ready-to-ship'
  )
    throw orderCommandError(400, 'VALIDATION_ERROR');
  return value;
}

@Injectable()
export class OrderCommandResolutionService {
  private readonly logger = new Logger(OrderCommandResolutionService.name);
  private readonly statementMs: number;
  private readonly lockMs: number;
  private readonly transactionMs: number;
  private readonly waitMs: number;
  private readonly deadlineMs: number;
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly commands: SellerOrderCommandService,
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
        'Order resolution requires lock <= statement <= transaction and bounded deadline',
      );
  }
  async resolve(actorId: number, orderId: number, key: unknown, body: unknown) {
    const command = parseResolutionCommand(body);
    // The key/hash belongs to ORIGINAL execution, not this resolver request body.
    const input = prepareOrderCommand({
      actorId,
      actorType: 'SELLER',
      orderId,
      command,
      idempotencyKey: key,
      body: {},
    });
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
            await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId} FOR UPDATE`;
            const actor = await tx.user.findUnique({
              where: { id: actorId },
              select: { isActive: true, role: true },
            });
            if (!actor?.isActive) throw orderCommandError(401, 'UNAUTHORIZED');
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
                receipt: this.commands.replayReceipt(stored, input, command),
              };
            if (closed) {
              if (
                closed.orderId !== orderId ||
                closed.command !== command ||
                closed.requestHash !== input.requestHash
              )
                throw orderCommandError(409, 'IDEMPOTENCY_CONFLICT');
              if (
                closed.actorId !== actorId ||
                closed.actorType !== 'SELLER' ||
                closed.actorScope !== input.actorScope ||
                closed.hashVersion !== 1 ||
                !Number.isInteger(closed.id) ||
                closed.id < 1 ||
                !Number.isFinite(closed.resolvedAt.getTime())
              )
                throw orderCommandError(500, 'INTERNAL_ERROR');
            }
            const resolution =
              closed ??
              (await tx.orderCommandResolution.create({
                data: {
                  orderId,
                  actorId,
                  actorType: 'SELLER',
                  actorScope: input.actorScope,
                  idempotencyKey: input.idempotencyKey,
                  command,
                  requestHash: input.requestHash,
                  hashVersion: 1,
                },
              }));
            return {
              outcome: 'CLOSED_WITHOUT_EXECUTION' as const,
              resolutionId: resolution.id,
              orderId,
              command,
              resolvedAt: resolution.resolvedAt.toISOString(),
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: this.waitMs,
            timeout,
          },
        );
        // No success response escapes before the transaction promise commits.
        this.logger.log(
          `Order command resolved: actorId=${actorId} orderId=${orderId} outcome=${result.outcome}`,
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
export function resolutionSqlState(error: unknown): string {
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
export function scopeKeyConflict(error: unknown): boolean {
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
