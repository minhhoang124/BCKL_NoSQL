import {
  Controller,
  Get,
  Header,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { OrderStatus, Role } from '@prisma/client';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import {
  OrderListErrorDto,
  OrderListQueryDto,
  OrderListResponseDto,
} from './order-list.dto.js';
import {
  assertOrderListHasNoBody,
  OrderListExceptionFilter,
} from './order-list.http.js';
import { OrderListService } from './order-list.service.js';
import { OrderListRateGuard } from './order-list-rate.guard.js';

@ApiTags('order-list')
@ApiBearerAuth()
@ApiExtraModels(OrderListQueryDto)
@UseGuards(JwtAuthGuard, RolesGuard, OrderListRateGuard)
@UseFilters(OrderListExceptionFilter)
@Controller()
export class OrderListController {
  constructor(private readonly orders: OrderListService) {}

  @Get('orders')
  @Roles(Role.USER)
  @Header('Cache-Control', 'no-store')
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 50,
  })
  @ApiQuery({
    name: 'afterId',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 2147483647,
  })
  @ApiQuery({ name: 'status', required: false, enum: OrderStatus })
  @ApiOkResponse({ type: OrderListResponseDto })
  @ApiResponse({ status: 400, type: OrderListErrorDto })
  @ApiResponse({ status: 401, type: OrderListErrorDto })
  @ApiResponse({ status: 403, type: OrderListErrorDto })
  @ApiResponse({ status: 429, type: OrderListErrorDto })
  @ApiResponse({ status: 500, type: OrderListErrorDto })
  buyer(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
    @Req() request: Request,
  ) {
    assertOrderListHasNoBody(request);
    return this.orders.list(user.userId, 'USER', query);
  }

  @Get('seller/orders')
  @Roles(Role.SELLER)
  @Header('Cache-Control', 'no-store')
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 50,
  })
  @ApiQuery({
    name: 'afterId',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 2147483647,
  })
  @ApiQuery({ name: 'status', required: false, enum: OrderStatus })
  @ApiOkResponse({ type: OrderListResponseDto })
  @ApiResponse({ status: 400, type: OrderListErrorDto })
  @ApiResponse({ status: 401, type: OrderListErrorDto })
  @ApiResponse({ status: 403, type: OrderListErrorDto })
  @ApiResponse({ status: 429, type: OrderListErrorDto })
  @ApiResponse({ status: 500, type: OrderListErrorDto })
  seller(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
    @Req() request: Request,
  ) {
    assertOrderListHasNoBody(request);
    return this.orders.list(user.userId, 'SELLER', query);
  }
}
