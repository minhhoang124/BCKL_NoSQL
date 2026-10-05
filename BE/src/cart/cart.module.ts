import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';
import { CartRateLimitGuard } from './cart-rate-limit.guard.js';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [CartController],
  providers: [CartService, CartRateLimitGuard],
})
export class CartModule {}
