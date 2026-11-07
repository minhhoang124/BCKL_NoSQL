import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { SearchReconciliationService } from '../search/search-reconciliation.service.js';
import { AttributeTransactionBoundary } from './attribute-transaction-boundary.js';
import type { AttributeTransactionContext } from './attribute-transaction-boundary.js';
import {
  AttributePolicyError,
  parseAttributeWrite,
  planDefinitionCreate,
  planDefinitionPatch,
  planOptionCreate,
  planOptionPatch,
} from './attribute-write-policy.js';
import { rethrowAttributeUniqueError } from './attribute-unique-error.js';

// Build the response INSIDE the write snapshot, never a post-commit GET whose
// failure could conceal a successful mutation or describe a later revision.
async function result(
  tx: Prisma.TransactionClient,
  definitionId: number,
  optionId: number | undefined,
  searchReconciliation: { jobId: string; status: string } | null,
) {
  const { _count, ...definition } =
    await tx.categoryAttributeDefinition.findUniqueOrThrow({
      where: { id: definitionId },
      select: {
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
      },
    });
  const row =
    optionId === undefined
      ? null
      : await tx.categoryAttributeOption.findUniqueOrThrow({
          where: { id: optionId },
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
  const option =
    row &&
    (() => {
      const { _count: usage, ...fields } = row;
      return { ...fields, referencedProductCount: usage.productValues };
    })();
  return {
    definition: {
      ...definition,
      usage: { referencedProductCount: _count.productValues },
    },
    option,
    searchReconciliation,
  };
}

@Injectable()
export class AdminAttributeWriteService {
  private readonly boundary: AttributeTransactionBoundary;

  constructor(
    prisma: PrismaService,
    reconciliation: SearchReconciliationService,
  ) {
    this.boundary = new AttributeTransactionBoundary(prisma, reconciliation);
  }

  private async mapped<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AttributePolicyError)
        throw new HttpException(
          { statusCode: error.status, code: error.code, message: error.code },
          error.status,
        );
      rethrowAttributeUniqueError(error);
    }
  }

  createDefinition(actorId: number, categoryId: number, raw: unknown) {
    return this.mapped(async () => {
      const input = parseAttributeWrite(raw, 'definition', 'create');
      const created = await this.boundary.createDefinition(
        { actorId, categoryId },
        async (ctx) => {
          const plan = planDefinitionCreate(input, ctx.categoryProductCount);
          return {
            values: plan.next,
            reason: input.reason,
            searchMayBeAffected: plan.searchMayBeAffected,
          };
        },
      );
      // New ID cannot have ProductValue until this transaction commits. Do not
      // issue another DB read after commit or expose unallowlisted internals.
      const definition = created.definition;
      return {
        definition: {
          id: definition.id,
          categoryId: definition.categoryId,
          name: definition.name,
          slug: definition.slug,
          dataType: definition.dataType,
          isRequired: definition.isRequired,
          isFilterable: definition.isFilterable,
          allowsCustom: definition.allowsCustom,
          sortOrder: definition.sortOrder,
          isActive: definition.isActive,
          revision: definition.revision,
          createdAt: definition.createdAt,
          updatedAt: definition.updatedAt,
          usage: { referencedProductCount: 0 },
        },
        option: null,
        searchReconciliation: created.searchReconciliation,
      };
    });
  }

  patchDefinition(
    actorId: number,
    categoryId: number,
    definitionId: number,
    raw: unknown,
  ) {
    return this.mapped(async () => {
      const input = parseAttributeWrite(raw, 'definition', 'patch');
      return this.boundary.run(
        {
          actorId,
          categoryId,
          definitionId,
          expectedRevision: input.expectedRevision!,
        },
        async (ctx) => {
          const plan = planDefinitionPatch(ctx.definition, input, ctx.usage);
          let job: { jobId: string; status: string } | null = null;
          if (plan.changed) {
            // Revision trigger advances exactly once; never set/reset it here.
            await ctx.tx.categoryAttributeDefinition.update({
              where: { id: definitionId },
              data: plan.next,
            });
            job = await ctx.recordChange({
              reason: input.reason,
              searchMayBeAffected: plan.searchMayBeAffected,
            });
          }
          return result(ctx.tx, definitionId, undefined, job);
        },
      );
    });
  }

  createOption(
    actorId: number,
    categoryId: number,
    definitionId: number,
    raw: unknown,
  ) {
    return this.mapped(async () => {
      const input = parseAttributeWrite(raw, 'option', 'create');
      return this.boundary.run(
        {
          actorId,
          categoryId,
          definitionId,
          expectedRevision: input.expectedRevision!,
        },
        async (ctx) => {
          const plan = planOptionCreate(ctx.definition, input);
          // Boundary locked the parent BEFORE child INSERT: prevents FK KEY SHARE
          // -> FOR UPDATE lock-upgrade deadlocks between concurrent inserts.
          const option = await ctx.tx.categoryAttributeOption.create({
            data: { attributeDefinitionId: definitionId, ...plan.next },
          });
          const job = await ctx.recordChange({
            optionId: option.id,
            searchMayBeAffected: false,
          });
          return result(ctx.tx, definitionId, option.id, job);
        },
      );
    });
  }

  patchOption(
    actorId: number,
    categoryId: number,
    definitionId: number,
    optionId: number,
    raw: unknown,
  ) {
    return this.mapped(async () => {
      const input = parseAttributeWrite(raw, 'option', 'patch');
      return this.boundary.run(
        {
          actorId,
          categoryId,
          definitionId,
          optionId,
          expectedRevision: input.expectedRevision!,
        },
        async (ctx: AttributeTransactionContext) => {
          const plan = planOptionPatch(
            ctx.definition,
            ctx.option!,
            input,
            ctx.usage.optionReferencedProductCount,
          );
          let job: { jobId: string; status: string } | null = null;
          if (plan.changed) {
            await ctx.tx.categoryAttributeOption.update({
              where: { id: optionId },
              data: plan.next,
            });
            job = await ctx.recordChange({
              optionId,
              reason: input.reason,
              searchMayBeAffected: plan.searchMayBeAffected,
            });
          }
          return result(ctx.tx, definitionId, optionId, job);
        },
      );
    });
  }
}
