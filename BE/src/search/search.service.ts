import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import {
  isPublicListing,
  listingInclude,
  publicProduct,
} from '../product/product-public-policy.js';
import type { SearchHybridQueryDto } from './dto/search-query.dto.js';

interface SearchServiceItem {
  productId: number;
  rank: number;
  score: number;
}

interface SearchServiceResponse {
  query: { type: 'hybrid_text'; text: string };
  items: SearchServiceItem[];
  responseTimeMs: number;
}

/**
 * SearchService
 *
 * Handles the search hydrate/filter flow:
 * 1. Forward query + filters to FastAPI POST /search/hybrid.
 * 2. Receive ordered list of productIds.
 * 3. Batch-hydrate from PostgreSQL using the same public-policy predicate.
 * 4. Filter out products that no longer qualify as public (stale index case).
 * 5. Preserve the relative rank order of remaining valid products.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly aiServiceUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.aiServiceUrl =
      this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
    const configuredTimeout = Number(
      this.config.get<string>('AI_SEARCH_TIMEOUT_MS') ?? 10_000,
    );
    this.requestTimeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 10_000;
  }

  async hybrid(dto: SearchHybridQueryDto) {
    if ((dto.candidateK ?? 100) < (dto.topK ?? 20))
      throw new BadRequestException(
        'candidateK must be greater than or equal to topK',
      );
    if (
      dto.minPrice != null &&
      dto.maxPrice != null &&
      dto.minPrice > dto.maxPrice
    )
      throw new BadRequestException(
        'minPrice must be less than or equal to maxPrice',
      );
    // 1. Call FastAPI Search Service
    const aiResponse = await this.callFastApiSearch(dto);

    return this.hydrate(aiResponse, dto);
  }

  // Both retrieval modes use the same canonical PostgreSQL/public-policy read.
  // Input must have passed its mode-specific wire validator before this method.
  async hydrate(
    aiResponse: Pick<SearchServiceResponse, 'items' | 'responseTimeMs'>,
    dto: Omit<SearchHybridQueryDto, 'query'>,
  ) {
    if (aiResponse.items.length === 0) {
      return { items: [], responseTimeMs: aiResponse.responseTimeMs };
    }

    const rankedIds = aiResponse.items.map((item) => item.productId);

    // 2. Hydrate from PostgreSQL (batch read with all relations for policy checks)
    const products = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const rows = await tx.product.findMany({
          where: {
            id: { in: rankedIds },
            // Quick pre-filter – prevents loading clearly non-public rows.
            // The final authoritative check is isPublicListing below.
            sellerStatus: 'ACTIVE',
            moderationStatus: 'APPROVED',
            store: { status: 'ACTIVE', seller: { isActive: true } },
          },
          include: listingInclude,
        });
        const categories = await tx.category.findMany({
          select: { id: true, parentId: true, isActive: true },
        });
        return { rows, categories };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    // Index by productId for O(1) lookup
    const productMap = new Map(
      products.rows.map((product) => [product.id, product]),
    );

    // 3. Filter + preserve rank order
    const resultItems: Array<{
      productId: number;
      rank: number;
      score: number;
      product: ReturnType<typeof publicProduct>;
    }> = [];

    for (const item of aiResponse.items) {
      if (resultItems.some((existing) => existing.productId === item.productId))
        continue;
      const product = productMap.get(item.productId);
      if (!product) continue; // Not found or filtered by pre-filter
      if (!isPublicListing(product, products.categories)) continue; // Dynamic check
      if (
        dto.brandIds?.length &&
        (!product.brandId || !dto.brandIds.includes(product.brandId))
      )
        continue;
      if (dto.categoryIds?.length) {
        const path = new Set<number>();
        let id: number | null = product.categoryId;
        while (id !== null && !path.has(id)) {
          path.add(id);
          id =
            products.categories.find((category) => category.id === id)
              ?.parentId ?? null;
        }
        if (!dto.categoryIds.some((categoryId) => path.has(categoryId)))
          continue;
      }
      const published = publicProduct(product);
      // Price and stock must match one and the same currently sellable variant.
      if (
        !published.variants.some(
          (variant) =>
            (dto.minPrice == null ||
              new Prisma.Decimal(variant.price).gte(dto.minPrice)) &&
            (dto.maxPrice == null ||
              new Prisma.Decimal(variant.price).lte(dto.maxPrice)) &&
            (dto.inStock == null || variant.inStock === dto.inStock),
        )
      )
        continue;
      resultItems.push({
        productId: item.productId,
        rank: item.rank,
        score: item.score,
        product: published,
      });
      if (resultItems.length >= (dto.topK ?? 20)) break;
    }

    return {
      items: resultItems,
      responseTimeMs: aiResponse.responseTimeMs,
    };
  }

  private validateSearchResponse(raw: unknown): SearchServiceResponse {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Search Service returned non-object response');
    }
    const data = raw as Record<string, unknown>;
    this.assertExactKeys(
      data,
      ['query', 'items', 'responseTimeMs'],
      'response',
    );
    if (!data.query || typeof data.query !== 'object') {
      throw new Error('Search Service response missing query object');
    }
    const query = data.query as Record<string, unknown>;
    this.assertExactKeys(query, ['type', 'text'], 'query');
    if (query.type !== 'hybrid_text') {
      throw new Error('Search Service response invalid query type');
    }
    if (typeof query.text !== 'string') {
      throw new Error('Search Service response invalid query text');
    }
    if (!Array.isArray(data.items)) {
      throw new Error('Search Service response missing items array');
    }
    for (const item of data.items) {
      if (!item || typeof item !== 'object') {
        throw new Error('Search Service response item is not an object');
      }
      const rec = item as Record<string, unknown>;
      this.assertExactKeys(rec, ['productId', 'rank', 'score'], 'item');
      if (
        typeof rec.productId !== 'number' ||
        !Number.isInteger(rec.productId) ||
        rec.productId < 1
      ) {
        throw new Error(
          `Search Service item invalid productId: ${String(rec.productId)}`,
        );
      }
      if (
        typeof rec.rank !== 'number' ||
        !Number.isInteger(rec.rank) ||
        rec.rank < 1
      ) {
        throw new Error(
          `Search Service item invalid rank: ${String(rec.rank)}`,
        );
      }
      if (typeof rec.score !== 'number' || !Number.isFinite(rec.score)) {
        throw new Error(
          `Search Service item invalid score: ${String(rec.score)}`,
        );
      }
    }
    if (
      typeof data.responseTimeMs !== 'number' ||
      !Number.isFinite(data.responseTimeMs) ||
      data.responseTimeMs < 0
    ) {
      throw new Error(
        `Search Service response invalid responseTimeMs: ${String(data.responseTimeMs)}`,
      );
    }
    return raw as SearchServiceResponse;
  }

  /** Mirrors PR #8 HybridSearchResponse with Pydantic extra="forbid". */
  private assertExactKeys(
    value: Record<string, unknown>,
    expected: readonly string[],
    location: string,
  ): void {
    const actual = Object.keys(value);
    const extras = actual.filter((key) => !expected.includes(key));
    const missing = expected.filter((key) => !actual.includes(key));
    if (extras.length || missing.length) {
      throw new Error(
        `Search Service response invalid ${location} fields` +
          ` (missing: ${missing.join(',') || 'none'}; extra: ${extras.join(',') || 'none'})`,
      );
    }
  }

  private async callFastApiSearch(
    dto: SearchHybridQueryDto,
  ): Promise<SearchServiceResponse> {
    const body = {
      query: dto.query,
      filters: {
        ...(dto.categoryIds?.length ? { categoryIds: dto.categoryIds } : {}),
        ...(dto.brandIds?.length ? { brandIds: dto.brandIds } : {}),
        ...(dto.minPrice != null ? { minPrice: dto.minPrice } : {}),
        ...(dto.maxPrice != null ? { maxPrice: dto.maxPrice } : {}),
        ...(dto.inStock != null ? { inStock: dto.inStock } : {}),
      },
      topK: dto.topK ?? 20,
      candidateK: dto.candidateK ?? 100,
    };

    let res: Response;
    try {
      res = await fetch(`${this.aiServiceUrl}/search/hybrid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Search Service unreachable: ${msg}`);
      throw new Error(`Search Service unreachable: ${msg}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Search Service error ${res.status}: ${text}`);
      throw new Error(`Search Service returned ${res.status}`);
    }

    const raw = await res.json().catch(() => {
      throw new Error('Search Service response is not valid JSON');
    });
    return this.validateSearchResponse(raw);
  }
}
