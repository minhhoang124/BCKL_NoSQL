import { Injectable } from '@nestjs/common';
import { canActAsBuyer } from '../auth/buyer-access.js';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import type { OrderListResponseDto } from './order-list.dto.js';
import { orderError, parseOrderListQuery } from './order-list.http.js';
import { loadOrderItemImages } from './order-item-image.js';
import {
  buildOrderItemSummaries,
  loadOrderItemPreviewRows,
} from './order-item-preview.js';

@Injectable()
export class OrderListService {
  constructor(private readonly prisma: PrismaService) {}

  list(
    actorId: number,
    role: 'USER' | 'SELLER',
    input: unknown,
  ): Promise<OrderListResponseDto> {
    const query = parseOrderListQuery(input);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$queryRaw`SELECT set_config('statement_timeout', '2000', true)`;
        const actor = await tx.user.findUnique({
          where: { id: actorId },
          select: { isActive: true, role: true },
        });
        if (!actor?.isActive)
          throw orderError(401, 'UNAUTHORIZED', 'Vui lòng đăng nhập lại.');
        if (
          role === Role.USER ? !canActAsBuyer(actor.role) : actor.role !== role
        )
          throw orderError(
            403,
            'FORBIDDEN',
            'Bạn không có quyền thực hiện thao tác này.',
          );
        const scope: Prisma.OrderWhereInput =
          role === Role.USER
            ? { buyerId: actorId }
            : { store: { sellerId: actorId } };
        // Scope is applied in SQL, not after loading orders belonging to others.
        // A suspended Store may still read its existing business history.
        const rows = await tx.order.findMany({
          where: {
            ...scope,
            ...(query.status ? { status: query.status } : {}),
            ...(query.afterId ? { id: { lt: query.afterId } } : {}),
          },
          orderBy: { id: 'desc' },
          take: query.limit + 1,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
            createdAt: true,
            updatedAt: true,
            store: { select: { id: true, name: true } },
            payment: {
              select: {
                provider: true,
                status: true,
                amount: true,
                currency: true,
                paidAt: true,
              },
            },
          },
        });
        const page = rows.slice(0, query.limit);
        // Only IDs of the authorized page actually returned (not the +1 probe).
        const pageIds = page.map((row) => row.id);
        const previewRows = await loadOrderItemPreviewRows(tx, pageIds);
        const images = await loadOrderItemImages(
          tx,
          previewRows.map((row) => row.productId),
          role === Role.USER ? 'BUYER' : 'SELLER',
          actorId,
        );
        const summaries = buildOrderItemSummaries(pageIds, previewRows, images);
        return {
          items: page.map((row) => ({
            id: row.id,
            orderNumber: row.orderNumber,
            status: row.status,
            store: row.store,
            total: row.total.toFixed(2),
            payment: row.payment
              ? {
                  provider: row.payment.provider,
                  status: row.payment.status,
                  amount: row.payment.amount.toFixed(2),
                  currency: row.payment.currency,
                  paidAt: row.payment.paidAt?.toISOString() ?? null,
                }
              : null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            ...summaries.get(row.id)!,
          })),
          nextCursor:
            rows.length > query.limit ? page[page.length - 1]!.id : null,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 2000,
        timeout: 5000,
      },
    );
  }
}
