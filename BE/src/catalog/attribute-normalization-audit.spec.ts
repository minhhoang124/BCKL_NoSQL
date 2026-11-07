import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  ATTRIBUTE_AUDIT_ROW_LIMIT,
  assertAttributeAuditQaTarget,
  auditAttributeLabels,
  readAttributeNormalizationAudit,
} from './attribute-normalization-audit.js';

describe('Attribute normalized uniqueness preflight — read-only', () => {
  it.each([
    undefined,
    '',
    'postgresql://secret:password@127.0.0.1:5432/demo',
    'postgresql://user:password@remote:5549/bckl_order_resolution_test_x',
    'postgresql://user:password@localhost:5549/demo',
    'postgresql://user:password@localhost:5549/bckl_order_resolution_test_x?options=-csearch_path=other',
    'postgresql://user:password@localhost:5549/bckl_order_resolution_test_x?schema=private',
    'postgresql://user:password@localhost:5549/bckl_order_resolution_test_x?schema=public&schema=public',
    'postgresql://user:password@localhost:5549/bckl_order_resolution_test_x#secret',
  ])('refuses unsafe/missing target without echoing credentials', (url) => {
    expect(() => assertAttributeAuditQaTarget(url)).toThrow(
      'ATTRIBUTE_AUDIT_REQUIRES_DEDICATED_LOOPBACK_QA_DATABASE',
    );
    try {
      assertAttributeAuditQaTarget(url);
    } catch (error) {
      expect(String(error)).not.toMatch(/secret|password|search_path/);
    }
  });
  it.each(['localhost', '127.0.0.1'])(
    'accepts only named loopback QA target %s',
    (host) => {
      const url = `postgresql://qa:qa@${host}:5549/bckl_order_resolution_test_attributes?schema=public`;
      expect(assertAttributeAuditQaTarget(url)).toBe(url);
    },
  );
  it('finds NFC/case/whitespace duplicates, even across different slugs/inactive rows', () => {
    const rows = [
      { id: 3, scopeId: 1, label: ' MA\u0300U\tSẮC ' },
      { id: 1, scopeId: 1, label: 'màu sắc' },
    ];
    expect(auditAttributeLabels(rows)).toEqual({
      rowCount: 2,
      collisions: [{ scopeId: 1, ids: [1, 3] }],
      invalidIds: [],
    });
    expect(rows[0].id).toBe(3);
  });
  it('does not merge scopes or remove Vietnamese accents', () => {
    expect(
      auditAttributeLabels([
        { id: 1, scopeId: 1, label: 'Màu' },
        { id: 2, scopeId: 2, label: 'MÀU' },
        { id: 3, scopeId: 1, label: 'Mau' },
      ]).collisions,
    ).toEqual([]);
  });
  it('reports invalid empty normalized keys and stable ordered IDs without raw labels', () => {
    const report = auditAttributeLabels([
      { id: 5, scopeId: 1, label: '\t ' },
      { id: 2, scopeId: 1, label: '' },
    ]);
    expect(report.invalidIds).toEqual([2, 5]);
    expect(JSON.stringify(report)).not.toContain('label');
  });
  it('refuses truncated result instead of saying the database is clean', () => {
    const rows = Array.from(
      { length: ATTRIBUTE_AUDIT_ROW_LIMIT + 1 },
      (_, id) => ({ id, scopeId: 1, label: 'Label' }),
    );
    expect(() => auditAttributeLabels(rows)).toThrow(
      'ATTRIBUTE_AUDIT_ROW_LIMIT_EXCEEDED',
    );
  });
  function connection(options: { fail?: boolean; duplicate?: boolean } = {}) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.category_attribute_definitions')) {
        if (options.fail) throw new Error('injected read failure');
        return {
          rows: [
            { id: 1, scopeId: 1, label: 'Tên' },
            ...(options.duplicate
              ? [{ id: 2, scopeId: 1, label: ' TÊN ' }]
              : []),
          ],
        };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
    } as unknown as Pool;
    return { pool, query, release };
  }
  it('uses one repeatable/read-only snapshot, bounded queries and releases client', async () => {
    const { pool, query, release } = connection();
    expect(
      (await readAttributeNormalizationAudit(pool))
        .eligibleForNormalizedUniqueness,
    ).toBe(true);
    expect(query.mock.calls[0][0]).toBe(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(
      query.mock.calls.some(([sql]) =>
        /\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/u.test(sql),
      ),
    ).toBe(false);
    expect(query.mock.calls[2][0]).not.toContain('isActive');
    expect(release).toHaveBeenCalledOnce();
  });
  it('reports collisions rather than mutating or throwing away them', async () => {
    const { pool } = connection({ duplicate: true });
    expect(await readAttributeNormalizationAudit(pool)).toMatchObject({
      eligibleForNormalizedUniqueness: false,
      definitions: { collisions: [{ scopeId: 1, ids: [1, 2] }] },
    });
  });
  it('rolls back and releases on read failure; never returns clean report', async () => {
    const { pool, query, release } = connection({ fail: true });
    await expect(readAttributeNormalizationAudit(pool)).rejects.toThrow(
      'injected read failure',
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
