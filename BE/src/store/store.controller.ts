import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CreateStoreDto } from './dto/create-store.dto.js';
import { UpdateStoreDto } from './dto/update-store.dto.js';
import { StoreService } from './store.service.js';

@ApiTags('seller-store')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SELLER)
@Controller('seller/store')
export class StoreController {
  constructor(private readonly stores: StoreService) {}

  @ApiCreatedResponse({ description: 'Cửa hàng của Seller đã được tạo' })
  @ApiConflictResponse({ description: 'Seller đã có cửa hàng' })
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStoreDto) {
    return this.stores.createForSeller(user.userId, dto);
  }

  @ApiOkResponse({ description: 'Cửa hàng thuộc Seller hiện tại' })
  @ApiNotFoundResponse({ description: 'Seller chưa có cửa hàng' })
  @Get()
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.stores.getForSeller(user.userId);
  }

  @ApiOkResponse({ description: 'Cửa hàng đã được cập nhật' })
  @ApiNotFoundResponse({ description: 'Seller chưa có cửa hàng' })
  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateStoreDto) {
    return this.stores.updateForSeller(user.userId, dto, user);
  }

  @ApiOkResponse({ description: 'Store bị từ chối đã được nộp lại để duyệt' })
  @HttpCode(200)
  @Post('resubmit')
  resubmit(@CurrentUser() user: AuthenticatedUser) {
    return this.stores.resubmit(user.userId);
  }
}
