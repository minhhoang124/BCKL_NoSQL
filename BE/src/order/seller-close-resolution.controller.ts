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
import { SellerOrderCommandRateGuard } from './seller-order-command-rate.guard.js';
import {
  assertSellerCommandQuery,
  sellerOrderId,
  SellerOrderCommandExceptionFilter,
} from './seller-order-command.http.js';
import { SellerCloseResolutionService } from './seller-close-resolution.service.js';

@ApiTags('seller-close-resolution')
@ApiBearerAuth()
@Roles(Role.SELLER)
@UseGuards(JwtAuthGuard, RolesGuard, SellerOrderCommandRateGuard)
@UseFilters(SellerOrderCommandExceptionFilter)
@Controller('seller/orders')
export class SellerCloseResolutionController {
  constructor(private readonly resolutions: SellerCloseResolutionService) {}
  @Post(':orderId/resolve-close-command')
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
        command: { type: 'string', enum: ['cancel', 'confirm-returned'] },
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
      'Original immutable COMMITTED receipt or durable CLOSED_WITHOUT_EXECUTION; never executes cancel or returned',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid JSON, query, metadata or original key',
  })
  @ApiResponse({ status: 401, description: 'Inactive or invalid session' })
  @ApiResponse({ status: 403, description: 'Seller role required' })
  @ApiResponse({ status: 404, description: 'Absent or foreign Store order' })
  @ApiResponse({
    status: 409,
    description: 'Identity conflict or bounded in-progress; Retry-After',
  })
  @ApiResponse({
    status: 413,
    description: 'Body exceeds 8 KiB after inflation',
  })
  @ApiResponse({
    status: 429,
    description: 'Existing Seller ingress quota; Retry-After',
  })
  @ApiResponse({ status: 500, description: 'Safe internal error' })
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
}
