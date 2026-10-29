import type { Request, Response } from 'express';
import { SearchAnalyticsService } from './search-analytics.service.js';
import {
  Body,
  Req,
  Res,
  Controller,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { UploadedImage } from '../product/product-image-storage.service.js';
import {
  IMAGE_SEARCH_MAX_BYTES,
  ImageSearchService,
} from './image-search.service.js';
import { ImageSearchInterceptor } from './image-search.interceptor.js';
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
  constructor(
    private readonly analytics: SearchAnalyticsService,
    private readonly search: SearchService,
    private readonly imageSearch: ImageSearchService,
  ) {}

  @Post('image')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'JPEG/PNG <= 5 MiB; no persistence',
        },
        topK: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        candidateK: { type: 'integer', minimum: 1, maximum: 150 },
      },
    },
  })
  @UseInterceptors(
    ImageSearchInterceptor,
    FileInterceptor('image', {
      limits: {
        fileSize: IMAGE_SEARCH_MAX_BYTES,
        files: 1,
        fields: 2,
        parts: 3,
        fieldSize: 32,
        fieldNameSize: 32,
      },
    }),
  )
  async image(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @UploadedFile() file: UploadedImage | undefined,
    @Body() body: unknown,
  ) {
    return this.analytics.attach(
      await this.imageSearch.image(file, body),
      'IMAGE',
      req,
      res,
    );
  }

  @ApiOkResponse({
    description:
      'Ranked product list hydrated from PostgreSQL, filtered by public-policy rules',
  })
  @HttpCode(200)
  @Post('hybrid')
  async hybrid(
    @Body() dto: SearchHybridQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.analytics.attach(
      await this.search.hybrid(dto),
      'HYBRID_TEXT',
      req,
      res,
    );
  }
}
