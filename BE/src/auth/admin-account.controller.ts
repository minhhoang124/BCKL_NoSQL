import {
  Body,
  Get,
  Req,
  Controller,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service.js';
import { Roles } from './decorators/roles.decorator.js';
import { accountStatusInput } from './account-status.input.js';
import { UpdateAccountStatusDto } from './dto/update-account-status.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import type { Request } from 'express';
import type { AuthenticatedUser } from './auth.types.js';
import { AdminAccountListService } from './admin-account-list.service.js';
import { parseAccountListQuery } from './admin-account-list.js';
import { ApiQuery } from '@nestjs/swagger';
import { AccountStatusRecoveryService } from './account-status-recovery.service.js';

@ApiTags('admin-accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/accounts')
export class AdminAccountController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AdminAccountListService,
    private readonly recovery: AccountStatusRecoveryService,
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
  @ApiBody({ type: UpdateAccountStatusDto })
  updateStatus(
    @Req() request: Request & { user: AuthenticatedUser },
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: unknown,
  ) {
    return this.auth.updateAccountStatus(
      request.user,
      userId,
      accountStatusInput(body),
    );
  }

  @Get(':userId/status')
  @ApiOkResponse({
    description:
      'Canonical status/revision for an explicit Admin command; no secret or audit reason.',
  })
  status(
    @Req() request: Request & { user: AuthenticatedUser },
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.auth.getAccountStatus(request.user, userId);
  }

  @Get(':userId/status/history')
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'beforeRevision', required: false, type: Number })
  history(
    @Req() request: Request & { user: AuthenticatedUser },
    @Param('userId', ParseIntPipe) id: number,
  ) {
    return this.recovery.history(request.user, id, request.originalUrl);
  }

  @Post(':userId/status/reconcile')
  @HttpCode(200)
  reconcile(
    @Req() request: Request & { user: AuthenticatedUser },
    @Param('userId', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.recovery.reconcile(request.user, id, body);
  }
}
