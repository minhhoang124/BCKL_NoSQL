import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { AdminSystemHealthService } from './admin-system-health.service.js';

@ApiTags('admin-system-health')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/system-health')
export class AdminSystemHealthController {
  constructor(private readonly health: AdminSystemHealthService) {}
  @Get()
  read(@Req() request: { user: AuthenticatedUser }) {
    return this.health.read(request.user.userId);
  }
}
