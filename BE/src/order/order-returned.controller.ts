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
import { OrderReturnedService } from './order-returned.service.js';
import { OrderReturnedRateGuard } from './order-returned-rate.guard.js';
import {
  returnedOrderId,
  assertReturnedQuery,
  OrderReturnedExceptionFilter,
} from './order-returned.http.js';
import type { ReturnedActor } from './order-returned-request.js';

@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrderReturnedRateGuard)
@UseFilters(OrderReturnedExceptionFilter)
class ReturnedController {
  constructor(
    protected readonly commands: OrderReturnedService,
    private readonly actorType: ReturnedActor,
  ) {}
  @Post(':orderId/confirm-returned')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
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
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['reasonCode', 'reasonText', 'restockable', 'receiptReference'],
      properties: {
        reasonCode: {
          type: 'string',
          enum: ['RETURN_RECEIVED', 'DAMAGED', 'LOST'],
        },
        reasonText: { type: 'string', minLength: 1, maxLength: 500 },
        restockable: { type: 'boolean' },
        receiptReference: {
          type: 'string',
          nullable: true,
          minLength: 1,
          maxLength: 100,
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Original immutable receipt; LOST is Admin-only, never restocks',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid fields/key/query; inconsistent reason/restock/receipt',
  })
  @ApiResponse({ status: 401, description: 'Inactive/invalid session' })
  @ApiResponse({ status: 403, description: 'Wrong role' })
  @ApiResponse({ status: 404, description: 'Absent or not owned Order' })
  @ApiResponse({
    status: 409,
    description: 'State/payment/inventory/key conflict or bounded wait',
  })
  @ApiResponse({ status: 413, description: 'Body > 8 KiB' })
  @ApiResponse({
    status: 429,
    description: 'Per-actor ingress limit, Retry-After',
  })
  run(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertReturnedQuery(req.query);
    return this.commands.execute(
      user.userId,
      this.actorType,
      returnedOrderId(id),
      req.headers['idempotency-key'],
      body,
      user.credentialVersion ?? 0,
    );
  }
}
@ApiTags('seller-order-returned')
@Roles(Role.SELLER)
@Controller('seller/orders')
export class SellerReturnedController extends ReturnedController {
  constructor(commands: OrderReturnedService) {
    super(commands, 'SELLER');
  }
}
@ApiTags('admin-order-returned')
@Roles(Role.ADMIN)
@Controller('admin/orders')
export class AdminReturnedController extends ReturnedController {
  constructor(commands: OrderReturnedService) {
    super(commands, 'ADMIN');
  }
}
