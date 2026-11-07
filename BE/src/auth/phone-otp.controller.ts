import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  HttpException,
  Injectable,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from './auth.types.js';
import { phoneOtpConfig } from './phone-otp.config.js';
import {
  phoneOtpConfirmation,
  phoneOtpRequest,
  phoneOtpReconciliation,
} from './phone-otp.input.js';
import { PhoneOtpService } from './phone-otp.service.js';
@Injectable()
export class PhoneOtpGuard implements CanActivate {
  private readonly buckets = new Map<
    string,
    { count: number; until: number }
  >();
  canActivate(ctx: ExecutionContext) {
    phoneOtpConfig();
    const req = ctx.switchToHttp().getRequest<Request>(),
      res = ctx.switchToHttp().getResponse<Response>();
    if (
      req.originalUrl.includes('?') ||
      (['GET', 'HEAD'].includes(req.method) &&
        (req.headers['transfer-encoding'] !== undefined ||
          Number(req.headers['content-length'] ?? 0) > 0))
    )
      throw new HttpException({ code: 'PHONE_OTP_INVALID_INPUT' }, 400);
    if (req.method !== 'POST') return true;
    const now = Date.now();
    for (const [k, v] of this.buckets)
      if (v.until <= now) this.buckets.delete(k);
    const ip = req.socket.remoteAddress ?? 'unknown';
    let b = this.buckets.get(ip);
    if (!b) {
      if (this.buckets.size >= 10000) throw new ServiceUnavailableException();
      b = { count: 0, until: now + 60000 };
      this.buckets.set(ip, b);
    }
    if (++b.count > 20) {
      res.setHeader('Retry-After', String(Math.ceil((b.until - now) / 1000)));
      throw new HttpException({ code: 'PHONE_OTP_IP_RATE_LIMITED' }, 429);
    }
    return true;
  }
}
@Controller('auth/phone-otp')
@UseGuards(JwtAuthGuard, PhoneOtpGuard)
export class PhoneOtpController {
  constructor(private readonly service: PhoneOtpService) {}
  @Post('request')
  @HttpCode(200)
  async request(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      return await this.service.request(actor, phoneOtpRequest(raw));
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === 429) {
        const b = e.getResponse();
        if (b && typeof b === 'object' && 'retryAfter' in b)
          res.setHeader('Retry-After', String(b.retryAfter));
      }
      throw e;
    }
  }
  @Post('confirm')
  @HttpCode(200)
  confirm(@CurrentUser() actor: AuthenticatedUser, @Body() raw: unknown) {
    return this.service.confirm(actor, phoneOtpConfirmation(raw));
  }
  @Get('status') status(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.status(actor);
  }
  @Post('reconcile')
  @HttpCode(200)
  reconcile(@CurrentUser() actor: AuthenticatedUser, @Body() raw: unknown) {
    return this.service.reconcile(
      actor,
      phoneOtpReconciliation(raw).challengeId,
    );
  }
  @Get('receipts/:id') receipt(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const input = phoneOtpConfirmation({
      challengeId: id,
      code: '000000',
      confirmed: true,
    });
    return this.service.readReceipt(actor, input.challengeId);
  }
}
