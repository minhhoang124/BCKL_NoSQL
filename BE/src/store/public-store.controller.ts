import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { DatabaseModule } from '../database.module.js';
import { PrismaService } from '../prisma.service.js';
import {
  isPublicListing,
  listingInclude,
  publicProduct,
} from '../product/product-public-policy.js';

const invalid = (): never => {
  throw new BadRequestException({ code: 'PUBLIC_STORE_INVALID_INPUT' });
};
export function publicStoreId(raw: unknown): number {
  if (
    typeof raw !== 'string' ||
    !/^[1-9][0-9]{0,9}$/.test(raw) ||
    Number(raw) > 2147483647
  )
    return invalid();
  return Number(raw);
}
export function publicStoreQuery(url: string): {
  limit: number;
  afterId?: number;
} {
  const raw = url.split('?').slice(1).join('?');
  if (raw.length > 1024 || /%(?![0-9a-f]{2})/i.test(raw)) return invalid();
  const result: { limit: number; afterId?: number } = { limit: 24 },
    seen = new Set<string>();
  for (const [key, value] of new URLSearchParams(raw)) {
    if (!['limit', 'afterId'].includes(key) || seen.has(key)) return invalid();
    seen.add(key);
    const n = publicStoreId(value);
    if (key === 'limit') {
      if (n > 48) return invalid();
      result.limit = n;
    } else result.afterId = n;
  }
  return result;
}
@Injectable()
export class PublicStoreService {
  constructor(private readonly db: PrismaService) {}
  read(storeId: number, query: { limit: number; afterId?: number }) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
        const store = await tx.store.findFirst({
          where: { id: storeId, status: 'ACTIVE', seller: { isActive: true } },
          select: { id: true, name: true, description: true },
        });
        if (!store)
          throw new NotFoundException({ code: 'PUBLIC_STORE_NOT_FOUND' });
        const categories = await tx.category.findMany({
          select: { id: true, parentId: true, isActive: true },
        });
        // Same visibility evaluator and public projection as /products and Search hydrate.
        // Read at most 200 candidates; an empty page can still have a continuation cursor.
        const rows = await tx.product.findMany({
          where: {
            storeId,
            sellerStatus: 'ACTIVE',
            moderationStatus: 'APPROVED',
            ...(query.afterId ? { id: { gt: query.afterId } } : {}),
          },
          include: listingInclude,
          orderBy: { id: 'asc' },
          take: 200,
        });
        const items: ReturnType<typeof publicProduct>[] = [];
        for (let i = 0; i < rows.length; i++) {
          if (isPublicListing(rows[i], categories))
            items.push(publicProduct(rows[i]));
          if (items.length === query.limit)
            return {
              store,
              items,
              nextCursor:
                i < rows.length - 1 || rows.length === 200 ? rows[i].id : null,
            };
        }
        return {
          store,
          items,
          nextCursor: rows.length === 200 ? rows.at(-1)!.id : null,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 3000,
        timeout: 7000,
      },
    );
  }
}
@ApiTags('public-stores')
@Controller('stores')
export class PublicStoreController {
  constructor(private readonly stores: PublicStoreService) {}
  @Get(':storeId')
  @ApiOperation({
    summary:
      'Public Store profile and approved Product page; no account/contact/audit fields',
  })
  read(@Param('storeId') raw: string, @Req() req: Request) {
    return this.stores.read(
      publicStoreId(raw),
      publicStoreQuery(req.originalUrl),
    );
  }
}
@Module({
  imports: [DatabaseModule],
  controllers: [PublicStoreController],
  providers: [PublicStoreService],
})
export class PublicStoreModule {}
