import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module.js';
import { SearchAnalyticsService } from './search-analytics.service.js';
// Keep this core independent of AuthModule: AuthModule already imports SearchModule.
@Module({
  imports: [DatabaseModule],
  providers: [SearchAnalyticsService],
  exports: [SearchAnalyticsService],
})
export class SearchAnalyticsCoreModule {}
