import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { SearchModule } from '../search/search.module.js';
import { AdminCatalogController } from './admin-catalog.controller.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { AdminAttributeReadController } from './admin-attribute-read.controller.js';
import { AdminAttributeReadService } from './admin-attribute-read.service.js';
import { AdminAttributeWriteController } from './admin-attribute-write.controller.js';
import { AdminAttributeWriteService } from './admin-attribute-write.service.js';
import { AttributeWriteRateGuard } from './admin-attribute-write.http.js';

@Module({
  imports: [
    AuthModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    SearchModule,
  ],
  controllers: [
    CatalogController,
    AdminCatalogController,
    AdminAttributeReadController,
    AdminAttributeWriteController,
  ],
  providers: [
    CatalogService,
    AdminAttributeReadService,
    AdminAttributeWriteService,
    AttributeWriteRateGuard,
  ],
})
export class CatalogModule {}
