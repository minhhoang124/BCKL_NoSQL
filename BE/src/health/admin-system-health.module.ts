import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PassportModule } from '@nestjs/passport';
import { AdminSystemHealthController } from './admin-system-health.controller.js';
import { AdminSystemHealthService } from './admin-system-health.service.js';

@Module({
  imports: [AuthModule, PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [AdminSystemHealthController],
  providers: [AdminSystemHealthService],
})
export class AdminSystemHealthModule {}
