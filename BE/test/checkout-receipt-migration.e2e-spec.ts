import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

describe('Checkout hash/receipt migration and PostgreSQL protections (e2e)', () => {
  const schema = `checkout_receipt_${randomBytes(8).toString('hex')}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let connected = false;
  let legacySnapshot: Record<string, unknown>[] = [];
  // Compare PostgreSQL's stored timestamp text, not pg's host-timezone Date
  // conversion of timestamp-without-time-zone columns.
  const legacyRead = `SELECT id, "idempotencyKey", "requestHash", status,
    "completedAt"::text AS "completedAt", "createdAt"::text AS "createdAt"
    FROM "checkouts" WHERE id < 99 ORDER BY id`;
  const hash = 'a'.repeat(64);
  const storedReceipt = {
    checkoutId: 100,
    status: 'COMPLETED',
    orders: [
      {
        id: 1,
        orderNumber: 'migration-fixture',
        storeId: 1,
        status: 'PENDING_CONFIRMATION',
        payment: {
          provider: 'COD',
          status: 'UNPAID',
          amount: '1.00',
          currency: 'VND',
        },
        total: '1.00',
      },
    ],
  };

  beforeAll(async () => {
    await client.connect();
    connected = true;
    await client.query('BEGIN');
    // Private schema, rolled back even after a failed assertion. Copy the
    // original columns/defaults only; no production data or inherited FKs.
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(
      'CREATE TABLE "checkouts" (LIKE public."checkouts" INCLUDING DEFAULTS)',
    );
    await client.query(
      'ALTER TABLE "checkouts" DROP COLUMN IF EXISTS "hashVersion", DROP COLUMN IF EXISTS "receiptVersion", DROP COLUMN IF EXISTS "receiptJson"',
    );
    await client.query(`INSERT INTO "checkouts" (id, "buyerId", "idempotencyKey", "requestHash", status, "completedAt")
      VALUES (1, 1, 'legacy-pending', 'unknown-algorithm', 'PENDING', NULL),
             (2, 1, 'legacy-completed', 'legacy-request-hash', 'COMPLETED', '2026-10-01T00:00:00Z'),
             (3, 1, 'legacy-failed', 'legacy-failed-hash', 'FAILED', NULL)`);
    legacySnapshot = (await client.query(legacyRead)).rows;
    const migration = await readFile(
      new URL(
        '../prisma/migrations/20261007100000_checkout_hash_receipt/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await client.query(migration);
    await client.query(
      `INSERT INTO "checkouts" (id, "buyerId", "idempotencyKey", "requestHash", "hashVersion", status)
      VALUES (99, 1, 'new-pending', $1, 1, 'PENDING')`,
      [hash],
    );
    await client.query(
      `INSERT INTO "checkouts" (id, "buyerId", "idempotencyKey", "requestHash", "hashVersion", status, "completedAt", "receiptVersion", "receiptJson")
      VALUES (100, 1, 'new-completed', $1, 1, 'COMPLETED', '2026-10-07T00:00:00Z', 1, $2::jsonb)`,
      [hash, JSON.stringify(storedReceipt)],
    );
  });

  afterAll(async () => {
    if (!connected) return;
    try {
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });

  async function rejectsConstraint(sql: string, params: unknown[] = []) {
    await client.query('SAVEPOINT invalid_write');
    try {
      await expect(client.query(sql, params)).rejects.toMatchObject({
        code: '23514',
      });
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT invalid_write');
      await client.query('RELEASE SAVEPOINT invalid_write');
    }
  }

  it('preserves legacy status/hash/key/time and leaves provenance NULL without guessed backfill', async () => {
    expect((await client.query(legacyRead)).rows).toEqual(legacySnapshot);
    const result = await client.query(
      'SELECT id, "idempotencyKey", "requestHash", status, "hashVersion", "receiptVersion", "receiptJson" FROM "checkouts" WHERE id < 99 ORDER BY id',
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row.status)).toEqual([
      'PENDING',
      'COMPLETED',
      'FAILED',
    ]);
    expect(result.rows.map((row) => row.requestHash)).toEqual([
      'unknown-algorithm',
      'legacy-request-hash',
      'legacy-failed-hash',
    ]);
    expect(result.rows.map((row) => row.idempotencyKey)).toEqual([
      'legacy-pending',
      'legacy-completed',
      'legacy-failed',
    ]);
    for (const row of result.rows)
      expect([row.hashVersion, row.receiptVersion, row.receiptJson]).toEqual([
        null,
        null,
        null,
      ]);
  });

  it('permits new PENDING without a receipt, then atomic completion with receipt', async () => {
    await client.query('SAVEPOINT completion');
    try {
      const ownReceipt = { ...storedReceipt, checkoutId: 99 };
      await client.query(
        `UPDATE "checkouts" SET status = 'COMPLETED', "completedAt" = now(), "receiptVersion" = 1, "receiptJson" = $1::jsonb WHERE id = 99`,
        [JSON.stringify(ownReceipt)],
      );
      const result = await client.query(
        'SELECT status, "receiptJson" FROM "checkouts" WHERE id = 99',
      );
      expect(result.rows[0]).toMatchObject({
        status: 'COMPLETED',
        receiptJson: ownReceipt,
      });
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT completion');
      await client.query('RELEASE SAVEPOINT completion');
    }
  });

  it.each([
    `"hashVersion" = 0`,
    `"hashVersion" = -1`,
    `"requestHash" = 'invalid'`,
    `"receiptVersion" = 1`,
    `"receiptJson" = '{}'::jsonb`,
    `status = 'COMPLETED'`,
    `status = 'COMPLETED', "completedAt" = now(), "receiptVersion" = 1, "receiptJson" = 'null'::jsonb`,
    `status = 'COMPLETED', "completedAt" = now(), "receiptVersion" = 1, "receiptJson" = '[]'::jsonb`,
    `status = 'COMPLETED', "receiptVersion" = 1, "receiptJson" = '{}'::jsonb`,
  ])('rejects invalid v1 write: %s', async (set) => {
    await rejectsConstraint(`UPDATE "checkouts" SET ${set} WHERE id = 99`);
  });

  it.each([
    `"id" = 101`,
    `"idempotencyKey" = 'replacement'`,
    `"buyerId" = 2`,
    `"requestHash" = '${'b'.repeat(64)}'`,
    `"hashVersion" = NULL`,
    `"hashVersion" = 2`,
    `"receiptVersion" = 2`,
    `"receiptVersion" = NULL, "receiptJson" = NULL`,
    `"receiptJson" = '{}'::jsonb`,
    `status = 'PENDING'`,
    `"completedAt" = now()`,
    // now() is constant within this enclosing transaction and would be a
    // no-op against the default createdAt. Force an actual timestamp change.
    `"createdAt" = "createdAt" + interval '1 second'`,
  ])('blocks completed boundary rewrite: %s', async (set) => {
    await rejectsConstraint(`UPDATE "checkouts" SET ${set} WHERE id = 100`);
  });

  it('allows a no-op update without changing the original receipt', async () => {
    await client.query(
      'UPDATE "checkouts" SET "receiptJson" = "receiptJson" WHERE id = 100',
    );
    const result = await client.query(
      'SELECT "receiptJson" FROM "checkouts" WHERE id = 100',
    );
    expect(result.rows[0].receiptJson).toEqual(storedReceipt);
  });
});
