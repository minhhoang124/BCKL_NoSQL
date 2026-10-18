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
import { SellerOrderCommandService } from './seller-order-command.service.js';
import { OrderCommandResolutionService } from './order-command-resolution.service.js';
import { SellerOrderCommandRateGuard } from './seller-order-command-rate.guard.js';
import {
  assertSellerCommandQuery,
  sellerOrderId,
  SellerOrderCommandExceptionFilter,
} from './seller-order-command.http.js';

@ApiTags('seller-order-commands')
@ApiBearerAuth()
@Roles(Role.SELLER)
@UseGuards(JwtAuthGuard, RolesGuard, SellerOrderCommandRateGuard)
@UseFilters(SellerOrderCommandExceptionFilter)
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
@ApiResponse({ status: 400, description: 'JSON, ID, query or key invalid' })
@ApiResponse({ status: 401, description: 'Inactive or invalid session' })
@ApiResponse({ status: 403, description: 'Seller role required' })
@ApiResponse({ status: 404, description: 'Order not found in own Store' })
@ApiResponse({
  status: 409,
  description:
    'Transition, payment, key conflict or bounded wait (Retry-After)',
})
@ApiResponse({ status: 413, description: 'Body exceeds 8 KiB after inflation' })
@ApiResponse({
  status: 429,
  description: 'Ingress quota exceeded (Retry-After)',
})
@ApiResponse({ status: 500, description: 'Safe internal error' })
@Controller('seller/orders')
export class SellerOrderCommandController {
  constructor(
    private readonly commands: SellerOrderCommandService,
    private readonly resolutions: OrderCommandResolutionService,
  ) {}

  @Post(':orderId/resolve-command')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['command'],
      properties: {
        command: {
          type: 'string',
          enum: ['confirm', 'start-packing', 'ready-to-ship'],
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Original COMMITTED receipt or durable CLOSED_WITHOUT_EXECUTION; never executes a command',
  })
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertSellerCommandQuery(req.query);
    return this.resolutions.resolve(
      user.userId,
      sellerOrderId(id),
      req.headers['idempotency-key'],
      body,
    );
  }
  private run(
    user: AuthenticatedUser,
    id: string,
    command: 'confirm' | 'start-packing' | 'ready-to-ship',
    body: unknown,
    req: Request,
  ) {
    assertSellerCommandQuery(req.query);
    return this.commands.execute(
      user.userId,
      sellerOrderId(id),
      command,
      req.headers['idempotency-key'],
      body,
    );
  }
  @Post(':orderId/confirm')
  @ApiBody({
    required: true,
    schema: { type: 'object', additionalProperties: false, properties: {} },
  })
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    description:
      'Committed command receipt; replayed=true only for same key/hash',
  })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.run(user, id, 'confirm', body, req);
  }

  @Post(':orderId/start-packing')
  @ApiBody({
    required: true,
    schema: { type: 'object', additionalProperties: false, properties: {} },
  })
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'CONFIRMED -> PACKING with immutable receipt' })
  packing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.run(user, id, 'start-packing', body, req);
  }

  @Post(':orderId/ready-to-ship')
  @ApiBody({
    required: true,
    schema: { type: 'object', additionalProperties: false, properties: {} },
  })
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    description: 'PACKING -> READY_TO_SHIP; does not mark delivered',
  })
  ready(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.run(user, id, 'ready-to-ship', body, req);
  }
}
