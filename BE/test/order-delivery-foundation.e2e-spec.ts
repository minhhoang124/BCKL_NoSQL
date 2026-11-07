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

const migrationName = '20261010100000_order_delivery_attempt_foundation';

// Real upgrade + PostgreSQL invariants. Not acceptance evidence for shipping API.
describe('Delivery identity foundation and legacy upgrade', () => {
  const schema = `delivery_upgrade_${randomUUID().replaceAll('-', '')}`;
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

  async function addAttempt(
    n: number,
    connection: PoolClient = client,
    orderId = 1,
  ) {
    await connection.query(
      `INSERT INTO delivery_attempts ("orderId","deliveryAttempt","trackingReference") VALUES ($1,$2,$3)`,
      [orderId, n, 'SAME-WAYBILL'],
    );
    await connection.query(
      `UPDATE orders SET "currentDeliveryAttempt"=$2,"retryCount"=$2-1 WHERE id=$1`,
      [orderId, n],
    );
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
    if (!/^delivery_upgrade_[0-9a-f]{32}$/.test(schema))
      throw new Error('Unsafe schema');
    await client.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await client.query(`SET search_path TO "${schema}"`);
    const root = path.resolve('prisma/migrations');
    workspace = await mkdtemp(path.join(tmpdir(), 'bckl-delivery-upgrade-'));
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
            !/^delivery_upgrade_[0-9a-f]{32}$/.test(schema)
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
          !path.basename(resolved).startsWith('bckl-delivery-upgrade-')
        )
          throw new Error('Unsafe workspace cleanup');
        await rm(resolved, { recursive: true, force: true });
      }
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, 'Delivery fixture cleanup failed');
  });

  it('preserves all legacy business data and does not infer attempts from history', async () => {
    const after = await snapshot();
    for (const table of tables) {
      expect(after[table]).toHaveLength(before[table]!.length);
      before[table]!.forEach((row, index) =>
        expect(after[table]![index]).toMatchObject(row as object),
      );
    }
    for (const row of after.orders!)
      expect(row).toMatchObject({
        currentDeliveryAttempt: null,
        retryCount: null,
      });
    expect(
      (await client.query('SELECT count(*)::int AS n FROM delivery_attempts'))
        .rows[0].n,
    ).toBe(0);
  });

  it('allows all four attempts and reuse of tracking; rejects a fifth', async () => {
    for (let n = 1; n <= 4; n++) await addAttempt(n);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    expect(
      (
        await client.query(
          'SELECT "currentDeliveryAttempt","retryCount" FROM orders WHERE id=1',
        )
      ).rows[0],
    ).toEqual({ currentDeliveryAttempt: 4, retryCount: 3 });
    await rejectsSql(
      `INSERT INTO delivery_attempts ("orderId","deliveryAttempt","trackingReference") VALUES (1,5,'X')`,
      [],
      { code: '23514', constraint: 'delivery_attempts_number_check' },
    );
  });

  it.each([
    [1, null],
    [null, 0],
    [1, 1],
    [0, -1],
    [5, 4],
  ])(
    'rejects inconsistent nullable/range counters %s/%s',
    async (current, retries) => {
      await rejectsSql(
        `UPDATE orders SET "currentDeliveryAttempt"=$1,"retryCount"=$2 WHERE id=1`,
        [current, retries],
        { code: '23514' },
      );
    },
  );

  it.each([0, 5])('rejects attempt number %i', async (n) => {
    await rejectsSql(
      `INSERT INTO delivery_attempts ("orderId","deliveryAttempt","trackingReference") VALUES (1,$1,'X')`,
      [n],
      { code: '23514', constraint: 'delivery_attempts_number_check' },
    );
  });

  it.each(['', '   ', ' X ', 'x'.repeat(101)])(
    'rejects invalid tracking %s',
    async (tracking) => {
      await rejectsSql(
        `INSERT INTO delivery_attempts ("orderId","deliveryAttempt","trackingReference") VALUES (1,1,$1)`,
        [tracking],
        { code: tracking.length > 100 ? '22001' : '23514' },
      );
    },
  );

  it('enforces order ownership and uniqueness, not global tracking uniqueness', async () => {
    await addAttempt(1);
    await addAttempt(1, client, 2);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await rejectsSql(
      `INSERT INTO delivery_attempts ("orderId","deliveryAttempt","trackingReference") VALUES (1,1,'OTHER')`,
      [],
      { code: '23505' },
    );
    await rejectsSql(
      `INSERT INTO delivery_attempts ("orderId","deliveryAttempt","trackingReference") VALUES (99999,1,'X')`,
      [],
      { code: '23503' },
    );
  });

  it('rejects a current pointer with no attempt in the same order', async () => {
    await addAttempt(1, client, 2);
    await client.query(
      `UPDATE orders SET "currentDeliveryAttempt"=1,"retryCount"=0 WHERE id=1`,
    );
    await expect(client.query('COMMIT')).rejects.toMatchObject({
      code: '23503',
    });
    expect(
      (
        await client.query(
          'SELECT "currentDeliveryAttempt" FROM orders WHERE id=1',
        )
      ).rows[0].currentDeliveryAttempt,
    ).toBeNull();
    expect(
      (await client.query('SELECT count(*)::int AS n FROM delivery_attempts'))
        .rows[0].n,
    ).toBe(0);
  });

  it('rejects identities without a counter at commit and rolls back both writes', async () => {
    await client.query(
      `INSERT INTO delivery_attempts ("orderId","deliveryAttempt","trackingReference") VALUES (1,1,'X')`,
    );
    await client.query(
      `UPDATE payments SET status='PAID',"paidAt"=now() WHERE id=1`,
    );
    await expect(client.query('COMMIT')).rejects.toMatchObject({
      code: '23514',
      constraint: 'orders_delivery_sequence_check',
    });
    expect(
      (await client.query('SELECT status FROM payments WHERE id=1')).rows[0]
        .status,
    ).toBe('UNPAID');
    expect(
      (await client.query('SELECT count(*)::int AS n FROM delivery_attempts'))
        .rows[0].n,
    ).toBe(0);
  });

  it('rejects advancing by more than one and reset/decrement after initialization', async () => {
    await addAttempt(1);
    for (const pair of [
      [3, 2],
      [null, null],
      [0, -1],
    ]) {
      await rejectsSql(
        `UPDATE orders SET "currentDeliveryAttempt"=$1,"retryCount"=$2 WHERE id=1`,
        pair,
        { code: '23514', constraint: 'orders_delivery_next_attempt_check' },
      );
    }
    await addAttempt(2);
    await rejectsSql(
      `UPDATE orders SET "currentDeliveryAttempt"=1,"retryCount"=0 WHERE id=1`,
      [],
      { code: '23514', constraint: 'orders_delivery_next_attempt_check' },
    );
  });

  it('rejects a missing earlier identity even when the current pointer exists', async () => {
    await addAttempt(1);
    await addAttempt(2);
    await client.query(
      'DELETE FROM delivery_attempts WHERE "orderId"=1 AND "deliveryAttempt"=1',
    );
    await expect(client.query('COMMIT')).rejects.toMatchObject({
      code: '23514',
      constraint: 'orders_delivery_sequence_check',
    });
  });

  it('freezes tracking, number, order, creation time and id', async () => {
    await addAttempt(1);
    for (const expression of [
      '"trackingReference"=\'CHANGED\'',
      '"deliveryAttempt"=2',
      '"orderId"=2',
      '"createdAt"="createdAt"+interval \'1 second\'',
      'id=id+100',
    ]) {
      await rejectsSql(
        `UPDATE delivery_attempts SET ${expression} WHERE "orderId"=1`,
        [],
        {
          code: '23514',
          constraint: 'delivery_attempts_identity_immutable_check',
        },
      );
    }
    await client.query(
      `UPDATE delivery_attempts SET "trackingReference"='SAME-WAYBILL' WHERE "orderId"=1`,
    );
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  });

  it('rejects delete/reinsert as a bypass of tracking immutability', async () => {
    await addAttempt(1);
    await client.query('DELETE FROM delivery_attempts WHERE "orderId"=1');
    await client.query(
      `INSERT INTO delivery_attempts ("orderId","deliveryAttempt","trackingReference") VALUES (1,1,'REPLACED')`,
    );
    await expect(client.query('COMMIT')).rejects.toMatchObject({
      code: '23514',
      constraint: 'delivery_attempts_identity_immutable_check',
    });
    expect(
      (await client.query('SELECT count(*)::int AS n FROM delivery_attempts'))
        .rows[0].n,
    ).toBe(0);
  });

  it('rejects a late write from an independent connection after another attempt commits', async () => {
    // Commit only this test fixture; use a separate checkout/order, never shared business rows.
    await client.query(
      `INSERT INTO checkouts (id,"buyerId","idempotencyKey","requestHash") VALUES (3,1,'concurrent-delivery-key','fixture')`,
    );
    await client.query(`INSERT INTO orders (id,"orderNumber","checkoutId","buyerId","storeId",status,
      "recipientNameSnapshot","phoneSnapshot","provinceSnapshot","wardSnapshot","addressLineSnapshot",
      subtotal,"shippingFee",total,"updatedAt")
      VALUES (3,'CONCURRENT-DELIVERY',3,1,1,'READY_TO_SHIP','Fixture','0900000000','Province','Ward','Address',10000,0,10000,now())`);
    await addAttempt(1, client, 3);
    await client.query('COMMIT');
    const other = await pool.connect();
    try {
      await other.query(`SET search_path TO "${schema}"`);
      await client.query('BEGIN');
      await client.query('SELECT id FROM orders WHERE id=3 FOR UPDATE');
      await addAttempt(2, client, 3);
      const competing = other
        .query(
          `INSERT INTO delivery_attempts ("orderId","deliveryAttempt","trackingReference")
        VALUES (3,2,'LATE-WAYBILL')`,
        )
        .then(
          () => null,
          (error: unknown) => error,
        );
      await client.query('COMMIT');
      expect(await competing).toMatchObject({ code: '23505' });
      expect(
        (
          await client.query(
            'SELECT "currentDeliveryAttempt","retryCount" FROM orders WHERE id=3',
          )
        ).rows[0],
      ).toEqual({ currentDeliveryAttempt: 2, retryCount: 1 });
    } finally {
      await client.query('ROLLBACK');
      await other.query('ROLLBACK');
      other.release();
      await client.query('BEGIN');
      await client.query('DELETE FROM delivery_attempts WHERE "orderId"=3');
      await client.query('DELETE FROM orders WHERE id=3');
      await client.query('DELETE FROM checkouts WHERE id=3');
      await client.query('COMMIT');
    }
  });
});
