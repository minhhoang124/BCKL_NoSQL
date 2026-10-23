import { Injectable } from '@nestjs/common';
import { canActAsBuyer } from '../auth/buyer-access.js';
import { OrderActorType, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import type { OrderDetailResponseDto } from './order-detail.dto.js';
import { orderError } from './order-list.http.js';

export function parseOrderDetailInput(id: unknown, query: unknown): number {
  if (
    typeof id !== 'string' ||
    !/^[1-9][0-9]*$/.test(id) ||
    !Number.isSafeInteger(Number(id)) ||
    Number(id) > 2147483647 ||
    !query ||
    typeof query !== 'object' ||
    Array.isArray(query) ||
    Object.keys(query).length !== 0
  )
    throw orderError(
      400,
      'VALIDATION_ERROR',
      'Yêu cầu chi tiết đơn không hợp lệ.',
    );
  return Number(id);
}

// Only the snapshot formats written by Checkout or the documented legacy
// string array are accepted. Never forward arbitrary JSON/private properties.
export function readOrderOptions(snapshot: Prisma.JsonValue): string[] {
  if (!Array.isArray(snapshot))
    throw new Error('Invalid order option snapshot');
  return snapshot.map((value) => {
    if (typeof value === 'string') return value;
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.groupId === 'number' &&
      Number.isInteger(value.groupId) &&
      value.groupId > 0 &&
      value.groupId <= 2147483647 &&
      typeof value.valueId === 'number' &&
      Number.isInteger(value.valueId) &&
      value.valueId > 0 &&
      value.valueId <= 2147483647 &&
      typeof value.groupName === 'string' &&
      typeof value.value === 'string'
    )
      return value.value;
    throw new Error('Invalid order option snapshot');
  });
}

@Injectable()
export class OrderDetailService {
  constructor(private readonly prisma: PrismaService) {}

  detail(
    actorId: number,
    role: 'USER' | 'SELLER',
    input: unknown,
    query: unknown,
  ): Promise<OrderDetailResponseDto> {
    const id = parseOrderDetailInput(input, query);
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
        const row = await tx.order.findFirst({
          where: {
            id,
            ...(role === Role.USER
              ? { buyerId: actorId }
              : { store: { sellerId: actorId } }),
          },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            buyerId: true,
            store: { select: { id: true, name: true } },
            recipientNameSnapshot: true,
            phoneSnapshot: true,
            provinceSnapshot: true,
            districtSnapshot: true,
            wardSnapshot: true,
            addressLineSnapshot: true,
            postalCodeSnapshot: true,
            deliveryNoteSnapshot: true,
            subtotal: true,
            shippingFee: true,
            discountTotal: true,
            total: true,
            cancelledByType: true,
            cancelledById: true,
            cancellationReasonCode: true,
            cancellationReasonText: true,
            cancelledAt: true,
            createdAt: true,
            updatedAt: true,
            items: {
              orderBy: { id: 'asc' },
              select: {
                id: true,
                productId: true,
                variantId: true,
                productNameSnapshot: true,
                skuSnapshot: true,
                optionSnapshot: true,
                unitPrice: true,
                quantity: true,
                lineTotal: true,
              },
            },
            payment: {
              select: {
                provider: true,
                status: true,
                amount: true,
                currency: true,
                paidAt: true,
              },
            },
            statusHistory: {
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: {
                fromStatus: true,
                toStatus: true,
                actorType: true,
                actorId: true,
                reason: true,
                reasonCode: true,
                reasonText: true,
                restockable: true,
                receiptReference: true,
                trackingReference: true,
                deliveryAttempt: true,
                createdAt: true,
              },
            },
          },
        });
        if (!row)
          throw orderError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.');
        // Unknown legacy actor types remain unknown. Never derive a historical
        // role from today's User profile. Buyer only sees their own known ID.
        const visibleActorId = (
          type: OrderActorType | null,
          value: number | null,
        ) => {
          if (type === OrderActorType.BUYER && value === row.buyerId)
            return value;
          if (
            role === Role.SELLER &&
            (type === OrderActorType.ADMIN ||
              (type === OrderActorType.SELLER && value === actorId))
          )
            return value;
          return null;
        };
        const hasCancellation =
          row.status === 'CANCELLED' ||
          [
            row.cancelledByType,
            row.cancelledById,
            row.cancellationReasonCode,
            row.cancellationReasonText,
            row.cancelledAt,
          ].some((value) => value !== null);
        return {
          id: row.id,
          orderNumber: row.orderNumber,
          status: row.status,
          store: row.store,
          shippingAddress: {
            recipientName: row.recipientNameSnapshot,
            phone: row.phoneSnapshot,
            province: row.provinceSnapshot,
            district: row.districtSnapshot,
            ward: row.wardSnapshot,
            addressLine: row.addressLineSnapshot,
            postalCode: row.postalCodeSnapshot,
            deliveryNote: row.deliveryNoteSnapshot,
          },
          items: row.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            variantId: item.variantId,
            productName: item.productNameSnapshot,
            sku: item.skuSnapshot,
            options: readOrderOptions(item.optionSnapshot),
            unitPrice: item.unitPrice.toFixed(2),
            quantity: item.quantity,
            lineTotal: item.lineTotal.toFixed(2),
          })),
          subtotal: row.subtotal.toFixed(2),
          shippingFee: row.shippingFee.toFixed(2),
          discountTotal: row.discountTotal.toFixed(2),
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
          cancellation: hasCancellation
            ? {
                cancelledBy: {
                  type: row.cancelledByType,
                  id: visibleActorId(row.cancelledByType, row.cancelledById),
                },
                reasonCode: row.cancellationReasonCode,
                reasonText: row.cancellationReasonText,
                cancelledAt: row.cancelledAt?.toISOString() ?? null,
              }
            : null,
          timeline: row.statusHistory.map((entry) => ({
            fromStatus: entry.fromStatus,
            toStatus: entry.toStatus,
            actorType: entry.actorType,
            actorId: visibleActorId(entry.actorType, entry.actorId),
            reason: entry.reason,
            reasonCode: entry.reasonCode,
            reasonText: entry.reasonText,
            restockable: entry.restockable,
            receiptReference: entry.receiptReference,
            trackingReference: entry.trackingReference,
            deliveryAttempt: entry.deliveryAttempt,
            createdAt: entry.createdAt.toISOString(),
          })),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
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
