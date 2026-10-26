import { Controller, Get, Module, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PassportModule } from '@nestjs/passport';
import type { Request } from 'express';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DashboardService } from './dashboard.service.js';
type ActorRequest = Request & { user: AuthenticatedUser };
@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get('admin/dashboard')
  @ApiQuery({ name: 'from', example: '2026-10-01' })
  @ApiQuery({ name: 'to', example: '2026-11-01' })
  @ApiQuery({
    name: 'bucket',
    required: false,
    enum: ['day', 'month', 'quarter'],
  })
  admin(@Req() req: ActorRequest) {
    return this.dashboard.summary(req.user, 'ADMIN', req.originalUrl);
  }
  @Get('seller/dashboard')
  seller(@Req() req: ActorRequest) {
    return this.dashboard.summary(req.user, 'SELLER', req.originalUrl);
  }
  @Get('admin/dashboard/data-quality')
  adminQuality(@Req() req: ActorRequest) {
    return this.dashboard.quality(req.user, 'ADMIN', req.originalUrl);
  }
  @Get('seller/dashboard/data-quality')
  sellerQuality(@Req() req: ActorRequest) {
    return this.dashboard.quality(req.user, 'SELLER', req.originalUrl);
  }
}
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
