import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service.js';
import { Roles } from './decorators/roles.decorator.js';
import { UpdateAccountStatusDto } from './dto/update-account-status.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';

@ApiTags('admin-accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/accounts')
export class AdminAccountController {
  constructor(private readonly auth: AuthService) {}

  @ApiOkResponse({
    description: 'Account state and durable search reconciliation job',
  })
  @Patch(':userId/status')
  updateStatus(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateAccountStatusDto,
  ) {
    return this.auth.updateAccountStatus(userId, dto.isActive);
  }
}
