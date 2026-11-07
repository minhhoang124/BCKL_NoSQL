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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import { SearchModule } from '../search/search.module.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { StoreApplicationService } from './application.service.js';
import {
  positive,
  validAction,
  invalid,
  type ApplicationAction,
} from './application-input.js';
type ActorRequest = Request & { user: AuthenticatedUser };
const id = (raw: string) =>
  /^[1-9][0-9]*$/.test(raw) ? positive(Number(raw)) : invalid();

@ApiTags('store-onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class StoreApplicationController {
  constructor(private readonly applications: StoreApplicationService) {}
  @Get('account/store-application')
  mine(@Req() req: ActorRequest) {
    return this.applications.mine(req.user, req.originalUrl);
  }
  @Post('account/store-application')
  @HttpCode(200)
  submit(@Req() req: ActorRequest, @Body() body: unknown) {
    return this.applications.execute(
      req.user,
      'OWNER',
      'submit',
      req.user.userId,
      body,
    );
  }
  @Post('account/store-application/:id/:action')
  @HttpCode(200)
  ownerAction(
    @Req() req: ActorRequest,
    @Param('id') raw: string,
    @Param('action') action: ApplicationAction,
    @Body() body: unknown,
  ) {
    if (!['edit', 'resubmit'].includes(action)) return invalid();
    return this.applications.execute(req.user, 'OWNER', action, id(raw), body);
  }
  @Post('account/store-application/commands/:action/:id/reconcile')
  @HttpCode(200)
  ownerReconcile(
    @Req() req: ActorRequest,
    @Param('id') raw: string,
    @Param('action') action: ApplicationAction,
    @Body() body: unknown,
  ) {
    validAction('OWNER', action);
    return this.applications.execute(
      req.user,
      'OWNER',
      action,
      id(raw),
      body,
      true,
    );
  }
  @Get('admin/store-applications')
  list(@Req() req: ActorRequest) {
    return this.applications.list(req.user, req.originalUrl);
  }
  @Get('admin/store-applications/:id')
  detail(@Req() req: ActorRequest, @Param('id') raw: string) {
    return this.applications.detail(req.user, id(raw), req.originalUrl);
  }
  @Post('admin/store-applications/:id/review')
  @HttpCode(200)
  review(
    @Req() req: ActorRequest,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    return this.applications.execute(
      req.user,
      'ADMIN',
      'review',
      id(raw),
      body,
    );
  }
  @Post('admin/store-applications/:id/reconcile')
  @HttpCode(200)
  reconcile(
    @Req() req: ActorRequest,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    return this.applications.execute(
      req.user,
      'ADMIN',
      'review',
      id(raw),
      body,
      true,
    );
  }
}
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    SearchModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [StoreApplicationController],
  providers: [StoreApplicationService],
})
export class StoreApplicationModule {}
