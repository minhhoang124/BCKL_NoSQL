import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type {
  CategoryAttributeDefinition,
  CategoryAttributeOption,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../prisma.service.js';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from '../product/transaction-conflict.js';
import type { SearchReconciliationService } from '../search/search-reconciliation.service.js';

export type AttributeTransactionScope = Readonly<{
  actorId: number;
  categoryId: number;
  definitionId: number;
  expectedRevision: number;
  optionId?: number;
}>;

export type AttributeCreateScope = Readonly<{
  actorId: number;
  categoryId: number;
}>;

type DefinitionMetadata = Pick<
  CategoryAttributeDefinition,
  | 'name'
  | 'slug'
  | 'dataType'
  | 'isRequired'
  | 'isFilterable'
  | 'allowsCustom'
  | 'sortOrder'
  | 'isActive'
>;

export type AttributeCreatePlan = Readonly<{
  values: Readonly<DefinitionMetadata>;
  reason?: string;
  // Internal policy result computed against this transaction's canonical count.
  searchMayBeAffected: boolean;
}>;

export type AttributeCreateContext = Readonly<{
  tx: Prisma.TransactionClient;
  categoryProductCount: number;
}>;

export type AttributeChange = Readonly<{
  optionId?: number;
  reason?: string;
  // Internal planner decision, NEVER a field accepted directly from HTTP.
  searchMayBeAffected: boolean;
}>;

export type AttributeTransactionContext = Readonly<{
  tx: Prisma.TransactionClient;
  definition: Readonly<CategoryAttributeDefinition>;
  option: Readonly<CategoryAttributeOption> | null;
  usage: Readonly<{
    referencedProductCount: number;
    optionReferencedProductCount: number;
    optionCount: number;
    activeOptionCount: number;
    categoryProductCount: number;
  }>;
  recordChange(change: AttributeChange): Promise<{
    jobId: string;
    status: string;
  } | null>;
}>;

const maxInt = 2147483647;
const definitionMetadata = (row: CategoryAttributeDefinition) => ({
  name: row.name,
  slug: row.slug,
  dataType: row.dataType,
  isRequired: row.isRequired,
  isFilterable: row.isFilterable,
  allowsCustom: row.allowsCustom,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
});
const optionMetadata = (row: CategoryAttributeOption) => ({
  value: row.value,
  slug: row.slug,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
});
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

function auditReason(input: string | undefined): string | null {
  if (input === undefined) return null;
  if (typeof input !== 'string') throw new Error('Invalid audit reason');
  const reason = input.normalize('NFC').trim();
  if (
    [...reason].length < 10 ||
    [...reason].length > 500 ||
    [...reason].some((character) => {
      const code = character.codePointAt(0)!;
      return (
        (code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159)
      );
    })
  )
    throw new Error('Invalid audit reason');
  return reason;
}

function snapshotCreateScope(
  input: AttributeCreateScope,
): AttributeCreateScope {
  const scope = { actorId: input.actorId, categoryId: input.categoryId };
  if (
    Object.values(scope).some(
      (value) => !Number.isInteger(value) || value < 1 || value > maxInt,
    )
  )
    throw new BadRequestException('Invalid internal attribute create scope');
  return Object.freeze(scope);
}

const mutationSignature = (
  definition: CategoryAttributeDefinition,
  option: CategoryAttributeOption | null,
  optionCount: number,
) =>
  JSON.stringify([
    definitionMetadata(definition),
    definition.revision,
    definition.updatedAt.getTime(),
    option
      ? [option.id, optionMetadata(option), option.updatedAt.getTime()]
      : null,
    optionCount,
  ]);

/** All future configuration/value/category/submit writers must participate. */
export async function fenceAttributeCategory(
  tx: Prisma.TransactionClient,
  categoryId: number,
): Promise<void> {
  if (!Number.isInteger(categoryId) || categoryId < 1 || categoryId > maxInt)
    throw new Error('Invalid category fence identity');
  const rows = await tx.$queryRaw<Array<{ id: number }>>`
    UPDATE categories SET "updatedAt"="updatedAt" WHERE id=${categoryId} RETURNING id`;
  if (!rows.length) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND' });
}

function snapshotScope(
  input: AttributeTransactionScope,
): AttributeTransactionScope {
  const scope = {
    actorId: input.actorId,
    categoryId: input.categoryId,
    definitionId: input.definitionId,
    expectedRevision: input.expectedRevision,
    ...(input.optionId === undefined ? {} : { optionId: input.optionId }),
  };
  if (
    Object.values(scope).some(
      (value) => !Number.isInteger(value) || value < 1 || value > maxInt,
    )
  ) {
    throw new BadRequestException(
      'Invalid internal attribute transaction scope',
    );
  }
  return Object.freeze(scope);
}

/** Only classified serialization/deadlock failures justify replaying the whole transaction. */
export function isAttributeTransactionConflict(error: unknown): boolean {
  if (isTransactionConflict(error)) return true;
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010'
  )
    return false;
  const adapter = error.meta?.driverAdapterError;
  const cause =
    adapter && typeof adapter === 'object' && 'cause' in adapter
      ? adapter.cause
      : null;
  const code =
    error.meta?.code ??
    (cause && typeof cause === 'object' && 'originalCode' in cause
      ? cause.originalCode
      : '');
  return code === '40001' || code === '40P01';
}

