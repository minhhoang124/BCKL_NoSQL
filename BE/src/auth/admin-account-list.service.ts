import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import type { AccountListQuery } from './admin-account-list.js';

const accountSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  store: { select: { id: true, name: true, status: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminAccountListService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actorId: number, query: AccountListQuery) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
        const actor = await tx.user.findUnique({
          where: { id: actorId },
          select: { isActive: true, role: true },
        });
        if (!actor?.isActive) throw new UnauthorizedException();
        if (actor.role !== Role.ADMIN) throw new ForbiddenException();
        // Prisma contains uses SQL LIKE; escape metacharacters for literal text search.
        const text = query.q?.replace(/[\\%_]/g, '\\$&');
        const rows = await tx.user.findMany({
          where: {
            id: query.afterId === undefined ? undefined : { gt: query.afterId },
            role: query.role,
            isActive: query.isActive,
            ...(text
              ? {
                  OR: [
                    { email: { contains: text, mode: 'insensitive' as const } },
                    {
                      fullName: {
                        contains: text,
                        mode: 'insensitive' as const,
                      },
                    },
                  ],
                }
              : {}),
          },
          select: accountSelect,
          orderBy: { id: 'asc' },
          take: query.limit + 1,
        });
        const items = rows.slice(0, query.limit);
        return {
          items,
          nextCursor:
            rows.length > query.limit ? items[items.length - 1].id : null,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 7000,
        maxWait: 2000,
      },
    );
  }
}
