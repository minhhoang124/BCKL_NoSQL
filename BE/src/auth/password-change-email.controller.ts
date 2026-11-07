import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccountSettingsGuard } from './account-settings.http.js';
import type { AuthenticatedUser } from './auth.types.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import {
  passwordChangeConfirm,
  passwordChangeRequest,
  passwordChangeVerify,
} from './password-change-email.input.js';
import { PasswordChangeEmailService } from './password-change-email.service.js';

type ActorRequest = Request & { user: AuthenticatedUser };

/** Disabled unless AUTH_PASSWORD_CHANGE_MODE=EMAIL (reviewed before enabling). */
@ApiTags('auth-password-change-email')
@ApiBearerAuth()
@Controller('auth/password-change')
export class PasswordChangeEmailController {
  constructor(private readonly changes: PasswordChangeEmailService) {}

  @Post('request')
  @UseGuards(JwtAuthGuard, AccountSettingsGuard)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['currentPassword', 'confirmed'],
      properties: {
        currentPassword: { type: 'string', format: 'password' },
        confirmed: { type: 'boolean', enum: [true] },
      },
    },
  })
  request(@Req() req: ActorRequest, @Body() body: unknown) {
    const input = passwordChangeRequest(body);
    return this.changes.request(
      req.user,
      input.currentPassword,
      req.socket.remoteAddress ?? 'unknown',
    );
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['token', 'bindingSecret'],
      properties: {
        token: { type: 'string' },
        bindingSecret: { type: 'string' },
      },
    },
  })
  verify(@Req() req: ActorRequest, @Body() body: unknown) {
    const input = passwordChangeVerify(body);
    return this.changes.verify(req.user, input.token, input.bindingSecret);
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard, AccountSettingsGuard)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['token', 'bindingSecret', 'newPassword', 'confirmed'],
      properties: {
        token: { type: 'string' },
        bindingSecret: { type: 'string' },
        newPassword: {
          type: 'string',
          format: 'password',
          minLength: 8,
          maxLength: 72,
        },
        confirmed: { type: 'boolean', enum: [true] },
      },
    },
  })
  confirm(@Req() req: ActorRequest, @Body() body: unknown) {
    const input = passwordChangeConfirm(body);
    return this.changes.confirm(
      req.user,
      input.token,
      input.bindingSecret,
      input.newPassword,
    );
  }
}
