import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SearchController } from './search.controller.js';
import { SearchOutboxService } from './search-outbox.service.js';
import { SearchReconciliationService } from './search-reconciliation.service.js';
import { SearchReconciliationWorker } from './search-reconciliation.worker.js';
import { SearchService } from './search.service.js';
import { SearchSyncWorker } from './search-sync.worker.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [SearchController],
  providers: [
    SearchOutboxService,
    SearchReconciliationService,
    SearchReconciliationWorker,
    SearchService,
    SearchSyncWorker,
  ],
  exports: [SearchOutboxService, SearchReconciliationService],
})
export class SearchModule {}
