import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Patch,
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
import { UpdateProductVariantDto } from './dto/update-product-variant.dto.js';
import { ProductIdPipe } from './product-id.pipe.js';
import { SellerVariantInventoryService } from './seller-variant-inventory.service.js';

@ApiTags('seller-products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SELLER)
@Controller('seller/products')
export class SellerVariantInventoryController {
  constructor(private readonly inventory: SellerVariantInventoryService) {}

  @Patch(':productId/variants/:variantId')
  edit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('productId', ProductIdPipe) productId: number,
    @Param('variantId', ProductIdPipe) variantId: number,
    @Body() body: UpdateProductVariantDto,
    @Query() query: Record<string, unknown>,
  ) {
    if (Object.keys(query).length)
      throw new BadRequestException('Không hỗ trợ query khi cập nhật SKU');
    return this.inventory.edit(actor, productId, variantId, body);
  }
}
