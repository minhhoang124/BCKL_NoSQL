import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { Pool } from 'pg';
import { assertOrderResolutionQaTarget } from './helpers/order-resolution-qa-target.js';

describe('Buyer resolver additive migration on prior complete schema', () => {
  it('preserves old Seller fences and Buyer/Seller/SYSTEM receipts; only expands valid pairs', async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!(
      process.env.GITHUB_ACTIONS === 'true' &&
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.pathname === '/klcn_ecommerce'
    ))
      assertOrderResolutionQaTarget(process.env.DATABASE_URL);
    const pool = new Pool({
      connectionString: url.href,
      max: 1,
      statement_timeout: 15000,
    });
    const c = await pool.connect(),
      schema = `buyer_upgrade_${randomUUID().replaceAll('-', '')}`;
    const target = '20261019040000_buyer_order_command_resolution';
    const workspace = await mkdtemp(path.join(tmpdir(), 'bckl-buyer-upgrade-'));
    try {
      await c.query(`CREATE SCHEMA "${schema}"`);
      await c.query(`SET search_path TO "${schema}"`);
      const root = path.resolve('prisma/migrations');
      for (const entry of (await readdir(root, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && e.name < target)
        .sort((a, b) => a.name.localeCompare(b.name)))
        await cp(
          path.join(root, entry.name),
          path.join(workspace, 'migrations', entry.name),
          { recursive: true },
        );
      await cp(
        path.join(root, 'migration_lock.toml'),
        path.join(workspace, 'migrations', 'migration_lock.toml'),
      );
      const config = path.join(workspace, 'prisma.config.mjs');
      await writeFile(
        config,
        `export default ${JSON.stringify({ schema: path.resolve('prisma/schema.prisma'), migrations: { path: path.join(workspace, 'migrations') }, datasource: { url: '' } }).replace('"url":""', '"url":process.env.DATABASE_URL')};`,
      );
      url.searchParams.set('schema', schema);
      await promisify(execFile)(
        process.execPath,
        [
          createRequire(import.meta.url).resolve('prisma/build/index.js'),
          'migrate',
          'deploy',
          '--config',
          config,
        ],
        {
          env: { ...process.env, DATABASE_URL: url.href },
          timeout: 45000,
          maxBuffer: 1024 * 1024,
        },
      );
      await c.query(`INSERT INTO users(id,email,"passwordHash",role,"updatedAt") VALUES(1,'seller@example.test','QA','SELLER',now()),(2,'buyer@example.test','QA','USER',now());
        INSERT INTO stores(id,"sellerId",name,status,"updatedAt") VALUES(1,1,'QA Store','ACTIVE',now());
        INSERT INTO checkouts(id,"buyerId","idempotencyKey","requestHash") VALUES(1,2,'historical-checkout','legacy');
        INSERT INTO orders(id,"checkoutId","buyerId","storeId","orderNumber","recipientNameSnapshot","phoneSnapshot","provinceSnapshot","wardSnapshot","addressLineSnapshot",subtotal,total,"shippingFee","updatedAt") VALUES(1,1,2,1,'QA-HISTORY','QA','0900000000','QA','QA','QA',10000,10000,0,now());
        INSERT INTO payments(id,"orderId",provider,amount,"updatedAt") VALUES(1,1,'COD',10000,now());`);
      await c.query(`BEGIN ISOLATION LEVEL SERIALIZABLE;
        INSERT INTO order_command_resolutions("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion") VALUES(1,1,'SELLER','USER:1','historical_seller_fence','confirm',repeat('a',64),1);
        INSERT INTO order_commands("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion",status,"responseStatus","resultSnapshot","completedAt") VALUES
          (1,1,'SELLER','USER:1','historical_seller_receipt','start-packing',repeat('b',64),1,'SUCCEEDED',200,'{"historical":"seller"}',CURRENT_TIMESTAMP),
          (1,2,'BUYER','USER:2','historical_buyer_receipt','cancel',repeat('c',64),1,'SUCCEEDED',200,'{"historical":"buyer"}',CURRENT_TIMESTAMP),
          (1,NULL,'SYSTEM','SYSTEM:ORDER_AUTO_COMPLETE','historical_system_receipt','complete',repeat('d',64),1,'SUCCEEDED',200,'{"historical":"system"}',CURRENT_TIMESTAMP);
        COMMIT;`);
      const tables = [
        'users',
        'stores',
        'checkouts',
        'orders',
        'payments',
        'order_commands',
        'order_command_resolutions',
        'order_status_history',
      ];
      const snapshot = async () => {
        const data: Record<string, unknown> = {};
        for (const table of tables)
          data[table] = (
            await c.query(
              `SELECT to_jsonb(t) value FROM "${table}" t ORDER BY id`,
            )
          ).rows;
        return data;
      };
      const before = await snapshot();
      await c.query(
        await readFile(path.join(root, target, 'migration.sql'), 'utf8'),
      );
      expect(await snapshot()).toEqual(before);
      for (const command of ['cancel', 'complete']) {
        await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await c.query(
          `INSERT INTO order_command_resolutions("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion") VALUES(1,2,'BUYER','USER:2',$1,$2,repeat('e',64),1)`,
          [`new_buyer_${command}_key`, command],
        );
        await c.query('COMMIT');
      }
      for (const [actor, command] of [
        ['BUYER', 'confirm'],
        ['SELLER', 'cancel'],
        ['ADMIN', 'complete'],
        ['SYSTEM', 'complete'],
      ]) {
        await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await expect(
          c.query(
            `INSERT INTO order_command_resolutions("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion") VALUES(1,2,$1,'USER:2','invalid_actor_pair_key',$2,repeat('f',64),1)`,
            [actor, command],
          ),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'order_resolution_identity_check',
        });
        await c.query('ROLLBACK');
      }
      // Both original immutability and exclusion triggers remain installed.
      await expect(
        c.query('UPDATE order_command_resolutions SET command=command'),
      ).rejects.toMatchObject({ constraint: 'order_resolutions_immutable' });
      await expect(
        c.query('DELETE FROM order_command_resolutions'),
      ).rejects.toMatchObject({ constraint: 'order_resolutions_immutable' });
      await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await expect(
        c.query(
          `INSERT INTO order_commands("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion") VALUES(1,2,'BUYER','USER:2','new_buyer_cancel_key','cancel',repeat('e',64),1)`,
        ),
      ).rejects.toMatchObject({
        constraint: 'order_command_outcome_exclusion',
      });
      await c.query('ROLLBACK');
      await expect(
        c.query(
          `INSERT INTO order_command_resolutions("orderId","actorId","actorType","actorScope","idempotencyKey",command,"requestHash","hashVersion") VALUES(1,2,'BUYER','USER:2','read_committed_bad_key','cancel',repeat('e',64),1)`,
        ),
      ).rejects.toMatchObject({
        constraint: 'order_command_serializable_required',
      });
    } finally {
      await c.query('ROLLBACK');
      const current = (await c.query('SELECT current_schema() name')).rows[0]
        .name;
      assert.equal(current, schema, 'Refusing unsafe schema cleanup');
      assert.match(schema, /^buyer_upgrade_[0-9a-f]{32}$/);
      await c.query(`DROP SCHEMA "${schema}" CASCADE`);
      c.release();
      await pool.end();
      const resolved = path.resolve(workspace);
      assert.ok(
        resolved.startsWith(path.resolve(tmpdir()) + path.sep) &&
          path.basename(resolved).startsWith('bckl-buyer-upgrade-'),
        'Unsafe temporary cleanup',
      );
      await rm(resolved, { recursive: true, force: true });
    }
  }, 60000);
});
