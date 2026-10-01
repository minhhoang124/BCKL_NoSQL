import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { SearchModule } from '../search/search.module.js';
import { AdminCatalogController } from './admin-catalog.controller.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  imports: [
    AuthModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    SearchModule,
  ],
  controllers: [CatalogController, AdminCatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
