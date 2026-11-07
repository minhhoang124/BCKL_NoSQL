import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Injectable,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from './auth.types.js';
import { AuthEmailRecoveryService } from './email-recovery.service.js';
import {
  emailConfirmation,
  emailConsent,
  emailRequest,
} from './email-recovery.input.js';
@Injectable()
export class AuthEmailRateGuard implements CanActivate {
  private readonly buckets = new Map<
    string,
    { count: number; expires: number }
  >();
  canActivate(context: ExecutionContext) {
    if (process.env.AUTH_EMAIL_ENABLED !== 'true')
      throw new ServiceUnavailableException({ code: 'AUTH_EMAIL_DISABLED' });
    const req = context.switchToHttp().getRequest<Request>(),
      ip = req.socket.remoteAddress ?? 'unknown',
      now = Date.now();
    for (const [key, bucket] of this.buckets)
      if (bucket.expires <= now) this.buckets.delete(key);
    let bucket = this.buckets.get(ip);
    if (!bucket) {
      if (this.buckets.size >= 10000)
        throw new ServiceUnavailableException({ code: 'AUTH_EMAIL_BUSY' });
      bucket = { count: 0, expires: now + 60000 };
      this.buckets.set(ip, bucket);
    }
    if (++bucket.count > 10) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader(
          'Retry-After',
          String(Math.max(1, Math.ceil((bucket.expires - now) / 1000))),
        );
      throw new HttpException({ code: 'AUTH_EMAIL_RATE_LIMITED' }, 429);
    }
    return true;
  }
}
type ActorRequest = Request & { user: AuthenticatedUser };
@Controller('auth')
export class AuthEmailRecoveryController {
  constructor(private readonly recovery: AuthEmailRecoveryService) {}
  @Get('email/status')
  @UseGuards(JwtAuthGuard)
  status(@Req() req: ActorRequest) {
    return this.recovery.status(req.user);
  }
  @Post('email/request')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard, AuthEmailRateGuard)
  verifyRequest(@Req() req: ActorRequest, @Body() body: unknown) {
    emailConsent(body);
    return this.recovery.request(
      'VERIFY_EMAIL',
      null,
      req.socket.remoteAddress ?? 'unknown',
      req.user,
    );
  }
  @Post('email/confirm')
  @HttpCode(200)
  @UseGuards(AuthEmailRateGuard)
  verify(@Body() body: unknown) {
    return this.recovery.confirm('VERIFY_EMAIL', emailConfirmation(body).token);
  }
  @Post('password-reset/request')
  @HttpCode(202)
  @UseGuards(AuthEmailRateGuard)
  resetRequest(@Req() req: Request, @Body() body: unknown) {
    return this.recovery.request(
      'RESET_PASSWORD',
      emailRequest(body),
      req.socket.remoteAddress ?? 'unknown',
    );
  }
  @Post('password-reset/confirm')
  @HttpCode(200)
  @UseGuards(AuthEmailRateGuard)
  reset(@Body() body: unknown) {
    const input = emailConfirmation(body, true);
    return this.recovery.confirm(
      'RESET_PASSWORD',
      input.token,
      input.newPassword,
    );
  }
}
