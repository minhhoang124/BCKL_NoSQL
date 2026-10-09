import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import {
  CheckoutExceptionFilter,
  checkoutHeaderKey,
  emptyCheckoutFields,
} from './checkout-http.js';
import { CheckoutReadRateGuard } from './checkout-read-rate.guard.js';
import { CheckoutReadService } from './checkout-read.service.js';
import {
  CheckoutErrorDto,
  CheckoutLookupResponseDto,
  CheckoutPreviewRequestDto,
  CheckoutPreviewResponseDto,
} from './checkout-read.dto.js';

@ApiTags('buyer-checkout')
@ApiBearerAuth()
@ApiBadRequestResponse({ type: CheckoutErrorDto })
@ApiUnauthorizedResponse({ type: CheckoutErrorDto })
@ApiForbiddenResponse({ type: CheckoutErrorDto })
@ApiNotFoundResponse({ type: CheckoutErrorDto })
@ApiConflictResponse({ type: CheckoutErrorDto })
@ApiResponse({
  status: 429,
  type: CheckoutErrorDto,
  description:
    'RATE_LIMITED; Retry-After giây. Bucket preview/lookup riêng theo User, per-instance.',
})
@UseGuards(JwtAuthGuard, RolesGuard, CheckoutReadRateGuard)
@Roles(Role.USER)
@UseFilters(CheckoutExceptionFilter)
@Controller()
export class CheckoutReadController {
  constructor(private readonly checkout: CheckoutReadService) {}

  @Post('checkout/preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBody({ type: CheckoutPreviewRequestDto })
  @ApiOkResponse({
    type: CheckoutPreviewResponseDto,
    description:
      'Chỉ xem trước, không giữ kho/tạo đơn; totals=null khi có lỗi dòng.',
  })
  @ApiResponse({
    status: 413,
    type: CheckoutErrorDto,
    description: 'REQUEST_TOO_LARGE — 64 KiB sau giải nén',
  })
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
    @Query() query: unknown,
  ) {
    emptyCheckoutFields(query);
    return this.checkout.preview(user.userId, input);
  }

  @Get('checkouts/by-key')
  @Header('Cache-Control', 'no-store')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,128}$' },
  })
  @ApiOkResponse({
    type: CheckoutLookupResponseDto,
    description:
      'Biên nhận gốc, không phải trạng thái Order hiện hành; 404 không chứng minh request cũ chưa commit.',
  })
  lookup(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    emptyCheckoutFields(query);
    emptyCheckoutFields(body);
    return this.checkout.lookup(user.userId, checkoutHeaderKey(request));
  }
}
