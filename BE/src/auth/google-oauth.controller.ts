import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  HttpException,
  Injectable,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { AuthenticatedUser } from './auth.types.js';
import { AuthService } from './auth.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { googleConfig } from './google-oauth.config.js';
import { bcryptPassword } from './password-policy.js';
const PROOF = 'bcklGoogleProof';
const invalid = () =>
  new HttpException({ code: 'GOOGLE_OAUTH_INVALID_INPUT' }, 400);
@Injectable()
export class GoogleOAuthGuard implements CanActivate {
  private readonly rates = new Map<string, { count: number; until: number }>();
  canActivate(context: ExecutionContext) {
    const c = googleConfig(),
      req = context.switchToHttp().getRequest<Request>(),
      res = context.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (
      req.method === 'POST' &&
      (req.get('origin') !== c.web || req.originalUrl.includes('?'))
    )
      throw invalid();
    if (
      req.method === 'GET' &&
      (req.headers['transfer-encoding'] !== undefined ||
        Number(req.headers['content-length'] ?? 0) > 0)
    )
      throw invalid();
    const now = Date.now();
    for (const [k, v] of this.rates) if (v.until <= now) this.rates.delete(k);
    const key = req.socket.remoteAddress ?? 'unknown';
    let v = this.rates.get(key);
    if (!v) {
      if (this.rates.size >= 10000) throw new ServiceUnavailableException();
      v = { count: 0, until: now + 60000 };
      this.rates.set(key, v);
    }
    if (++v.count > 20) {
      res.setHeader('Retry-After', String(Math.ceil((v.until - now) / 1000)));
      throw new HttpException({ code: 'GOOGLE_OAUTH_RATE_LIMITED' }, 429);
    }
    return true;
  }
}
@Controller('auth/google')
@UseGuards(GoogleOAuthGuard)
export class GoogleOAuthController {
  constructor(
    private readonly google: GoogleOAuthService,
    private readonly auth: AuthService,
  ) {}
  private input(raw: unknown, link = false) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.getPrototypeOf(raw) !== Object.prototype
    )
      throw invalid();
    const x = raw as Record<string, unknown>,
      keys = Object.keys(x);
    if (
      x.confirmed !== true ||
      keys.length !== (link ? 2 : 1) ||
      keys.some(
        (k) => !['confirmed', ...(link ? ['currentPassword'] : [])].includes(k),
      )
    )
      throw invalid();
    if (
      link &&
      (typeof x.currentPassword !== 'string' ||
        !x.currentPassword ||
        Buffer.byteLength(x.currentPassword) > 72 ||
        !bcryptPassword(x.currentPassword))
    )
      throw invalid();
    return x.currentPassword as string | undefined;
  }
  private response(result: { proof: string; url: string }, res: Response) {
    res.cookie(PROOF, result.proof, {
      httpOnly: true,
      secure: googleConfig().secure,
      sameSite: 'lax',
      path: '/auth/google',
      maxAge: 600000,
    });
    return { authorizationUrl: result.url };
  }
  @Post('start')
  @HttpCode(200)
  async start(
    @Body() raw: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.input(raw);
    return this.response(
      await this.google.start(undefined, undefined, req.cookies?.refreshToken),
      res,
    );
  }
  @Post('link')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async link(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() raw: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.response(
      await this.google.start(
        actor,
        this.input(raw, true),
        req.cookies?.refreshToken,
      ),
      res,
    );
  }
  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    if (req.originalUrl.includes('?')) throw invalid();
    return this.google.status(actor);
  }
  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response) {
    const c = googleConfig();
    try {
      if (req.originalUrl.length > 8192) throw invalid();
      const q = new URL(req.originalUrl, 'http://callback.invalid')
        .searchParams;
      const allowed = [
        'code',
        'state',
        'scope',
        'authuser',
        'prompt',
        'hd',
        'iss',
        'error',
        'error_description',
        'error_uri',
      ];
      if (
        [...q.keys()].some(
          (k) => !allowed.includes(k) || q.getAll(k).length !== 1,
        ) ||
        (q.has('code') && q.has('error'))
      )
        throw invalid();
      const result = await this.google.finish(
        q.get('state'),
        req.cookies?.[PROOF],
        q.has('error') ? null : q.get('code'),
        req.cookies?.refreshToken,
      );
      if (result.session) {
        res.cookie(
          'refreshToken',
          result.session.refreshToken,
          this.auth.getRefreshCookieOptions(),
        );
        return res.redirect(303, c.web + '/account');
      }
      // Link revokes sessions. Do not clear a cookie which a newer login may
      // have installed concurrently; the explicit next login will replace it.
      return res.redirect(303, c.web + '/login?google=linked');
    } catch (e) {
      const body = e instanceof HttpException ? e.getResponse() : null;
      const collision =
        body &&
        typeof body === 'object' &&
        'code' in body &&
        body.code === 'ACCOUNT_COLLISION_LINK_REQUIRED';
      // No exception/provider body, token/code/email or arbitrary return URL.
      return res.redirect(
        303,
        c.web + '/login?google=' + (collision ? 'collision' : 'failed'),
      );
    }
  }
}
