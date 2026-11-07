import { SearchAnalyticsCoreModule } from './search-analytics.module.js';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SearchController } from './search.controller.js';
import { SearchOutboxService } from './search-outbox.service.js';
import { SearchReconciliationService } from './search-reconciliation.service.js';
import { SearchReconciliationWorker } from './search-reconciliation.worker.js';
import { SearchService } from './search.service.js';
import { SearchSyncWorker } from './search-sync.worker.js';
import { ImageSearchService } from './image-search.service.js';
import { ImageSearchInterceptor } from './image-search.interceptor.js';

@Module({
  imports: [ScheduleModule.forRoot(), SearchAnalyticsCoreModule],
  controllers: [SearchController],
  providers: [
    SearchOutboxService,
    SearchReconciliationService,
    SearchReconciliationWorker,
    SearchService,
    ImageSearchService,
    ImageSearchInterceptor,
    SearchSyncWorker,
  ],
  exports: [SearchOutboxService, SearchReconciliationService],
})
export class SearchModule {}
