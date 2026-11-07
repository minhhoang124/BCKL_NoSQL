import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { AuthModule } from '../auth/auth.module.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { SearchAnalyticsCoreModule } from './search-analytics.module.js';
import { SearchAnalyticsService } from './search-analytics.service.js';
type ActorRequest = Request & { user: AuthenticatedUser };
@Controller()
export class SearchAnalyticsController {
  constructor(private readonly analytics: SearchAnalyticsService) {}
  @Post('search/session')
  @HttpCode(200)
  prepare(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.analytics.prepare(req, res);
  }
  @Post('search/events')
  @HttpCode(200)
  event(@Body() body: unknown, @Req() req: Request) {
    return this.analytics.event(body, req);
  }
  @Get('seller/search-analytics')
  @UseGuards(JwtAuthGuard)
  seller(@Req() req: ActorRequest) {
    return this.analytics.summary(req.user, 'SELLER', req.originalUrl);
  }
  @Get('admin/search-analytics')
  @UseGuards(JwtAuthGuard)
  admin(@Req() req: ActorRequest) {
    return this.analytics.summary(req.user, 'ADMIN', req.originalUrl);
  }
}
@Module({
  imports: [
    AuthModule,
    SearchAnalyticsCoreModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [SearchAnalyticsController],
})
export class SearchAnalyticsModule {}
