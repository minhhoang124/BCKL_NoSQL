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
import { OrderCompletionService } from './order-completion.service.js';
import { OrderCompletionRateGuard } from './order-completion-rate.guard.js';
import {
  completionOrderId,
  assertCompletionQuery,
  OrderCompletionExceptionFilter,
} from './order-completion.http.js';
@ApiTags('buyer-order-completion')
@ApiBearerAuth()
@BuyerAccess()
@Roles(Role.USER)
@UseGuards(JwtAuthGuard, RolesGuard, OrderCompletionRateGuard)
@UseFilters(OrderCompletionExceptionFilter)
@Controller('orders')
export class OrderCompletionController {
  constructor(private readonly commands: OrderCompletionService) {}
  @Post(':orderId/complete')
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
    schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
  })
  @ApiOkResponse({
    description: 'Immutable completion receipt, DELIVERED + PAID only',
  })
  @ApiResponse({ status: 400, description: 'Invalid JSON/fields/key/query' })
  @ApiResponse({ status: 401, description: 'Invalid/inactive session' })
  @ApiResponse({ status: 403, description: 'Buyer required' })
  @ApiResponse({ status: 404, description: 'Absent or not owned Order' })
  @ApiResponse({
    status: 409,
    description: 'State/payment/key conflict or bounded wait',
  })
  @ApiResponse({ status: 413, description: 'Body > 8 KiB' })
  @ApiResponse({ status: 429, description: 'Ingress limit, Retry-After' })
  run(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertCompletionQuery(req.query);
    return this.commands.completeBuyer(
      user.userId,
      completionOrderId(id),
      req.headers['idempotency-key'],
      body,
      user.credentialVersion ?? 0,
    );
  }
}
