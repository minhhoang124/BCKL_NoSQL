import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { ProductImageRepairService } from './product-image-repair.service.js';
import { ProductImageRepairWorker } from './product-image-repair.worker.js';
import { ProductImageStorageService } from './product-image-storage.service.js';
import { ProductService } from './product.service.js';
import { SellerProductController } from './seller-product.controller.js';
import { AdminProductController } from './admin-product.controller.js';
import { PublicProductController } from './public-product.controller.js';
import { ProductLifecycleService } from './product-lifecycle.service.js';
import { SearchModule } from '../search/search.module.js';
import { SellerVariantInventoryController } from './seller-variant-inventory.controller.js';
import { SellerVariantInventoryService } from './seller-variant-inventory.service.js';

@Module({
  imports: [
    AuthModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    SearchModule,
  ],
  controllers: [
    SellerVariantInventoryController,
    SellerProductController,
    AdminProductController,
    PublicProductController,
  ],
  providers: [
    SellerVariantInventoryService,
    ProductService,
    ProductImageStorageService,
    ProductLifecycleService,
    ProductImageRepairService,
    ProductImageRepairWorker,
  ],
  exports: [ProductImageRepairService],
})
export class ProductModule {}
