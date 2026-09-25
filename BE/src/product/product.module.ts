import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { ProductImageStorageService } from './product-image-storage.service.js';
import { ProductService } from './product.service.js';
import { SellerProductController } from './seller-product.controller.js';
import { AdminProductController } from './admin-product.controller.js';
import { PublicProductController } from './public-product.controller.js';
import { ProductLifecycleService } from './product-lifecycle.service.js';

@Module({
  imports: [AuthModule, PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [
    SellerProductController,
    AdminProductController,
    PublicProductController,
  ],
  providers: [
    ProductService,
    ProductImageStorageService,
    ProductLifecycleService,
  ],
})
export class ProductModule {}
