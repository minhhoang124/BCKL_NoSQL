import { BuyerAccess } from '../auth/buyer-access.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Put,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import {
  CartResponseDto,
  CartErrorDto,
  EmptyCartDto,
  PutCartItemDto,
} from './cart.dto.js';
import { CartExceptionFilter, CartVariantIdPipe } from './cart-http.js';
import { CartRateLimitGuard } from './cart-rate-limit.guard.js';
import { CartService } from './cart.service.js';

@ApiTags('buyer-cart')
@ApiBearerAuth()
@ApiBadRequestResponse({ type: CartErrorDto, description: 'VALIDATION_ERROR' })
@ApiUnauthorizedResponse({ type: CartErrorDto })
@ApiForbiddenResponse({ type: CartErrorDto })
@ApiResponse({
  status: 429,
  type: CartErrorDto,
  description: 'RATE_LIMITED, header Retry-After (seconds)',
})
@UseGuards(JwtAuthGuard, RolesGuard, CartRateLimitGuard)
@BuyerAccess()
@Roles(Role.USER)
@UseFilters(CartExceptionFilter)
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: CartResponseDto })
  list(@CurrentUser() user: AuthenticatedUser, @Query() _query: EmptyCartDto) {
    return this.cart.list(user.userId);
  }

  @Put('items/:variantId')
  @Header('Cache-Control', 'no-store')
  @ApiParam({
    name: 'variantId',
    schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiConflictResponse({
    type: CartErrorDto,
    description:
      'VARIANT_NOT_AVAILABLE, INSUFFICIENT_STOCK, SELF_PURCHASE_FORBIDDEN, CART_WRITE_CONFLICT',
  })
  put(
    @CurrentUser() user: AuthenticatedUser,
    @Param('variantId', CartVariantIdPipe) id: string,
    @Body() dto: PutCartItemDto,
    @Query() _query: EmptyCartDto,
  ) {
    // Keep string metadata so the global pipe cannot coerce e.g. "1e2" first.
    return this.cart.put(user.userId, Number(id), dto.quantity);
  }

  @Delete('items/:variantId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiParam({
    name: 'variantId',
    schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
  })
  @ApiNoContentResponse()
  @ApiConflictResponse({
    type: CartErrorDto,
    description: 'CART_WRITE_CONFLICT',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('variantId', CartVariantIdPipe) id: string,
    @Body() _body: EmptyCartDto,
    @Query() _query: EmptyCartDto,
  ) {
    return this.cart.remove(user.userId, Number(id));
  }
}
