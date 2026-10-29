import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { DatabaseModule } from '../database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { SearchModule } from '../search/search.module.js';
import { AdminAccountController } from './admin-account.controller.js';
import { AdminAccountListService } from './admin-account-list.service.js';
import { AccountSettingsService } from './account-settings.service.js';
import { AccountSettingsGuard } from './account-settings.http.js';
import { AccountStatusRecoveryService } from './account-status-recovery.service.js';
import {
  AuthEmailRecoveryController,
  AuthEmailRateGuard,
} from './email-recovery.controller.js';
import { AuthEmailRecoveryService } from './email-recovery.service.js';
import { AuthEmailDelivery } from './email-delivery.js';
import {
  GoogleOAuthController,
  GoogleOAuthGuard,
} from './google-oauth.controller.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { GoogleOAuthProvider } from './google-oauth.provider.js';
import { PhoneOtpController, PhoneOtpGuard } from './phone-otp.controller.js';
import {
  PhoneOtpService,
  PhoneOtpSandboxDelivery,
} from './phone-otp.service.js';
import { AuthSessionRate, AuthSessionRateGuard } from './auth-session-rate.js';

@Module({
  imports: [
    DatabaseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    SearchModule,
  ],
  controllers: [
    AuthController,
    AdminAccountController,
    AuthEmailRecoveryController,
    GoogleOAuthController,
    PhoneOtpController,
  ],
  providers: [
    AuthSessionRate,
    AuthSessionRateGuard,
    PhoneOtpService,
    PhoneOtpSandboxDelivery,
    PhoneOtpGuard,
    GoogleOAuthService,
    GoogleOAuthProvider,
    GoogleOAuthGuard,
    AuthEmailRecoveryService,
    AuthEmailDelivery,
    AuthEmailRateGuard,
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    AdminAccountListService,
    AccountSettingsService,
    AccountSettingsGuard,
    AccountStatusRecoveryService,
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
