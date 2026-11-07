import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
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
import { Pool } from 'pg';
import { assertOrderResolutionQaTarget } from './helpers/order-resolution-qa-target.js';

describe('Resolver expand-only migration with pre-existing receipts', () => {
  it('R13 preserves all historical rows and enables the new constraints', async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!(
      process.env.GITHUB_ACTIONS === 'true' &&
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.pathname === '/klcn_ecommerce'
    ))
      assertOrderResolutionQaTarget(process.env.DATABASE_URL);
    const schema = `resolution_upgrade_${randomUUID().replaceAll('-', '')}`;
    const target = '20261018040000_order_command_resolution';
    const root = path.resolve('prisma/migrations');
    const workspace = await mkdtemp(
      path.join(tmpdir(), 'bckl-resolution-upgrade-'),
    );
    const pool = new Pool({
      connectionString: url.href,
      max: 1,
      statement_timeout: 15000,
    });
    const c = await pool.connect();
    let created = false;
    try {
      await c.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      await c.query(`SET search_path TO "${schema}"`);
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name < target)
          await cp(
            path.join(root, entry.name),
            path.join(workspace, 'migrations', entry.name),
            { recursive: true },
          );
      }
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
      await c.query(`
        INSERT INTO users(id,email,"passwordHash",role,"updatedAt") VALUES(1,'legacy@example.test','fixture','SELLER',now());
        INSERT INTO stores(id,"sellerId",name,status,"updatedAt") VALUES(1,1,'Legacy Store','ACTIVE',now());
        INSERT INTO checkouts(id,"buyerId","idempotencyKey","requestHash",status,"completedAt") VALUES(1,1,'legacy-checkout','legacy-hash','COMPLETED',now());
        INSERT INTO orders(id,"orderNumber","checkoutId","buyerId","storeId","recipientNameSnapshot","phoneSnapshot","provinceSnapshot","wardSnapshot","addressLineSnapshot",subtotal,"shippingFee",total,"updatedAt") VALUES(1,'LEGACY',1,1,1,'Legacy Buyer','0900000000','QA','QA','QA',10000,0,10000,now());
        INSERT INTO payments(id,"orderId",provider,amount,"updatedAt") VALUES(1,1,'COD',10000,now());
        INSERT INTO order_commands(id,"orderId","actorScope","actorType","actorId","idempotencyKey",command,"requestHash","hashVersion",status,"responseStatus","resultSnapshot","completedAt") VALUES(1,1,'USER:1','SELLER',1,'legacy-command-key','confirm',repeat('a',64),1,'SUCCEEDED',200,'{"historical":"unchanged"}',now());
        INSERT INTO order_status_history("orderId","actorId","actorType","fromStatus","toStatus","commandId") VALUES(1,1,'SELLER','PENDING_CONFIRMATION','CONFIRMED',1);
      `);
      const tables = [
        'users',
        'stores',
        'checkouts',
        'orders',
        'payments',
        'order_commands',
        'order_status_history',
      ];
      const snapshot = async () => {
        const result: Record<string, unknown> = {};
        for (const table of tables)
          result[table] = (
            await c.query(
              `SELECT to_jsonb(t) AS value FROM "${table}" t ORDER BY id`,
            )
          ).rows;
        return result;
      };
      const before = await snapshot();
      await c.query(
        await readFile(path.join(root, target, 'migration.sql'), 'utf8'),
      );
      expect(await snapshot()).toEqual(before);
      expect(
        (
          await c.query(
            'SELECT count(*)::int AS n FROM order_command_resolutions',
          )
        ).rows[0].n,
      ).toBe(0);
      await expect(
        c.query(
          `UPDATE order_commands SET "requestHash"=repeat('b',64) WHERE id=1`,
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'order_commands_identity_immutable',
      });
    } finally {
      await c.query('ROLLBACK');
      if (created) {
        const current = (await c.query('SELECT current_schema() AS name'))
          .rows[0].name;
        assert.equal(current, schema, 'Unsafe schema cleanup refused');
        assert.match(schema, /^resolution_upgrade_[0-9a-f]{32}$/);
        await c.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
      c.release();
      await pool.end();
      const resolved = path.resolve(workspace);
      assert.ok(
        resolved.startsWith(path.resolve(tmpdir()) + path.sep) &&
          path.basename(resolved).startsWith('bckl-resolution-upgrade-'),
        'Unsafe temporary workspace cleanup refused',
      );
      await rm(resolved, { recursive: true, force: true });
    }
  }, 60000);
});
