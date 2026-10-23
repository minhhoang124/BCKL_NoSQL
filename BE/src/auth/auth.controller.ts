import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from './auth.types.js';
import { AccountSettingsService } from './account-settings.service.js';
import { AccountSettingsGuard } from './account-settings.http.js';
import { passwordInput, profileInput } from './account-settings.input.js';

const REFRESH_COOKIE = 'refreshToken';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly settings: AccountSettingsService,
  ) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountSettingsGuard)
  @Patch('profile')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['fullName', 'expectedFullName'],
      properties: {
        fullName: { type: 'string', minLength: 2, maxLength: 100 },
        expectedFullName: {
          type: 'string',
          nullable: true,
          description:
            'Tên đọc từ hồ sơ trước khi sửa; gửi nguyên giá trị hoặc null',
        },
      },
    },
  })
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.settings.updateProfile(user, profileInput(body));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccountSettingsGuard)
  @HttpCode(HttpStatus.OK)
  @Post('password')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['currentPassword', 'newPassword'],
      properties: {
        currentPassword: { type: 'string', format: 'password' },
        newPassword: {
          type: 'string',
          format: 'password',
          minLength: 8,
          maxLength: 72,
          description: 'Không trim; tối đa72byteUTF-8, không chỉ72ký tự',
        },
      },
    },
  })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    // No Set-Cookie: an old in-flight response must not clear a newer login cookie.
    return this.settings.changePassword(user, passwordInput(body));
  }

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
