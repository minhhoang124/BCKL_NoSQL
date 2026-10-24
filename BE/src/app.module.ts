import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AccessModule } from './access/access.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { StoreModule } from './store/store.module.js';
import { ProductModule } from './product/product.module.js';
import { SearchModule } from './search/search.module.js';
import { AddressModule } from './address/address.module.js';
import { CartModule } from './cart/cart.module.js';
import { OrderModule } from './order/order.module.js';
import { CheckoutModule } from './checkout/checkout.module.js';
import { AdminSystemHealthModule } from './health/admin-system-health.module.js';
import { ChatModule } from './chat/chat.controller.js';

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
    CatalogModule,
    ProductModule,
    SearchModule,
    AddressModule,
    CartModule,
    OrderModule,
    CheckoutModule,
    AdminSystemHealthModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
