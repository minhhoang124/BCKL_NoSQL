import type { Pool } from 'pg';
import { normalizedAttributeKey } from './attribute-write-policy.js';

export const ATTRIBUTE_AUDIT_ROW_LIMIT = 20_000;
type Row = { id: number; scopeId: number; label: string };

/** QA-only CLI target. No dotenv fallback and never include credentials in errors. */
export function assertAttributeAuditQaTarget(raw: string | undefined): string {
  try {
    const url = new URL(raw ?? '');
    if (
      url.protocol !== 'postgresql:' ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '5549' ||
      !/^\/bckl_order_resolution_test_[a-z0-9_]{1,40}$/.test(url.pathname) ||
      url.hash ||
      [...url.searchParams].some(
        ([key, value]) => key !== 'schema' || value !== 'public',
      ) ||
      url.searchParams.getAll('schema').length > 1
    )
      throw new Error();
    return url.href;
  } catch {
    throw new Error('ATTRIBUTE_AUDIT_REQUIRES_DEDICATED_LOOPBACK_QA_DATABASE');
  }
}

export function auditAttributeLabels(rows: readonly Row[]) {
  if (rows.length > ATTRIBUTE_AUDIT_ROW_LIMIT)
    throw new Error('ATTRIBUTE_AUDIT_ROW_LIMIT_EXCEEDED');
  const groups = new Map<number, Map<string, number[]>>();
  const invalidIds: number[] = [];
  for (const row of rows) {
    const key = normalizedAttributeKey(row.label);
    if (!key) {
      invalidIds.push(row.id);
      continue;
    }
    let scope = groups.get(row.scopeId);
    if (!scope) {
      scope = new Map();
      groups.set(row.scopeId, scope);
    }
    const ids = scope.get(key) ?? [];
    ids.push(row.id);
    scope.set(key, ids);
  }
  const collisions = [...groups.entries()]
    .flatMap(([scopeId, keys]) =>
      [...keys.values()]
        .filter((ids) => ids.length > 1)
        .map((ids) => ({ scopeId, ids: [...ids].sort((a, b) => a - b) })),
    )
    .sort((a, b) => a.scopeId - b.scopeId || a.ids[0] - b.ids[0]);
  return {
    rowCount: rows.length,
    collisions,
    invalidIds: invalidIds.sort((a, b) => a - b),
  };
}

/** Read-only consistent snapshot, including inactive rows. No DDL or repair. */
export async function readAttributeNormalizationAudit(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const definitions = await client.query<Row>(
      'SELECT id, "categoryId" AS "scopeId", name AS label FROM public.category_attribute_definitions ORDER BY id LIMIT $1',
      [ATTRIBUTE_AUDIT_ROW_LIMIT + 1],
    );
    const options = await client.query<Row>(
      'SELECT id, "attributeDefinitionId" AS "scopeId", value AS label FROM public.category_attribute_options ORDER BY id LIMIT $1',
      [ATTRIBUTE_AUDIT_ROW_LIMIT + 1],
    );
    const definitionAudit = auditAttributeLabels(definitions.rows);
    const optionAudit = auditAttributeLabels(options.rows);
    await client.query('COMMIT');
    return {
      schemaVersion: 1,
      eligibleForNormalizedUniqueness: [definitionAudit, optionAudit].every(
        (result) => !result.collisions.length && !result.invalidIds.length,
      ),
      definitions: definitionAudit,
      options: optionAudit,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
