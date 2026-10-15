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

const migrationName = '20261010170000_order_completion_jobs';

// Real upgrade + PostgreSQL invariants. Not acceptance evidence for shipping API.
describe('Completion jobs migration — upgrade preserves historical business data', () => {
  const schema = `completion_upgrade_${randomUUID().replaceAll('-', '')}`;
  let pool: Pool;
  let client: PoolClient;
  let workspace: string | undefined;
  let schemaCreated = false;
  let before: Record<string, unknown[]>;
  const tables = [
    'orders',
    'order_items',
    'payments',
    'order_status_history',
    'order_commands',
    'product_variants',
    'stock_movements',
    'checkouts',
  ];

  async function snapshot() {
    const data: Record<string, unknown[]> = {};
    for (const table of tables) {
      data[table] = (
        await client.query<{ value: unknown }>(
          `SELECT to_jsonb(t) AS value FROM "${table}" t ORDER BY id`,
        )
      ).rows.map((row) => row.value);
    }
    return data;
  }

  async function rejectsSql(sql: string, params: unknown[], error: object) {
    await client.query('SAVEPOINT expected_failure');
    await expect(client.query(sql, params)).rejects.toMatchObject(error);
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
  }

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 3000,
      statement_timeout: 15000,
    });
    client = await pool.connect();
    if (!/^completion_upgrade_[0-9a-f]{32}$/.test(schema))
      throw new Error('Unsafe schema');
    await client.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await client.query(`SET search_path TO "${schema}"`);
    const root = path.resolve('prisma/migrations');
    workspace = await mkdtemp(path.join(tmpdir(), 'bckl-completion-upgrade-'));
    for (const name of (await readdir(root)).filter(
      (name) => name < migrationName,
    )) {
      if (name === 'migration_lock.toml') continue;
      await cp(
        path.join(root, name),
        path.join(workspace, 'migrations', name),
        { recursive: true },
      );
    }
    await cp(
      path.join(root, 'migration_lock.toml'),
      path.join(workspace, 'migrations', 'migration_lock.toml'),
    );
    const configFile = path.join(workspace, 'prisma.config.mjs');
    await writeFile(
      configFile,
      `export default {
      schema: ${JSON.stringify(path.resolve('prisma/schema.prisma'))},
      migrations: {path: ${JSON.stringify(path.join(workspace, 'migrations'))}},
      datasource: {url: process.env.DATABASE_URL}
    };\n`,
    );
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('schema', schema);
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
        env: { ...process.env, DATABASE_URL: url.href },
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      },
    );
    await client.query(`
      INSERT INTO users (id,email,"passwordHash",role,"updatedAt") VALUES
        (1,'delivery-buyer@example.test','fixture','USER',now()),
        (2,'delivery-seller@example.test','fixture','SELLER',now()),
        (3,'delivery-admin@example.test','fixture','ADMIN',now());
      INSERT INTO stores (id,"sellerId",name,status,"updatedAt") VALUES (1,2,'Original Store','ACTIVE',now());
      INSERT INTO categories (id,name,slug,"updatedAt") VALUES (1,'Category','delivery-category',now());
      INSERT INTO products (id,"storeId","categoryId",name,"updatedAt") VALUES (1,1,1,'Product',now());
      INSERT INTO product_variants (id,"productId","storeId","skuCode",price,stock,"optionSignature","updatedAt")
        VALUES (1,1,1,'delivery-sku',10000,8,'default',now());
      INSERT INTO checkouts (id,"buyerId","idempotencyKey","requestHash",status) VALUES
        (1,1,'delivery-checkout-1','legacy-hash','COMPLETED'),
        (2,1,'delivery-checkout-2','legacy-hash','COMPLETED');
      INSERT INTO orders (id,"orderNumber","checkoutId","buyerId","storeId",status,
        "recipientNameSnapshot","phoneSnapshot","provinceSnapshot","wardSnapshot","addressLineSnapshot",
        subtotal,"shippingFee",total,"updatedAt") VALUES
        (1,'DELIVERY-1',1,1,1,'READY_TO_SHIP','Snapshot name','0900000000','Province','Ward','Address',10000,0,10000,now()),
        (2,'LEGACY-SHIPPING',2,1,1,'SHIPPING','Legacy name','0900000001','Province','Ward','Address',10000,0,10000,now());
      INSERT INTO order_items (id,"orderId","productId","variantId","storeId","productNameSnapshot",
        "skuSnapshot","optionSnapshot","unitPrice",quantity,"lineTotal") VALUES
        (1,2,1,1,1,'Original name','Original sku','{"legacy":true}',10000,1,10000);
      INSERT INTO payments (id,"orderId",provider,status,amount,"updatedAt") VALUES
        (1,1,'COD','UNPAID',10000,now()), (2,2,'COD','UNPAID',10000,now());
      INSERT INTO order_commands (id,"orderId","actorScope","actorType","actorId","idempotencyKey",command,
        "requestHash","hashVersion",status,"responseStatus","resultSnapshot","createdAt","completedAt")
        VALUES (1,2,'USER:3','ADMIN',3,'existing-shipment-key','ship',repeat('a',64),1,'SUCCEEDED',200,
          '{"status":"SHIPPING"}','2026-10-01','2026-10-01');
      INSERT INTO order_status_history (id,"orderId","commandId","actorId","actorType","fromStatus","toStatus",
        "deliveryAttempt","trackingReference") VALUES (1,2,1,3,'ADMIN','READY_TO_SHIP','SHIPPING',4,'LEGACY-WAYBILL');
      INSERT INTO stock_movements (id,"variantId","orderItemId",type,"quantityDelta","balanceAfter","idempotencyKey")
        VALUES (1,1,1,'CHECKOUT_DECREMENT',-1,8,'original-decrement');
    `);
    await client.query(`UPDATE orders SET status='DELIVERED',"deliveredAt"=now()-interval '4 days' WHERE id=1;
      UPDATE payments SET status='PAID',"paidAt"=now()-interval '4 days' WHERE id=1;`);
    before = await snapshot();
    await client.query(
      await readFile(path.join(root, migrationName, 'migration.sql'), 'utf8'),
    );
  }, 60000);

  beforeEach(async () => {
    await client.query('BEGIN');
  });
  afterEach(async () => {
    await client.query('ROLLBACK');
  });
  afterAll(async () => {
    const errors: unknown[] = [];
    try {
      if (client) {
        await client.query('ROLLBACK');
        if (schemaCreated) {
          const current = (
            await client.query('SELECT current_schema() AS name')
          ).rows[0]?.name;
          if (
            current !== schema ||
            !/^completion_upgrade_[0-9a-f]{32}$/.test(schema)
          )
            throw new Error('Unsafe cleanup');
          await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
      }
    } catch (error) {
      errors.push(error);
    } finally {
      if (client) client.release();
    }
    try {
      if (pool) await pool.end();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (workspace) {
        const resolved = path.resolve(workspace);
        if (
          !resolved.startsWith(path.resolve(tmpdir()) + path.sep) ||
          !path.basename(resolved).startsWith('bckl-completion-upgrade-')
        )
          throw new Error('Unsafe workspace cleanup');
        await rm(resolved, { recursive: true, force: true });
      }
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, 'Completion fixture cleanup failed');
  });

  it('preserves Orders/items/payment/receipts/stock; no automatic completion or invented jobs in migration', async () => {
    expect(await snapshot()).toEqual(before);
    expect(
      (await client.query('SELECT count(*)::int n FROM order_completion_jobs'))
        .rows[0].n,
    ).toBe(0);
  });
  const insert = `INSERT INTO order_completion_jobs ("orderId","deliveredAt","dueAt","updatedAt") VALUES (1,'2026-10-01','2026-10-04',now())`;
  it('one job per Order; distinct from existing immutable command receipts', async () => {
    await client.query(insert);
    await rejectsSql(insert, [], { code: '23505' });
    expect(
      (await client.query('SELECT count(*)::int n FROM order_commands')).rows[0]
        .n,
    ).toBe(1);
  });
  it.each([
    "status='BOGUS'",
    "status='FAILED'",
    "status='RUNNING'",
    '"attemptCount"=7',
    '"attemptCount"=-1',
    '"ruleVersion"=2',
    '"dueAt"=\'2026-09-01\'',
  ])('enforces job state/policy %s', async (set) => {
    await client.query(insert);
    await rejectsSql(
      'UPDATE order_completion_jobs SET ' + set + ' WHERE "orderId"=1',
      [],
      { code: '23514' },
    );
  });
  it('keeps referential integrity and valid lease/failure states', async () => {
    await client.query(insert);
    await rejectsSql('UPDATE order_completion_jobs SET "orderId"=999', [], {
      code: '23503',
    });
    await client.query(
      `UPDATE order_completion_jobs SET status='RUNNING',"attemptCount"=1,"leaseToken"='00000000-0000-0000-0000-000000000001',"leaseExpiresAt"=now()+interval '2 minutes' WHERE "orderId"=1`,
    );
    await client.query(
      `UPDATE order_completion_jobs SET status='FAILED',"leaseToken"=NULL,"leaseExpiresAt"=NULL,"completedAt"=now() WHERE "orderId"=1`,
    );
    expect(
      (await client.query('SELECT status FROM order_completion_jobs')).rows[0]
        .status,
    ).toBe('FAILED');
  });
});
