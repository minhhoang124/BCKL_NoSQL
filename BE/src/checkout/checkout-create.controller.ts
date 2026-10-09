import {
  Body,
  Controller,
  Header,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CheckoutCreateIngressGuard } from './checkout-create-rate.js';
import { CheckoutCreateService } from './checkout-create.service.js';
import {
  CheckoutExceptionFilter,
  checkoutHeaderKey,
  emptyCheckoutFields,
} from './checkout-http.js';
import {
  CheckoutCreateResponseDto,
  CheckoutErrorDto,
  CheckoutPreviewRequestDto,
} from './checkout-read.dto.js';

@ApiTags('buyer-checkout')
@ApiBearerAuth()
@Roles(Role.USER)
@UseGuards(JwtAuthGuard, RolesGuard, CheckoutCreateIngressGuard)
@UseFilters(CheckoutExceptionFilter)
@Controller('checkouts')
export class CheckoutCreateController {
  constructor(private readonly checkout: CheckoutCreateService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,128}$' },
  })
  @ApiBody({ type: CheckoutPreviewRequestDto })
  @ApiCreatedResponse({
    type: CheckoutCreateResponseDto,
    description:
      'COD mới: một Order mỗi Store; toàn bộ giao dịch nguyên tử, phí demo 0đ.',
  })
  @ApiOkResponse({
    type: CheckoutCreateResponseDto,
    description:
      'Replay: trả biên nhận gốc; không trừ kho/xóa giỏ/ghi outbox thêm.',
  })
  @ApiResponse({ status: 400, type: CheckoutErrorDto })
  @ApiResponse({ status: 401, type: CheckoutErrorDto })
  @ApiResponse({ status: 403, type: CheckoutErrorDto })
  @ApiResponse({ status: 404, type: CheckoutErrorDto })
  @ApiResponse({
    status: 409,
    type: CheckoutErrorDto,
    description:
      'Giá/kho/giỏ thay đổi, key conflict/legacy hoặc cạnh tranh; CHECKOUT_IN_PROGRESS có Retry-After.',
  })
  @ApiResponse({ status: 413, type: CheckoutErrorDto })
  @ApiResponse({
    status: 429,
    type: CheckoutErrorDto,
    description:
      '60 ingress, 5 intent mới/phút/User, per-instance; Retry-After.',
  })
  @ApiResponse({ status: 500, type: CheckoutErrorDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Body() input: unknown,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    emptyCheckoutFields(query);
    const result = await this.checkout.create(
      user.userId,
      checkoutHeaderKey(request),
      input,
    );
    response.status(result.replayed ? 200 : 201);
    return result;
  }
}
