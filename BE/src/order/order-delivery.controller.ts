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
import { OrderDeliveryService } from './order-delivery.service.js';
import { OrderDeliveryRateGuard } from './order-delivery-rate.guard.js';
import {
  assertDeliveryQuery,
  deliveryOrderId,
  OrderDeliveryExceptionFilter,
} from './order-delivery.http.js';
import type { DeliveryCommand } from './order-delivery-request.js';

const tracking = { type: 'string', minLength: 1, maxLength: 100 } as const;
const attempt = { type: 'integer', minimum: 1, maximum: 4 } as const;
const trackingBody = {
  type: 'object',
  additionalProperties: false,
  required: ['trackingReference'],
  properties: { trackingReference: tracking },
} as const;

@ApiTags('admin-order-delivery-simulation')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard, OrderDeliveryRateGuard)
@UseFilters(OrderDeliveryExceptionFilter)
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
  description: 'Invalid JSON, fields, ID, query or key',
})
@ApiResponse({ status: 401, description: 'Invalid/inactive session' })
@ApiResponse({ status: 403, description: 'Admin required' })
@ApiResponse({ status: 404, description: 'Order not found' })
@ApiResponse({
  status: 409,
  description:
    'Stale attempt, state/payment/key conflict, retry limit or bounded wait',
})
@ApiResponse({ status: 413, description: 'JSON body exceeds 8 KiB' })
@ApiResponse({
  status: 429,
  description: 'Per-admin per-instance ingress quota (Retry-After)',
})
@ApiOkResponse({
  description: 'Immutable command receipt; not real carrier/payment settlement',
})
@Controller('admin/orders')
export class OrderDeliveryController {
  constructor(private readonly commands: OrderDeliveryService) {}
  private run(
    user: AuthenticatedUser,
    id: string,
    command: DeliveryCommand,
    body: unknown,
    req: Request,
  ) {
    assertDeliveryQuery(req.query);
    return this.commands.execute(
      user.userId,
      deliveryOrderId(id),
      command,
      req.headers['idempotency-key'],
      body,
      user.credentialVersion ?? 0,
    );
  }
  @Post(':orderId/ship')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    required: true,
    schema: { ...trackingBody, required: [...trackingBody.required] },
  })
  ship(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.run(user, id, 'ship', body, req);
  }
  @Post(':orderId/retry-delivery')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    required: true,
    schema: { ...trackingBody, required: [...trackingBody.required] },
  })
  retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.run(user, id, 'retry-delivery', body, req);
  }
  @Post(':orderId/mark-delivered')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['trackingReference', 'deliveryAttempt'],
      properties: { trackingReference: tracking, deliveryAttempt: attempt },
    },
  })
  delivered(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.run(user, id, 'mark-delivered', body, req);
  }
  @Post(':orderId/delivery-failed')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'trackingReference',
        'deliveryAttempt',
        'reasonCode',
        'reasonText',
      ],
      properties: {
        trackingReference: tracking,
        deliveryAttempt: attempt,
        reasonCode: {
          type: 'string',
          enum: [
            'CUSTOMER_UNREACHABLE',
            'ADDRESS_ISSUE',
            'CUSTOMER_REFUSED',
            'OTHER',
          ],
        },
        reasonText: { type: 'string', minLength: 1, maxLength: 500 },
      },
    },
  })
  failed(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.run(user, id, 'delivery-failed', body, req);
  }
}
