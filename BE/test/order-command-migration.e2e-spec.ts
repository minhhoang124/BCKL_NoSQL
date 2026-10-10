import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Pool, type PoolClient } from 'pg';

const targetMigration = '20261009090000_order_command_audit_foundation';

// Replay real checked-in migration SQL into a unique schema. No reset, no
// shared-table mutation, no fabricated backfill and no use of the demo schema.
describe('Order command migration with existing business history', () => {
  const schemaName = `order_upgrade_${randomUUID().replaceAll('-', '')}`;
  let pool: Pool;
  let client: PoolClient;
  let schemaCreated = false;
  let migrationWorkspace: string | undefined;
  let before: Record<string, unknown[]>;
  const tables = [
    'users',
    'orders',
    'order_items',
    'order_status_history',
    'payments',
    'stock_movements',
    'product_variants',
  ];

  async function snapshot(): Promise<Record<string, unknown[]>> {
    const result: Record<string, unknown[]> = {};
    for (const table of tables) {
      result[table] = (
        await client.query<{ value: unknown }>(
          `SELECT to_jsonb(t) AS value FROM "${table}" t ORDER BY id`,
        )
      ).rows.map((row) => row.value);
    }
    return result;
  }

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 3000,
      statement_timeout: 15000,
    });
    client = await pool.connect();
    if (!/^order_upgrade_[0-9a-f]{32}$/.test(schemaName))
      throw new Error('Invalid isolated schema');
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;
    // No public fallback: a missing table must fail instead of using shared data.
    await client.query(`SET search_path TO "${schemaName}"`);
    const root = path.resolve('prisma/migrations');
    const migrations = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name < targetMigration)
      .map((entry) => entry.name)
      .sort();
    // Use the real engine: pg.query(wholeFile) would wrap ALTER TYPE ADD VALUE
    // and its subsequent use in one implicit transaction, unlike migrate deploy.
    migrationWorkspace = await mkdtemp(
      path.join(tmpdir(), 'bckl-order-upgrade-'),
    );
    for (const migration of migrations) {
      await cp(
        path.join(root, migration),
        path.join(migrationWorkspace, 'migrations', migration),
        { recursive: true },
      );
    }
    await cp(
      path.join(root, 'migration_lock.toml'),
      path.join(migrationWorkspace, 'migrations', 'migration_lock.toml'),
    );
    const configFile = path.join(migrationWorkspace, 'prisma.config.mjs');
    await writeFile(
      configFile,
      `export default {
        schema: ${JSON.stringify(path.resolve('prisma/schema.prisma'))},
        migrations: { path: ${JSON.stringify(path.join(migrationWorkspace, 'migrations'))} },
        datasource: { url: process.env.DATABASE_URL }
      };\n`,
    );
    const isolatedUrl = new URL(process.env.DATABASE_URL!);
    isolatedUrl.searchParams.set('schema', schemaName);
    await promisify(execFile)(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        configFile,
      ],
      {
        env: { ...process.env, DATABASE_URL: isolatedUrl.href },
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      },
    );
    await client.query(`
      INSERT INTO users (id,email,"passwordHash",role,"updatedAt") VALUES
        (1,'upgrade-buyer@example.test','fixture','USER',now()),
        (2,'upgrade-seller@example.test','fixture','SELLER',now());
      INSERT INTO stores (id,"sellerId",name,status,"updatedAt") VALUES (1,2,'Original Store','ACTIVE',now());
      INSERT INTO categories (id,name,slug,"updatedAt") VALUES (1,'Category','upgrade-category',now());
      INSERT INTO products (id,"storeId","categoryId",name,"updatedAt") VALUES (1,1,1,'Current name',now());
      INSERT INTO product_variants (id,"productId","storeId","skuCode",price,stock,"optionSignature","updatedAt")
        VALUES (1,1,1,'current-sku',12000,3,'default',now());
      INSERT INTO checkouts (id,"buyerId","idempotencyKey","requestHash",status,"completedAt")
        VALUES (1,1,'legacy-checkout-key','legacy-unclassified-hash','COMPLETED',now());
      INSERT INTO orders (id,"orderNumber","checkoutId","buyerId","storeId",status,
        "recipientNameSnapshot","phoneSnapshot","provinceSnapshot","districtSnapshot","wardSnapshot",
        "addressLineSnapshot",subtotal,"shippingFee",total,"cancellationReason","cancelledAt","updatedAt")
        VALUES (1,'LEGACY-ORDER-1',1,1,1,'CANCELLED','Original buyer','0900000000','Original province',NULL,
          'Original ward','Original address',10000,0,10000,'Original unclassified reason',now(),now());
      INSERT INTO order_items (id,"orderId","productId","variantId","storeId","productNameSnapshot",
        "skuSnapshot","optionSnapshot","unitPrice",quantity,"lineTotal")
        VALUES (1,1,1,1,1,'Original product name','original-sku','{"legacy":"unclassified"}',10000,1,10000);
      INSERT INTO payments (id,"orderId",provider,status,amount,"updatedAt") VALUES (1,1,'COD','CANCELLED',10000,now());
      INSERT INTO order_status_history (id,"orderId","fromStatus","toStatus","actorId",reason) VALUES
        (1,1,NULL,'PENDING_CONFIRMATION',1,NULL),
        (2,1,'PENDING_CONFIRMATION','CANCELLED',NULL,'Old audit without actor');
      INSERT INTO stock_movements (id,"variantId","orderItemId",type,"quantityDelta","balanceAfter","idempotencyKey")
        VALUES (1,1,1,'CHECKOUT_DECREMENT',-1,2,'legacy-decrement'),
               (2,1,1,'CANCELLATION_RESTORE',1,3,'legacy-restore');
    `);
    before = await snapshot();
    await client.query(
      await readFile(path.join(root, targetMigration, 'migration.sql'), 'utf8'),
    );
  }, 60000);

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    try {
      if (client) {
        await client.query('ROLLBACK');
        if (schemaCreated) {
          const current = await client.query<{ name: string }>(
            'SELECT current_schema() AS name',
          );
          if (
            current.rows[0]?.name !== schemaName ||
            !/^order_upgrade_[0-9a-f]{32}$/.test(schemaName)
          ) {
            throw new Error('Refusing cleanup outside isolated upgrade schema');
          }
          await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
        }
      }
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      if (client) client.release();
    }
    try {
      if (pool) await pool.end();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (migrationWorkspace) {
        const resolved = path.resolve(migrationWorkspace);
        if (
          !resolved.startsWith(path.resolve(tmpdir()) + path.sep) ||
          !path.basename(resolved).startsWith('bckl-order-upgrade-')
        ) {
          throw new Error(
            'Refusing cleanup outside generated migration workspace',
          );
        }
        await rm(resolved, { recursive: true, force: true });
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        'Order migration fixture cleanup failed',
      );
    }
  });

  it('preserves every old value including unknown option JSON, null actor and stock ledger', async () => {
    const after = await snapshot();
    for (const table of tables) {
      expect(after[table]).toHaveLength(before[table]!.length);
      before[table]!.forEach((row, index) =>
        expect(after[table]![index]).toMatchObject(
          row as Record<string, unknown>,
        ),
      );
    }
    expect(after.orders![0]).toMatchObject({
      cancelledById: null,
      cancelledByType: null,
      cancellationReasonCode: null,
      cancellationReasonText: null,
    });
    for (const row of after.order_status_history!) {
      expect(row).toMatchObject({
        actorType: null,
        commandId: null,
        reasonCode: null,
        reasonText: null,
      });
    }
    expect(
      (await client.query('SELECT count(*)::int AS n FROM order_commands'))
        .rows[0].n,
    ).toBe(0);
  });

  it('keeps old Checkout history inserts compatible during rolling deployment', async () => {
    await client.query(`INSERT INTO order_status_history (id,"orderId","toStatus","actorId")
      VALUES (3,1,'PENDING_CONFIRMATION',1)`);
    expect(
      (
        await client.query(
          'SELECT "actorType", "commandId" FROM order_status_history WHERE id=3',
        )
      ).rows[0],
    ).toEqual({ actorType: null, commandId: null });
    await client.query('DELETE FROM order_status_history WHERE id=3');
  });

  it('uses schema-local deferred triggers and leaves no unfinished claim', async () => {
    await expect(
      client.query(
        `INSERT INTO order_commands
      ("orderId","actorScope","actorType","actorId","idempotencyKey",command,"requestHash","hashVersion")
      VALUES (1,'USER:1','BUYER',1,'upgrade-command-key','cancel',$1,1)`,
        ['a'.repeat(64)],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'order_commands_completed_at_commit_check',
    });
    expect(
      (await client.query('SELECT count(*)::int AS n FROM order_commands'))
        .rows[0].n,
    ).toBe(0);
  });
});
