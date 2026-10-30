import { BuyerAccess } from '../auth/buyer-access.js';
import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { OrderCancellationService } from './order-cancellation.service.js';
import { OrderCancellationRateGuard } from './order-cancellation-rate.guard.js';
import {
  assertCancellationQuery,
  cancellationOrderId,
  OrderCancellationExceptionFilter,
} from './order-cancellation.http.js';

@ApiTags('order-cancellation')
@ApiBearerAuth()
@ApiParam({
  name: 'orderId',
  schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
})
@ApiHeader({
  name: 'Idempotency-Key',
  required: true,
  schema: {
    type: 'string',
    minLength: 16,
    maxLength: 128,
    pattern: '^[A-Za-z0-9_-]+$',
  },
})
@ApiResponse({
  status: 400,
  description: 'Invalid JSON, key, ID, reason or query',
})
@ApiResponse({ status: 401, description: 'Invalid/inactive session' })
@ApiResponse({ status: 403, description: 'Wrong actor role' })
@ApiResponse({ status: 404, description: 'Order absent or not owned' })
@ApiResponse({
  status: 409,
  description: 'State/payment/inventory/key conflict or bounded wait',
})
@ApiResponse({ status: 413, description: 'Body exceeds 8 KiB' })
@ApiResponse({ status: 429, description: 'Ingress quota exceeded' })
@UseGuards(JwtAuthGuard, RolesGuard, OrderCancellationRateGuard)
@UseFilters(OrderCancellationExceptionFilter)
@Controller()
export class OrderCancellationController {
  constructor(private readonly orders: OrderCancellationService) {}
  private run(
    user: AuthenticatedUser,
    id: string,
    type: 'BUYER' | 'SELLER',
    body: unknown,
    req: Request,
  ) {
    assertCancellationQuery(req.query);
    return this.orders.cancel(
      user.userId,
      type,
      cancellationOrderId(id),
      req.headers['idempotency-key'],
      body,
      user.credentialVersion ?? 0,
    );
  }
  @Post('orders/:orderId/cancel')
  @BuyerAccess()
  @Roles(Role.USER)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['reasonCode', 'reasonText'],
      properties: {
        reasonCode: { type: 'string', enum: ['CHANGED_MIND', 'OTHER'] },
        reasonText: { type: 'string', minLength: 1, maxLength: 500 },
      },
    },
  })
  @ApiOkResponse({
    description: 'Atomic cancellation receipt, original result on replay',
  })
  buyer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.run(user, id, 'BUYER', body, req);
  }
  @Post('seller/orders/:orderId/cancel')
  @Roles(Role.SELLER)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['reasonCode', 'reasonText'],
      properties: {
        reasonCode: {
          type: 'string',
          enum: ['OUT_OF_STOCK', 'CANNOT_FULFIL', 'OTHER'],
        },
        reasonText: { type: 'string', minLength: 1, maxLength: 500 },
      },
    },
  })
  @ApiOkResponse({
    description: 'Atomic cancellation receipt, original result on replay',
  })
  seller(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.run(user, id, 'SELLER', body, req);
  }
}
