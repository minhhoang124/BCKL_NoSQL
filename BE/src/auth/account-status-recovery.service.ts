import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import type { AuthenticatedUser } from './auth.types.js';
import {
  matchStatusIntent,
  statusIntent,
  statusIntentData,
  statusReceipt,
} from './account-status-command.js';
import { isAccountStatusConflict } from './account-status-sql.js';
import { waitForTransactionRetry } from '../product/transaction-conflict.js';

export function accountHistoryQuery(url: string) {
  const values = new URL(url, 'http://localhost').searchParams;
  const result: { limit: number; beforeRevision?: number } = { limit: 20 };
  const seen = new Set<string>();
  for (const [key, value] of values) {
    if (
      !['limit', 'beforeRevision'].includes(key) ||
      seen.has(key) ||
      !/^[1-9][0-9]*$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > (key === 'limit' ? 50 : 2147483647)
    )
      throw new BadRequestException('Phân trang audit không hợp lệ');
    seen.add(key);
    result[key as keyof typeof result] = Number(value);
  }
  return result;
}
@Injectable()
export class AccountStatusRecoveryService {
  constructor(private readonly prisma: PrismaService) {}
  private targetId(id: number) {
    if (!Number.isInteger(id) || id < 1 || id > 2147483647)
      throw new BadRequestException('ID không hợp lệ');
  }
  private async actor(tx: Prisma.TransactionClient, actor: AuthenticatedUser) {
    const user = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { isActive: true, credentialVersion: true, role: true },
    });
    if (!user?.isActive || user.credentialVersion !== actor.credentialVersion)
      throw new UnauthorizedException();
    if (user.role !== Role.ADMIN) throw new ForbiddenException();
  }
  history(actor: AuthenticatedUser, id: number, url: string) {
    this.targetId(id);
    const page = accountHistoryQuery(url);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
        await this.actor(tx, actor);
        const account = await tx.user.findUnique({
          where: { id },
          select: { id: true, isActive: true, statusRevision: true },
        });
        if (!account) throw new NotFoundException();
        const rows = await tx.accountStatusHistory.findMany({
          where: {
            targetId: id,
            ...(page.beforeRevision === undefined
              ? {}
              : { toRevision: { lt: page.beforeRevision } }),
          },
          orderBy: { toRevision: 'desc' },
          take: page.limit + 1,
          select: {
            id: true,
            actorId: true,
            targetId: true,
            beforeActive: true,
            afterActive: true,
            fromRevision: true,
            toRevision: true,
            reason: true,
            createdAt: true,
          },
        });
        return {
          account,
          items: rows
            .slice(0, page.limit)
            .map((row) => ({ ...row, id: row.id.toString() })),
          nextBeforeRevision:
            rows.length > page.limit ? rows[page.limit - 1].toRevision : null,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 7000,
        maxWait: 2000,
      },
    );
  }
  async reconcile(actor: AuthenticatedUser, id: number, body: unknown) {
    this.targetId(id);
    const input = statusIntent(body),
      data = statusIntentData(actor.userId, id, input);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
            await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(190311, 1)`;
            await tx.$queryRaw`SELECT id FROM users WHERE id IN (${actor.userId}, ${id}) ORDER BY id FOR UPDATE`;
            await this.actor(tx, actor);
            const current = await tx.user.findUnique({
              where: { id },
              select: { id: true, isActive: true, statusRevision: true },
            });
            if (!current) throw new NotFoundException();
            let row = await tx.accountStatusCommand.findUnique({
              where: {
                actorId_commandId: {
                  actorId: actor.userId,
                  commandId: input.commandId,
                },
              },
            });
            if (!row)
              row = await tx.accountStatusCommand.create({
                data: { ...data, outcome: 'CLOSED' },
              });
            matchStatusIntent(row, data);
            const receipt = await statusReceipt(tx, row);
            return {
              commandId: input.commandId,
              outcome: row.outcome,
              current,
              receipt,
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 8000,
            maxWait: 3000,
          },
        );
      } catch (error) {
        if (error instanceof HttpException) throw error;
        if (isAccountStatusConflict(error)) {
          if (attempt < 2) {
            await waitForTransactionRetry(attempt);
            continue;
          }
          throw new ConflictException({
            statusCode: 409,
            code: 'ACCOUNT_STATUS_IN_PROGRESS',
          });
        }
        throw new ServiceUnavailableException({
          statusCode: 503,
          code: 'ACCOUNT_STATUS_UNAVAILABLE',
        });
      }
    }
    throw new ServiceUnavailableException();
  }
}
