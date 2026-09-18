import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ReviewStoreDto } from './dto/review-store.dto.js';
import { StoreService } from './store.service.js';

@ApiTags('admin-stores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/stores')
export class AdminStoreController {
  constructor(private readonly stores: StoreService) {}

  @ApiOkResponse({ description: 'Danh sách Store kèm lịch sử trạng thái' })
  @Get()
  getAll() {
    return this.stores.getAllForAdmin();
  }

  @ApiOkResponse({ description: 'Trạng thái Store đã được cập nhật' })
  @Patch(':storeId/status')
  review(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('storeId', ParseIntPipe) storeId: number,
    @Body() dto: ReviewStoreDto,
  ) {
    return this.stores.reviewByAdmin(storeId, admin.userId, dto);
  }
}
