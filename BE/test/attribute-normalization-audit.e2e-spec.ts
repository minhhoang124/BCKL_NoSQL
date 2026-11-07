import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readAttributeNormalizationAudit } from '../src/catalog/attribute-normalization-audit.js';
import { assertOrderResolutionQaTarget } from './helpers/order-resolution-qa-target.js';

const execute = promisify(execFile);

describe('Attribute normalization preflight — real PostgreSQL read-only', () => {
  let pool: Pool;
  let categoryId: number;
  let definitionIds: number[];
  let optionIds: number[];
  let uniquenessInstalled: boolean;

  beforeAll(async () => {
    if (process.env.GITHUB_ACTIONS !== 'true')
      assertOrderResolutionQaTarget(process.env.DATABASE_URL);
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // The preflight must be testable both before and after the later normalized
    // uniqueness migration. Do not drop production constraints to seed legacy
    // duplicates on an already-upgraded QA database.
    const indexes = await pool.query<{ name: string | null }>(
      `SELECT to_regclass('public.attribute_definition_category_normalized_name_key')::text AS name
       UNION ALL SELECT to_regclass('public.attribute_option_definition_normalized_value_key')::text`,
    );
    expect([0, 2]).toContain(indexes.rows.filter((row) => row.name !== null).length);
    uniquenessInstalled = indexes.rows.every((row) => row.name !== null);
    const marker = randomUUID();
    categoryId = (
      await pool.query<{ id: number }>(
        'INSERT INTO categories(name,slug,"updatedAt") VALUES($1,$2,now()) RETURNING id',
        [`QA audit ${marker}`, `qa-audit-${marker}`],
      )
    ).rows[0].id;
    definitionIds = (
      await pool.query<{ id: number }>(
        `INSERT INTO category_attribute_definitions("categoryId",name,slug,"dataType","isActive","updatedAt")
       VALUES($1,'Màu Sắc','mau-a','SINGLE_SELECT',true,now()),
             ($1,$2,'mau-b','SINGLE_SELECT',false,now()) RETURNING id`,
        [categoryId, uniquenessInstalled ? 'Kết nối' : '  MÀU  SẮC  '],
      )
    ).rows.map((row) => row.id);
    optionIds = (
      await pool.query<{ id: number }>(
        `INSERT INTO category_attribute_options("attributeDefinitionId",value,slug,"isActive","updatedAt")
       VALUES($1,'Đen','den-a',true,now()),($1,$2,'den-b',false,now()) RETURNING id`,
        [definitionIds[0], uniquenessInstalled ? 'Trắng' : ' ĐEN '],
      )
    ).rows.map((row) => row.id);
  });

  afterAll(async () => {
    // Only delete this suite's synthetic category; never reset any schema/data.
    if (categoryId)
      await pool.query('DELETE FROM categories WHERE id=$1', [categoryId]);
    await pool?.end();
  });

  async function snapshot() {
    return {
      definitions: (
        await pool.query(
          'SELECT * FROM category_attribute_definitions WHERE "categoryId"=$1 ORDER BY id',
          [categoryId],
        )
      ).rows,
      options: (
        await pool.query(
          'SELECT * FROM category_attribute_options WHERE "attributeDefinitionId"=$1 ORDER BY id',
          [definitionIds[0]],
        )
      ).rows,
    };
  }

  it('audits legacy collisions or enforced uniqueness without changing fixture values', async () => {
    const before = await snapshot();
    const result = await readAttributeNormalizationAudit(pool);
    if (uniquenessInstalled) {
      // Assert that rejected collision fixtures are a real PostgreSQL boundary,
      // not a reason to skip the auditor on post-upgrade databases.
      await expect(
        pool.query(
          `INSERT INTO category_attribute_definitions("categoryId",name,slug,"dataType","updatedAt")
         VALUES($1,'  MÀU  SẮC  ','rejected-duplicate','TEXT',now())`,
          [categoryId],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'attribute_definition_category_normalized_name_key',
      });
      await expect(
        pool.query(
          `INSERT INTO category_attribute_options("attributeDefinitionId",value,slug,"updatedAt")
         VALUES($1,' ĐEN ','rejected-duplicate',now())`,
          [definitionIds[0]],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'attribute_option_definition_normalized_value_key',
      });
      expect(result.eligibleForNormalizedUniqueness).toBe(true);
      expect(result.definitions.collisions).toEqual([]);
      expect(result.options.collisions).toEqual([]);
      expect(result.definitions.rowCount).toBeGreaterThanOrEqual(
        definitionIds.length,
      );
      expect(result.options.rowCount).toBeGreaterThanOrEqual(optionIds.length);
    } else {
      expect(result.eligibleForNormalizedUniqueness).toBe(false);
      expect(result.definitions.collisions).toContainEqual({
        scopeId: categoryId,
        ids: definitionIds,
      });
      expect(result.options.collisions).toContainEqual({
        scopeId: definitionIds[0],
        ids: optionIds,
      });
    }
    expect(await snapshot()).toEqual(before);
    expect(JSON.stringify(result)).not.toContain('Màu Sắc');
  });

  it('repeat audit has identical result, no revision/audit/write side effects', async () => {
    const before = await snapshot();
    const first = await readAttributeNormalizationAudit(pool);
    expect(await readAttributeNormalizationAudit(pool)).toEqual(first);
    expect(await snapshot()).toEqual(before);
  });

  // CLI is deliberately limited to named loopback5549 DBs. CI service targets
  // do not satisfy it; the DB reader above is still exercised on CI's DB.
  it.skipIf(process.env.GITHUB_ACTIONS === 'true')(
    'compiled CLI agrees with the actual preflight and does not report false success',
    async () => {
      const before = await snapshot();
      if (uniquenessInstalled) {
        const result = await execute(
          process.execPath,
          ['scripts/audit-attribute-normalization.mjs'],
          { timeout: 10_000 },
        );
        expect(JSON.parse(result.stdout)).toMatchObject({
          eligibleForNormalizedUniqueness: true,
        });
      } else
        try {
          await execute(
            process.execPath,
            ['scripts/audit-attribute-normalization.mjs'],
            { timeout: 10_000 },
          );
          throw new Error('Expected blocked preflight');
        } catch (caught) {
          const error = caught as Error & { code: number; stdout: string };
          expect(error.code).toBe(2);
          expect(JSON.parse(error.stdout)).toMatchObject({
            eligibleForNormalizedUniqueness: false,
          });
        }
      expect(await snapshot()).toEqual(before);
    },
  );

  it('CLI refuses demo-port target before connection and never echoes credentials', async () => {
    try {
      await execute(
        process.execPath,
        ['scripts/audit-attribute-normalization.mjs'],
        {
          env: {
            ...process.env,
            DATABASE_URL:
              'postgresql://sentinel:do-not-echo@127.0.0.1:5432/demo',
          },
          timeout: 10_000,
        },
      );
      throw new Error('Expected refused target');
    } catch (caught) {
      const error = caught as Error & { code: number; stderr: string };
      expect(error.code).toBe(1);
      expect(error.stderr).toContain('ATTRIBUTE_NORMALIZATION_AUDIT_FAILED');
      expect(error.stderr).not.toMatch(/sentinel|do-not-echo|5432/);
    }
  });
});
