import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from './auth.types.js';

const REFRESH_COOKIE = 'refreshToken';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respondWithSession(await this.auth.register(dto), response);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respondWithSession(await this.auth.login(dto), response);
  }

  @ApiCookieAuth(REFRESH_COOKIE)
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respondWithSession(
      await this.auth.refresh(
        request.cookies?.[REFRESH_COOKIE] as string | undefined,
      ),
      response,
    );
  }

  @ApiCookieAuth(REFRESH_COOKIE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(
      request.cookies?.[REFRESH_COOKIE] as string | undefined,
    );
    response.clearCookie(REFRESH_COOKIE, {
      ...this.auth.getRefreshCookieOptions(),
      maxAge: undefined,
    });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getMe(user);
  }

  private respondWithSession(
    session: Awaited<ReturnType<AuthService['login']>>,
    response: Response,
  ) {
    response.cookie(
      REFRESH_COOKIE,
      session.refreshToken,
      this.auth.getRefreshCookieOptions(),
    );
    return { user: session.user, accessToken: session.accessToken };
  }
}
