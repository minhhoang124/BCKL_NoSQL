import {
  Controller,
  HttpException,
  Get,
  Header,
  Param,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Prisma, Role } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { credentialMatches } from '../auth/credential-version.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma.service.js';
import { OrderListRateGuard } from './order-list-rate.guard.js';
import {
  assertOrderListHasNoBody,
  orderError,
  OrderListExceptionFilter,
} from './order-list.http.js';
import {
  ADMIN_ORDER_LOOKUP_LIMIT,
  parseAdminOrderLookupQuery,
} from './admin-order-lookup.js';

// Minimal operational projection: no buyer, address, phone, reason or command keys.
const select = {
  id: true,
  orderNumber: true,
  status: true,
  total: true,
  currentDeliveryAttempt: true,
  retryCount: true,
  currentAttempt: { select: { trackingReference: true } },
  payment: {
    select: { provider: true, status: true, amount: true, currency: true },
  },
} satisfies Prisma.OrderSelect;

function project(row: Prisma.OrderGetPayload<{ select: typeof select }>) {
  return {
    ...row,
    total: row.total.toFixed(2),
    payment: row.payment
      ? { ...row.payment, amount: row.payment.amount.toFixed(2) }
      : null,
  };
}

@ApiTags('admin-order-delivery-simulation')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard, OrderListRateGuard)
@UseFilters(OrderListExceptionFilter)
@Controller('admin/fulfilment/orders')
export class AdminFulfilmentController {
  constructor(private readonly db: PrismaService) {}

  private async read(
    actor: AuthenticatedUser,
    id?: number,
    orderNumber?: string,
  ) {
    return this.db
      .$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
          await tx.$executeRaw`SET LOCAL statement_timeout='2s'`;
          await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.userId} FOR SHARE`;
          const current = await tx.user.findUnique({
            where: { id: actor.userId },
            select: { isActive: true, role: true, credentialVersion: true },
          });
          if (
            !current?.isActive ||
            !credentialMatches(
              actor.credentialVersion,
              current.credentialVersion,
            )
          )
            throw orderError(401, 'UNAUTHORIZED', 'Vui lòng đăng nhập lại.');
          if (current.role !== 'ADMIN')
            throw orderError(403, 'FORBIDDEN', 'Cần quyền Admin.');
          if (id !== undefined) {
            const order = await tx.order.findUnique({ where: { id }, select });
            if (!order)
              throw orderError(
                404,
                'ORDER_NOT_FOUND',
                'Không tìm thấy đơn hàng.',
              );
            return project(order);
          }
          if (orderNumber !== undefined)
            // Displayed-code lookup across every status, same minimal projection.
            return {
              items: (
                await tx.order.findMany({
                  where: { orderNumber: { startsWith: orderNumber } },
                  select,
                  orderBy: { id: 'desc' },
                  take: ADMIN_ORDER_LOOKUP_LIMIT,
                })
              ).map(project),
            };
          return {
            items: (
              await tx.order.findMany({
                where: {
                  status: {
                    in: ['READY_TO_SHIP', 'SHIPPING', 'DELIVERY_FAILED'],
                  },
                },
                select,
                orderBy: { id: 'desc' },
                take: 20,
              })
            ).map(project),
          };
        },
        { maxWait: 2000, timeout: 4000 },
      )
      .catch((error: unknown) => {
        if (error instanceof HttpException) throw error;
        throw orderError(
          503,
          'FULFILMENT_READ_UNAVAILABLE',
          'Chưa tải được dữ liệu giao hàng. Vui lòng thử lại.',
        );
      });
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiQuery({
    name: 'orderNumber',
    required: false,
    description:
      'Displayed code ORD-<uuid> or a prefix with at least 8 hex characters; searches every status, max 20. Omit for the delivery queue.',
  })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    assertOrderListHasNoBody(req);
    return this.read(actor, undefined, parseAdminOrderLookupQuery(query));
  }

  @Get(':orderId')
  @Header('Cache-Control', 'no-store')
  detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId') raw: string,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    assertOrderListHasNoBody(req);
    if (
      !/^[1-9]\d{0,9}$/.test(raw) ||
      Number(raw) > 2147483647 ||
      !query ||
      Object.keys(query as object).length
    )
      throw orderError(400, 'VALIDATION_ERROR', 'Mã đơn hàng không hợp lệ.');
    return this.read(actor, Number(raw));
  }
}
