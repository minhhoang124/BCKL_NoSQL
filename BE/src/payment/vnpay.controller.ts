import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  Injectable,
  HttpException,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PassportModule } from '@nestjs/passport';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import { VnpayGateway } from './vnpay-gateway.js';
import { VnpayService } from './vnpay.service.js';
import { vnpayConsent, vnpayOrderId, vnpayQuery } from './vnpay-input.js';
function ownBoundary(req: Request) {
  if (
    req.originalUrl.includes('?') ||
    (['GET', 'HEAD'].includes(req.method) &&
      (req.headers['transfer-encoding'] !== undefined ||
        Number(req.headers['content-length'] ?? 0) > 0))
  )
    throw new BadRequestException();
}
@Injectable()
export class VnpayOwnRateGuard implements CanActivate {
  private readonly buckets = new Map<
    number,
    { until: number; count: number }
  >();
  canActivate(ctx: ExecutionContext) {
    const req = ctx
        .switchToHttp()
        .getRequest<Request & { user: AuthenticatedUser }>(),
      res = ctx.switchToHttp().getResponse<Response>(),
      now = Date.now();
    for (const [k, v] of this.buckets)
      if (v.until <= now) this.buckets.delete(k);
    let b = this.buckets.get(req.user.userId);
    if (!b) {
      if (this.buckets.size >= 10000) throw new ServiceUnavailableException();
      b = { until: now + 60000, count: 0 };
      this.buckets.set(req.user.userId, b);
    }
    if (++b.count > 60) {
      res.setHeader('Retry-After', String(Math.ceil((b.until - now) / 1000)));
      throw new HttpException({ code: 'VNPAY_RATE_LIMITED' }, 429);
    }
    return true;
  }
}
@Controller('payments/vnpay')
export class VnpayController {
  constructor(private readonly service: VnpayService) {}
  @Get('orders/:id')
  @UseGuards(JwtAuthGuard, VnpayOwnRateGuard)
  read(
    @CurrentUser() a: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    ownBoundary(req);
    return this.service.read(a, vnpayOrderId(id));
  }
  @Post('orders/:id/start')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, VnpayOwnRateGuard)
  start(
    @CurrentUser() a: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    ownBoundary(req);
    vnpayConsent(body);
    return this.service.start(
      a,
      vnpayOrderId(id),
      req.socket.remoteAddress ?? '127.0.0.1',
    );
  }
  @Get('ipn')
  ipn(@Req() req: Request) {
    if (
      req.method !== 'GET' ||
      req.headers['transfer-encoding'] !== undefined ||
      Number(req.headers['content-length'] ?? 0) > 0
    )
      return { RspCode: '97', Message: 'Invalid input' };
    try {
      return this.service.ipn(vnpayQuery(req.originalUrl));
    } catch {
      return { RspCode: '97', Message: 'Invalid input' };
    }
  }
  @Get('return')
  async returned(@Req() req: Request, @Res() res: Response) {
    if (
      req.method !== 'GET' ||
      req.headers['transfer-encoding'] !== undefined ||
      Number(req.headers['content-length'] ?? 0) > 0
    )
      throw new BadRequestException();
    return res.redirect(
      303,
      await this.service.returnOrder(vnpayQuery(req.originalUrl)),
    );
  }
}
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [VnpayController],
  providers: [VnpayService, VnpayGateway, VnpayOwnRateGuard],
})
export class VnpayModule {}
