import { SearchAnalyticsModule } from './search/search-analytics.controller.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AccessModule } from './access/access.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { PublicStoreModule } from './store/public-store.controller.js';
import { StoreModule } from './store/store.module.js';
import { ProductModule } from './product/product.module.js';
import { SearchModule } from './search/search.module.js';
import { AddressModule } from './address/address.module.js';
import { CartModule } from './cart/cart.module.js';
import { OrderModule } from './order/order.module.js';
import { CheckoutModule } from './checkout/checkout.module.js';
import { AdminSystemHealthModule } from './health/admin-system-health.module.js';
import { ChatModule } from './chat/chat.controller.js';
import { AftersalesModule } from './aftersales/aftersales-controller.js';
import { DashboardModule } from './dashboard/dashboard.controller.js';
import { StoreApplicationModule } from './store/application.controller.js';
import { ReviewModule } from './review/review.controller.js';
import { NotificationModule } from './notification/notification.controller.js';
import { VnpayModule } from './payment/vnpay.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    DatabaseModule,
    AuthModule,
    AccessModule,
    StoreModule,
    PublicStoreModule,
    CatalogModule,
    ProductModule,
    SearchModule,
    SearchAnalyticsModule,
    AddressModule,
    CartModule,
    OrderModule,
    CheckoutModule,
    AdminSystemHealthModule,
    ChatModule,
    AftersalesModule,
    DashboardModule,
    StoreApplicationModule,
    ReviewModule,
    NotificationModule,
    VnpayModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
