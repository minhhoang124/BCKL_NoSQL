import {
  Body,
  Get,
  Req,
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
import type { Request } from 'express';
import type { AuthenticatedUser } from './auth.types.js';
import { AdminAccountListService } from './admin-account-list.service.js';
import { parseAccountListQuery } from './admin-account-list.js';
import { ApiQuery } from '@nestjs/swagger';

@ApiTags('admin-accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/accounts')
export class AdminAccountController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AdminAccountListService,
  ) {}

  @Get()
  @ApiOkResponse({
    description:
      'Read-only Accounts page; see docs/api/admin-accounts-list.md for the field allowlist and cursor contract.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'afterId', required: false, type: Number })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'role', required: false, enum: Role })
  @ApiQuery({ name: 'isActive', required: false, enum: ['true', 'false'] })
  list(@Req() request: Request & { user: AuthenticatedUser }) {
    return this.accounts.list(
      request.user.userId,
      parseAccountListQuery(request.originalUrl),
    );
  }

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
