import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import { OrderListController } from './order-list.controller.js';
import { OrderListService } from './order-list.service.js';
import { OrderListRateGuard } from './order-list-rate.guard.js';
import { SellerOrderCommandController } from './seller-order-command.controller.js';
import { SellerOrderCommandService } from './seller-order-command.service.js';
import { SellerOrderCommandRateGuard } from './seller-order-command-rate.guard.js';
import { OrderDetailController } from './order-detail.controller.js';
import { OrderDetailService } from './order-detail.service.js';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [
    OrderListController,
    OrderDetailController,
    SellerOrderCommandController,
  ],
  providers: [
    OrderListService,
    OrderDetailService,
    OrderListRateGuard,
    SellerOrderCommandService,
    SellerOrderCommandRateGuard,
  ],
})
export class OrderModule {}
