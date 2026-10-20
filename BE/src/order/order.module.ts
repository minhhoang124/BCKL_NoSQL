import { Module } from '@nestjs/common';
import { BuyerCommandResolutionController } from './buyer-command-resolution.controller.js';
import { BuyerCommandResolutionService } from './buyer-command-resolution.service.js';
import { BuyerCommandResolutionRateGuard } from './buyer-command-resolution-rate.guard.js';
import { OrderCommandResolutionService } from './order-command-resolution.service.js';
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
import {
  AdminReturnedController,
  SellerReturnedController,
} from './order-returned.controller.js';
import { OrderReturnedService } from './order-returned.service.js';
import { OrderReturnedRateGuard } from './order-returned-rate.guard.js';
import { OrderCompletionController } from './order-completion.controller.js';
import { OrderCompletionService } from './order-completion.service.js';
import { OrderCompletionWorker } from './order-completion.worker.js';
import { OrderCompletionRateGuard } from './order-completion-rate.guard.js';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    SearchModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [
    BuyerCommandResolutionController,
    OrderListController,
    OrderDetailController,
    OrderDeliveryController,
    OrderCancellationController,
    SellerOrderCommandController,
    AdminReturnedController,
    SellerReturnedController,
    OrderCompletionController,
  ],
  providers: [
    BuyerCommandResolutionService,
    BuyerCommandResolutionRateGuard,
    OrderCommandResolutionService,
    OrderListService,
    OrderDetailService,
    OrderListRateGuard,
    OrderDeliveryService,
    OrderDeliveryRateGuard,
    OrderCancellationService,
    OrderCancellationRateGuard,
    SellerOrderCommandService,
    SellerOrderCommandRateGuard,
    OrderReturnedService,
    OrderReturnedRateGuard,
    OrderCompletionService,
    OrderCompletionWorker,
    OrderCompletionRateGuard,
  ],
})
export class OrderModule {}
