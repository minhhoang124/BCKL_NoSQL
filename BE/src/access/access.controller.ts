import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';

@ApiTags('access')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AccessController {
  @Roles(Role.SELLER)
  @Get('seller/test')
  sellerTest() {
    return { message: 'Seller access granted' };
  }

  @Roles(Role.ADMIN)
  @Get('admin/test')
  adminTest() {
    return { message: 'Admin access granted' };
  }
}
