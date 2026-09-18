import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { StoreController } from './store.controller.js';
import { AdminStoreController } from './admin-store.controller.js';
import { StoreService } from './store.service.js';

@Module({
  imports: [AuthModule, PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [StoreController, AdminStoreController],
  providers: [StoreService],
})
export class StoreModule {}
