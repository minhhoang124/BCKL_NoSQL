import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { ProductImageStorageService } from './product-image-storage.service.js';
import { ProductService } from './product.service.js';
import { SellerProductController } from './seller-product.controller.js';

@Module({
  imports: [AuthModule, PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [SellerProductController],
  providers: [ProductService, ProductImageStorageService],
})
export class ProductModule {}
