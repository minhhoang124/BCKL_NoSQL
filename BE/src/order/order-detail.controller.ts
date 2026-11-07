import { BuyerAccess } from '../auth/buyer-access.js';
import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { OrderDetailResponseDto } from './order-detail.dto.js';
import { OrderDetailService } from './order-detail.service.js';
import { OrderListErrorDto } from './order-list.dto.js';
import {
  assertOrderListHasNoBody,
  OrderListExceptionFilter,
} from './order-list.http.js';
import { OrderListRateGuard } from './order-list-rate.guard.js';

@ApiTags('order-detail')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrderListRateGuard)
@UseFilters(OrderListExceptionFilter)
@Controller()
export class OrderDetailController {
  constructor(private readonly orders: OrderDetailService) {}

  @Get('orders/:orderId')
  @BuyerAccess()
  @Roles(Role.USER)
  @Header('Cache-Control', 'no-store')
  @ApiParam({
    name: 'orderId',
    schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
  })
  @ApiOkResponse({ type: OrderDetailResponseDto })
  @ApiResponse({ status: 400, type: OrderListErrorDto })
  @ApiResponse({ status: 401, type: OrderListErrorDto })
  @ApiResponse({ status: 403, type: OrderListErrorDto })
  @ApiResponse({ status: 404, type: OrderListErrorDto })
  @ApiResponse({ status: 429, type: OrderListErrorDto })
  @ApiResponse({ status: 500, type: OrderListErrorDto })
  buyer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Query() query: unknown,
    @Req() request: Request,
  ) {
    assertOrderListHasNoBody(request);
    return this.orders.detail(user.userId, 'USER', id, query);
  }

  @Get('seller/orders/:orderId')
  @Roles(Role.SELLER)
  @Header('Cache-Control', 'no-store')
  @ApiParam({
    name: 'orderId',
    schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
  })
  @ApiOkResponse({ type: OrderDetailResponseDto })
  @ApiResponse({ status: 400, type: OrderListErrorDto })
  @ApiResponse({ status: 401, type: OrderListErrorDto })
  @ApiResponse({ status: 403, type: OrderListErrorDto })
  @ApiResponse({ status: 404, type: OrderListErrorDto })
  @ApiResponse({ status: 429, type: OrderListErrorDto })
  @ApiResponse({ status: 500, type: OrderListErrorDto })
  seller(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') id: string,
    @Query() query: unknown,
    @Req() request: Request,
  ) {
    assertOrderListHasNoBody(request);
    return this.orders.detail(user.userId, 'SELLER', id, query);
  }
}