/** A known database wait/cancellation is unavailable, NOT permission to replay
 * the mutation. Match structured driver metadata only, never error messages. */
export function isAttributeDatabaseTimeout(error: unknown): boolean {
  let code: unknown;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code !== 'P2010') return false;
    const adapter = error.meta?.driverAdapterError;
    const cause =
      adapter && typeof adapter === 'object' && 'cause' in adapter
        ? adapter.cause
        : null;
    code =
      error.meta?.code ??
      (cause && typeof cause === 'object' && 'originalCode' in cause
        ? cause.originalCode
        : undefined);
  } else if (error instanceof Error && error.name === 'DriverAdapterError') {
    const cause = error.cause;
    code =
      cause && typeof cause === 'object' && 'originalCode' in cause
        ? cause.originalCode
        : undefined;
  }
  return code === '55P03' || code === '57014';
}

/**
 * Internal boundary composed by AdminAttributeWriteService in the runtime
 * integration candidate. This is not the policy/parser: callers must run the
 * canonical planner inside its callback. Product value/category/submit writers
 * share the category fence; a future writer must participate in the same order.
 * Foundations #83/#87/#91/#92 are official; API activation is reviewed separately.
 * Work must contain ONLY transaction-local DB operations: it may be retried.
 */
export class AttributeTransactionBoundary {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliation: Pick<
      SearchReconciliationService,
      'enqueueCategory'
    >,
  ) {}

  /**
   * Internal creation path: the planner runs AFTER actor/category fencing and
   * canonical Product count. Not an HTTP parser or a normalized-name constraint.
   * Only this method owns the INSERT/audit/job; no callback runs after them.
   */
  async createDefinition(
    input: AttributeCreateScope,
    prepare: (context: AttributeCreateContext) => Promise<AttributeCreatePlan>,
  ) {
    const scope = snapshotCreateScope(input);
    const correlationId = randomUUID();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL statement_timeout='2000ms'");
            await tx.$executeRawUnsafe("SET LOCAL lock_timeout='1000ms'");
            const [actor] = await tx.$queryRaw<
              Array<{ role: Role; isActive: boolean }>
            >`
            SELECT role, "isActive" FROM users WHERE id=${scope.actorId} FOR SHARE`;
            if (!actor?.isActive) throw new UnauthorizedException();
            if (actor.role !== Role.ADMIN) throw new ForbiddenException();
            await fenceAttributeCategory(tx, scope.categoryId);
            const categoryProductCount = await tx.product.count({
              where: { categoryId: scope.categoryId },
            });
            const plan = await prepare(
              Object.freeze({ tx, categoryProductCount }),
            );
            // Allowlist/copy primitives before any more await. Caller must still
            // run the full approved policy: these checks only guard internal shape.
            const values = Object.freeze({
              name: plan.values.name,
              slug: plan.values.slug,
              dataType: plan.values.dataType,
              isRequired: plan.values.isRequired,
              isFilterable: plan.values.isFilterable,
              allowsCustom: plan.values.allowsCustom,
              sortOrder: plan.values.sortOrder,
              isActive: plan.values.isActive,
            });
            const effect = plan.searchMayBeAffected;
            const reason = auditReason(plan.reason);
            if (
              typeof effect !== 'boolean' ||
              typeof values.name !== 'string' ||
              typeof values.slug !== 'string' ||
              !['TEXT', 'NUMBER', 'BOOLEAN', 'SINGLE_SELECT'].includes(
                values.dataType,
              ) ||
              [
                values.isRequired,
                values.isFilterable,
                values.allowsCustom,
                values.isActive,
              ].some((value) => typeof value !== 'boolean') ||
              !Number.isInteger(values.sortOrder) ||
              values.sortOrder < 0 ||
              values.sortOrder > maxInt
            )
              throw new Error('Invalid internal attribute creation plan');
            const definition = await tx.categoryAttributeDefinition.create({
              data: { categoryId: scope.categoryId, ...values },
            });
            if (definition.revision !== 1)
              throw new Error('New definition must start at revision one');
            await tx.categoryAttributeAudit.create({
              data: {
                actorId: scope.actorId,
                categoryId: scope.categoryId,
                definitionId: definition.id,
                optionId: null,
                entityType: 'DEFINITION',
                command: 'CREATE_DEFINITION',
                revision: 1,
                reason,
                correlationId,
                oldValues: Prisma.DbNull,
                newValues: definitionMetadata(definition),
              },
            });
            const job = effect
              ? await this.reconciliation.enqueueCategory(tx, scope.categoryId)
              : null;
            return {
              definition,
              searchReconciliation: job
                ? { jobId: job.id.toString(), status: job.status }
                : null,
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 2000,
            timeout: 5000,
          },
        );
      } catch (error) {
        if (isAttributeDatabaseTimeout(error))
          throw new ServiceUnavailableException(
            'Attribute database busy; retry later',
          );
        if (!isAttributeTransactionConflict(error)) throw error;
        if (attempt === 2)
          throw new ServiceUnavailableException(
            'Attribute transaction contention; retry later',
          );
        await waitForTransactionRetry(attempt);
      }
    }
    throw new Error('Unreachable attribute create retry state');
  }

  async run<T>(
    input: AttributeTransactionScope,
    work: (context: AttributeTransactionContext) => Promise<T>,
  ): Promise<T> {
    const scope = snapshotScope(input);
    const correlationId = randomUUID();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL statement_timeout='2000ms'");
            await tx.$executeRawUnsafe("SET LOCAL lock_timeout='1000ms'");
            const [actor] = await tx.$queryRaw<
              Array<{ role: Role; isActive: boolean }>
            >`
            SELECT role, "isActive" FROM users WHERE id=${scope.actorId} FOR SHARE`;
            if (!actor?.isActive) throw new UnauthorizedException();
            if (actor.role !== Role.ADMIN) throw new ForbiddenException();
            // A real MVCC write invalidates overlapping SERIALIZABLE snapshots.
            // A row lock alone would not refresh a snapshot after waiting.
            // Do NOT UPDATE the primary key: NO KEY UPDATE stays compatible with FKs.
            await fenceAttributeCategory(tx, scope.categoryId);
            const locked = await tx.$queryRaw<Array<{ id: number }>>`
            SELECT id FROM category_attribute_definitions
            WHERE id=${scope.definitionId} AND "categoryId"=${scope.categoryId} FOR UPDATE`;
            if (!locked.length)
              throw new NotFoundException({ code: 'ATTRIBUTE_NOT_FOUND' });
            const definition =
              await tx.categoryAttributeDefinition.findUniqueOrThrow({
                where: { id: scope.definitionId },
              });
            if (definition.revision !== scope.expectedRevision) {
              throw new ConflictException({
                code: 'ATTRIBUTE_REVISION_CONFLICT',
              });
            }
            const option =
              scope.optionId === undefined
                ? null
                : await tx.categoryAttributeOption.findFirst({
                    where: {
                      id: scope.optionId,
                      attributeDefinitionId: definition.id,
                    },
                  });
            if (scope.optionId !== undefined && !option)
              throw new NotFoundException({
                code: 'ATTRIBUTE_OPTION_NOT_FOUND',
              });
            const optionCount = await tx.categoryAttributeOption.count({
              where: { attributeDefinitionId: definition.id },
            });
            const usage = Object.freeze({
              referencedProductCount: await tx.productAttributeValue.count({
                where: { attributeDefinitionId: definition.id },
              }),
              optionReferencedProductCount: option
                ? await tx.productAttributeValue.count({
                    where: { optionId: option.id },
                  })
                : 0,
              optionCount,
              activeOptionCount: await tx.categoryAttributeOption.count({
                where: { attributeDefinitionId: definition.id, isActive: true },
              }),
              categoryProductCount: await tx.product.count({
                where: { categoryId: scope.categoryId },
              }),
            });
            const beforeMetadata = definitionMetadata(definition);
            const beforeUpdatedAt = definition.updatedAt.getTime();
            const beforeOptionUpdatedAt = option?.updatedAt.getTime();
            let active = true;
            let recorded = false;
            let recordStarted = false;
            let recordedSignature: string | undefined;
            let recordedOptionId: number | undefined;
            const context: AttributeTransactionContext = Object.freeze({
              tx,
              definition: Object.freeze({ ...definition }),
              option: option && Object.freeze({ ...option }),
              usage,
              recordChange: async (change: AttributeChange) => {
                if (!active || recordStarted)
                  throw new Error(
                    'Attribute change must be recorded once in its active transaction',
                  );
                recordStarted = true;
                const searchMayBeAffected = change.searchMayBeAffected;
                const reasonInput = change.reason;
                if (typeof searchMayBeAffected !== 'boolean')
                  throw new Error('Missing internal Search effect decision');
                const targetOptionId = change.optionId;
                if (
                  targetOptionId !== undefined &&
                  (!Number.isInteger(targetOptionId) ||
                    targetOptionId < 1 ||
                    targetOptionId > maxInt)
                )
                  throw new Error('Invalid option audit target');
                if (
                  scope.optionId !== undefined &&
                  targetOptionId !== scope.optionId
                )
                  throw new Error('Option audit target changed');
                const current =
                  await tx.categoryAttributeDefinition.findUniqueOrThrow({
                    where: { id: definition.id },
                  });
                if (current.revision !== definition.revision + 1)
                  throw new Error(
                    'Recorded mutation must advance exactly one revision',
                  );
                const currentOption =
                  targetOptionId === undefined
                    ? null
                    : await tx.categoryAttributeOption.findFirst({
                        where: {
                          id: targetOptionId,
                          attributeDefinitionId: definition.id,
                        },
                      });
                if (targetOptionId !== undefined && !currentOption)
                  throw new Error('Option audit target missing');
                const currentOptionCount =
                  await tx.categoryAttributeOption.count({
                    where: { attributeDefinitionId: definition.id },
                  });
                if (
                  currentOption &&
                  !option &&
                  currentOptionCount !== optionCount + 1
                ) {
                  throw new Error(
                    'Option creation audit did not create exactly one option',
                  );
                }
                if (
                  (!currentOption || option) &&
                  currentOptionCount !== optionCount
                )
                  throw new Error('Attribute operation changed option set');
                if (
                  currentOption &&
                  !equal(beforeMetadata, definitionMetadata(current))
                )
                  throw new Error(
                    'Option operation also changed definition metadata',
                  );
                const oldValues = currentOption
                  ? option
                    ? optionMetadata(option)
                    : null
                  : beforeMetadata;
                const newValues = currentOption
                  ? optionMetadata(currentOption)
                  : definitionMetadata(current);
                if (equal(oldValues, newValues))
                  throw new Error('No-op must not mint an audit or revision');
                const reason = auditReason(reasonInput);
                await tx.categoryAttributeAudit.create({
                  data: {
                    actorId: scope.actorId,
                    categoryId: scope.categoryId,
                    definitionId: definition.id,
                    optionId: targetOptionId ?? null,
                    entityType: currentOption ? 'OPTION' : 'DEFINITION',
                    command: currentOption
                      ? option
                        ? 'UPDATE_OPTION'
                        : 'CREATE_OPTION'
                      : 'UPDATE_DEFINITION',
                    revision: current.revision,
                    reason,
                    correlationId,
                    oldValues: oldValues ?? Prisma.DbNull,
                    newValues,
                  },
                });
                const job = searchMayBeAffected
                  ? await this.reconciliation.enqueueCategory(
                      tx,
                      scope.categoryId,
                    )
                  : null;
                recordedOptionId = targetOptionId;
                recordedSignature = mutationSignature(
                  current,
                  currentOption,
                  currentOptionCount,
                );
                recorded = true;
                return job
                  ? { jobId: job.id.toString(), status: job.status }
                  : null;
              },
            });
            try {
              const result = await work(context);
              const final =
                await tx.categoryAttributeDefinition.findUniqueOrThrow({
                  where: { id: definition.id },
                });
              const changed = final.revision !== definition.revision;
              const finalOptionCount = await tx.categoryAttributeOption.count({
                where: { attributeDefinitionId: definition.id },
              });
              if (
                recordStarted !== recorded ||
                changed !== recorded ||
                (changed && final.revision !== definition.revision + 1)
              )
                throw new Error('Attribute mutation/audit mismatch');
              if (
                !changed &&
                (!equal(beforeMetadata, definitionMetadata(final)) ||
                  final.updatedAt.getTime() !== beforeUpdatedAt ||
                  finalOptionCount !== optionCount)
              )
                throw new Error('No-op changed metadata');
              if (!changed && option) {
                const finalOption =
                  await tx.categoryAttributeOption.findUniqueOrThrow({
                    where: { id: option.id },
                  });
                if (
                  !equal(optionMetadata(option), optionMetadata(finalOption)) ||
                  finalOption.updatedAt.getTime() !== beforeOptionUpdatedAt
                )
                  throw new Error('No-op changed option metadata');
              }
              if (recorded) {
                const finalRecordedOption =
                  recordedOptionId === undefined
                    ? null
                    : await tx.categoryAttributeOption.findFirst({
                        where: {
                          id: recordedOptionId,
                          attributeDefinitionId: definition.id,
                        },
                      });
                if (
                  mutationSignature(
                    final,
                    finalRecordedOption,
                    finalOptionCount,
                  ) !== recordedSignature
                )
                  throw new Error('Attribute state changed after audit');
              }
              return result;
            } finally {
              active = false;
            }
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 2000,
            timeout: 5000,
          },
        );
      } catch (error) {
        if (isAttributeDatabaseTimeout(error))
          throw new ServiceUnavailableException(
            'Attribute database busy; retry later',
          );
        if (!isAttributeTransactionConflict(error)) throw error;
        if (attempt === 2)
          throw new ServiceUnavailableException(
            'Attribute transaction contention; retry later',
          );
        await waitForTransactionRetry(attempt);
      }
    }
    throw new Error('Unreachable attribute retry state');
  }
}
