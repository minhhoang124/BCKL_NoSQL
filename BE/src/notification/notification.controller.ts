import { NotificationEmailWorker } from './notification-email-worker.js';
import { NotificationEmailTransport } from './notification-email-transport.js';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import type { Request } from 'express';
import { AuthModule } from '../auth/auth.module.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { DatabaseModule } from '../database.module.js';
import { NotificationProjector } from './notification-projector.js';
import { NotificationService } from './notification.service.js';
type ActorRequest = Request & { user: AuthenticatedUser };
@Controller('account/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}
  @Get() list(@Req() req: ActorRequest) {
    return this.notifications.list(req.user, req.originalUrl);
  }
  @Post('read-all') @HttpCode(200) all(
    @Req() req: ActorRequest,
    @Body() body: unknown,
  ) {
    return this.notifications.read(req.user, null, body);
  }
  @Post(':id/read') @HttpCode(200) one(
    @Req() req: ActorRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.notifications.read(req.user, id, body);
  }
}
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [NotificationController],
  providers: [NotificationProjector, NotificationService, NotificationEmailWorker, NotificationEmailTransport],
  exports: [NotificationProjector],
})
export class NotificationModule {}
