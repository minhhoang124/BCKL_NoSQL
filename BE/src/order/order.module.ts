import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import { OrderListController } from './order-list.controller.js';
import { OrderListService } from './order-list.service.js';
import { OrderListRateGuard } from './order-list-rate.guard.js';
import { OrderDeliveryController } from './order-delivery.controller.js';
import { OrderDeliveryService } from './order-delivery.service.js';
import { OrderDeliveryRateGuard } from './order-delivery-rate.guard.js';
import { SearchModule } from '../search/search.module.js';
import { OrderCancellationController } from './order-cancellation.controller.js';
import { OrderCancellationService } from './order-cancellation.service.js';
import { OrderCancellationRateGuard } from './order-cancellation-rate.guard.js';
import { SellerOrderCommandController } from './seller-order-command.controller.js';
import { SellerOrderCommandService } from './seller-order-command.service.js';
import { SellerOrderCommandRateGuard } from './seller-order-command-rate.guard.js';
import { OrderDetailController } from './order-detail.controller.js';
import { OrderDetailService } from './order-detail.service.js';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    SearchModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [
    OrderListController,
    OrderDetailController,
    OrderDeliveryController,
    OrderCancellationController,
    SellerOrderCommandController,
  ],
  providers: [
    OrderListService,
    OrderDetailService,
    OrderListRateGuard,
    OrderDeliveryService,
    OrderDeliveryRateGuard,
    OrderCancellationService,
    OrderCancellationRateGuard,
    SellerOrderCommandService,
    SellerOrderCommandRateGuard,
  ],
})
export class OrderModule {}
