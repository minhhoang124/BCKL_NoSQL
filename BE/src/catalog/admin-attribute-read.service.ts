import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { attributeReadQuery } from './admin-attribute-read.query.js';

const definitionSelect = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  dataType: true,
  isRequired: true,
  isFilterable: true,
  allowsCustom: true,
  sortOrder: true,
  isActive: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { productValues: true } },
} satisfies Prisma.CategoryAttributeDefinitionSelect;

function page<T extends { id: number }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? items[items.length - 1].id : null,
  };
}

type Definition = Prisma.CategoryAttributeDefinitionGetPayload<{
  select: typeof definitionSelect;
}>;
function definitionDto({ _count, ...row }: Definition) {
  // ProductValue has a unique(productId, definitionId), so this is distinct Products.
  return { ...row, usage: { referencedProductCount: _count.productValues } };
}

@Injectable()
export class AdminAttributeReadService {
  constructor(private readonly prisma: PrismaService) {}

  private read<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
        return work(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 2000,
        timeout: 5000,
      },
    );
  }

  list(categoryId: number, query: ReturnType<typeof attributeReadQuery>) {
    return this.read(async (tx) => {
      if (
        !(await tx.category.findUnique({
          where: { id: categoryId },
          select: { id: true },
        }))
      ) {
        throw new NotFoundException({
          statusCode: 404,
          code: 'CATEGORY_NOT_FOUND',
          message: 'Category not found',
        });
      }
      const rows = await tx.categoryAttributeDefinition.findMany({
        where: {
          categoryId,
          isActive: query.isActive,
          ...(query.afterId === undefined ? {} : { id: { gt: query.afterId } }),
        },
        orderBy: { id: 'asc' },
        take: query.limit + 1,
        select: definitionSelect,
      });
      return page(rows.map(definitionDto), query.limit);
    });
  }

  detail(categoryId: number, attributeId: number) {
    return this.read(async (tx) => {
      const row = await tx.categoryAttributeDefinition.findFirst({
        where: { id: attributeId, categoryId },
        select: definitionSelect,
      });
      if (!row)
        throw new NotFoundException({
          statusCode: 404,
          code: 'ATTRIBUTE_NOT_FOUND',
          message: 'Attribute not found',
        });
      return definitionDto(row);
    });
  }

  options(
    categoryId: number,
    attributeId: number,
    query: ReturnType<typeof attributeReadQuery>,
  ) {
    return this.read(async (tx) => {
      const definition = await tx.categoryAttributeDefinition.findFirst({
        where: { id: attributeId, categoryId },
        select: { revision: true },
      });
      if (!definition)
        throw new NotFoundException({
          statusCode: 404,
          code: 'ATTRIBUTE_NOT_FOUND',
          message: 'Attribute not found',
        });
      const rows = await tx.categoryAttributeOption.findMany({
        where: {
          attributeDefinitionId: attributeId,
          isActive: query.isActive,
          ...(query.afterId === undefined ? {} : { id: { gt: query.afterId } }),
        },
        orderBy: { id: 'asc' },
        take: query.limit + 1,
        select: {
          id: true,
          attributeDefinitionId: true,
          value: true,
          slug: true,
          sortOrder: true,
          isActive: true,
          _count: { select: { productValues: true } },
        },
      });
      return {
        ...page(
          rows.map(({ _count, ...row }) => ({
            ...row,
            referencedProductCount: _count.productValues,
          })),
          query.limit,
        ),
        definitionRevision: definition.revision,
      };
    });
  }
}
