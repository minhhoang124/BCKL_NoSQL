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
import { BuyerCommandResolutionService } from './buyer-command-resolution.service.js';
import { BuyerCommandResolutionRateGuard } from './buyer-command-resolution-rate.guard.js';
import {
  completionOrderId,
  assertCompletionQuery,
  OrderCompletionExceptionFilter,
} from './order-completion.http.js';

@ApiTags('buyer-command-resolution')
@ApiBearerAuth()
@BuyerAccess()
@Roles(Role.USER)
@UseGuards(JwtAuthGuard, RolesGuard, BuyerCommandResolutionRateGuard)
@UseFilters(OrderCompletionExceptionFilter)
@Controller('orders')
export class BuyerCommandResolutionController {
  constructor(private readonly resolutions: BuyerCommandResolutionService) {}
  @Post(':orderId/resolve-command')
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
      required: ['command', 'hashVersion', 'requestHash'],
      properties: {
        command: { type: 'string', enum: ['cancel', 'complete'] },
        hashVersion: { type: 'integer', enum: [1] },
        requestHash: {
          type: 'string',
          minLength: 64,
          maxLength: 64,
          pattern: '^[0-9a-f]{64}$',
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Original Buyer COMMITTED receipt or durable CLOSED_WITHOUT_EXECUTION; never executes an Order command',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid fields, hash, query or original key',
  })
  @ApiResponse({ status: 401, description: 'Invalid/inactive session' })
  @ApiResponse({ status: 403, description: 'Buyer role required' })
  @ApiResponse({ status: 404, description: 'Absent or not owned Order' })
  @ApiResponse({
    status: 409,
    description:
      'Identity conflict or bounded wait; Retry-After on in-progress',
  })
  @ApiResponse({
    status: 413,
    description: 'Body exceeds 8 KiB after decompression',
  })
  @ApiResponse({
    status: 429,
    description: 'Independent ingress quota; Retry-After',
  })
  @ApiResponse({ status: 500, description: 'Safe internal error' })
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertCompletionQuery(req.query);
    return this.resolutions.resolve(
      user.userId,
      completionOrderId(id),
      req.headers['idempotency-key'],
      body,
    );
  }
}
