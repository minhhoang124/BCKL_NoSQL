import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SearchHybridQueryDto } from './dto/search-query.dto.js';
import { SearchService } from './search.service.js';

/**
 * SearchController
 *
 * Public search endpoint. Authentication is not required; result filtering is
 * enforced server-side via product-public-policy.ts so hidden/frozen products
 * are never returned even if the search index is stale.
 */
@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @ApiOkResponse({
    description:
      'Ranked product list hydrated from PostgreSQL, filtered by public-policy rules',
  })
  @HttpCode(200)
  @Post('hybrid')
  hybrid(@Body() dto: SearchHybridQueryDto) {
    return this.search.hybrid(dto);
  }
}
