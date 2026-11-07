import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { CartLineStore } from './cart-line-store.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';
import { CartRateLimitGuard } from './cart-rate-limit.guard.js';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    RedisModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [CartController],
  providers: [CartService, CartRateLimitGuard, CartLineStore],
  exports: [CartLineStore],
})
export class CartModule {}
