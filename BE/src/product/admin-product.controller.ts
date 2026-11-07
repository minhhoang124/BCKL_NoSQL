import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import {
  ProductDecisionDto,
  ProductPageDto,
  ProductVersionDto,
} from './dto/product-lifecycle.dto.js';
import { ProductLifecycleService } from './product-lifecycle.service.js';
import { ProductIdPipe } from './product-id.pipe.js';

@ApiTags('admin-products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/products')
export class AdminProductController {
  constructor(private readonly products: ProductLifecycleService) {}

  @Get('review-queue')
  queue(@Query() query: ProductPageDto) {
    return this.products.reviewQueue(query);
  }

  @Get(':productId')
  detail(@Param('productId', ProductIdPipe) id: number) {
    return this.products.reviewDetail(id);
  }

  @Post(':productId/approve')
  @HttpCode(200)
  approve(
    @Param('productId', ProductIdPipe) id: number,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ProductVersionDto,
  ) {
    return this.products.moderate(id, actor.userId, dto.version, 'APPROVED');
  }

  @Post(':productId/reject')
  @HttpCode(200)
  reject(
    @Param('productId', ProductIdPipe) id: number,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ProductDecisionDto,
  ) {
    return this.products.moderate(
      id,
      actor.userId,
      dto.version,
      'REJECTED',
      dto.reason,
    );
  }

  @Post(':productId/freeze')
  @HttpCode(200)
  freeze(
    @Param('productId', ProductIdPipe) id: number,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ProductDecisionDto,
  ) {
    return this.products.moderate(
      id,
      actor.userId,
      dto.version,
      'FROZEN',
      dto.reason,
    );
  }
}
