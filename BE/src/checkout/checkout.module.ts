import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database.module.js';
import { CheckoutReadController } from './checkout-read.controller.js';
import { CheckoutReadService } from './checkout-read.service.js';
import { CheckoutReadRateGuard } from './checkout-read-rate.guard.js';
import { SearchModule } from '../search/search.module.js';
import { CheckoutCreateController } from './checkout-create.controller.js';
import { CheckoutCreateService } from './checkout-create.service.js';
import {
  CheckoutCreateRate,
  CheckoutCreateIngressGuard,
} from './checkout-create-rate.js';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    SearchModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [CheckoutReadController, CheckoutCreateController],
  providers: [
    CheckoutReadService,
    CheckoutReadRateGuard,
    CheckoutCreateService,
    CheckoutCreateRate,
    CheckoutCreateIngressGuard,
  ],
})
export class CheckoutModule {}
