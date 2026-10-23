import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';

describe('Credential version additive upgrade', () => {
  it('preserves legacy accounts/refresh rows and installs positive version default', async () => {
    assertRuntimeQaTarget(process.env.DATABASE_URL, process.env.GITHUB_ACTIONS);
    const url = new URL(process.env.DATABASE_URL!);
    const schema = 'settings_upgrade_' + randomUUID().replaceAll('-', '');
    const pool = new Pool({ connectionString: url.href, max: 1 });
    const client = await pool.connect();
    const temp = await mkdtemp(path.join(tmpdir(), 'bckl-settings-upgrade-'));
    const migrations = path.resolve('prisma/migrations');
    const target = '20261023100000_account_credential_version';
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      for (const entry of await readdir(migrations, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name < target)
          await cp(
            path.join(migrations, entry.name),
            path.join(temp, 'migrations', entry.name),
            { recursive: true },
          );
      }
      await cp(
        path.join(migrations, 'migration_lock.toml'),
        path.join(temp, 'migrations/migration_lock.toml'),
      );
      url.searchParams.set('schema', schema);
      const config = path.join(temp, 'prisma.config.mjs');
      await writeFile(
        config,
        `export default {schema:${JSON.stringify(path.resolve('prisma/schema.prisma'))},migrations:{path:${JSON.stringify(path.join(temp, 'migrations'))}},datasource:{url:process.env.DATABASE_URL}};`,
      );
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
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(
        `INSERT INTO users(id,email,"passwordHash","fullName",role,"updatedAt") VALUES (1,'legacy-settings@example.test','legacy-hash','Legacy Seller','SELLER','2026-01-01')`,
      );
      await client.query(
        `INSERT INTO refresh_tokens("tokenHash","userId","expiresAt") VALUES ('legacy-token',1,'2030-01-01')`,
      );
      const before = (
        await client.query('SELECT to_jsonb(u) AS value FROM users u')
      ).rows;
      const tokens = (await client.query('SELECT * FROM refresh_tokens')).rows;
      await client.query(
        await readFile(path.join(migrations, target, 'migration.sql'), 'utf8'),
      );
      assert.deepEqual(
        (
          await client.query(
            `SELECT to_jsonb(u) - 'credentialVersion' AS value FROM users u`,
          )
        ).rows,
        before,
      );
      assert.deepEqual(
        (await client.query('SELECT * FROM refresh_tokens')).rows,
        tokens,
      );
      assert.equal(
        (await client.query('SELECT "credentialVersion" FROM users')).rows[0]
          .credentialVersion,
        1,
      );
      await expect(
        client.query('UPDATE users SET "credentialVersion"=0'),
      ).rejects.toMatchObject({ code: '23514' });
      await client.query(
        `INSERT INTO users(id,email,"passwordHash","updatedAt") VALUES (2,'new-settings@example.test','new-hash',now())`,
      );
      assert.equal(
        (
          await client.query(
            `SELECT "credentialVersion" FROM users WHERE email='new-settings@example.test'`,
          )
        ).rows[0].credentialVersion,
        1,
      );
      await client.query(
        await readFile(
          path.join(
            migrations,
            '20261023110000_account_security_events/migration.sql',
          ),
          'utf8',
        ),
      );
      await client.query(
        `INSERT INTO account_security_events("userId",event,"fromVersion","toVersion") VALUES(1,'PASSWORD_CHANGED',1,2)`,
      );
      const audit = (
        await client.query('SELECT * FROM account_security_events')
      ).rows;
      await expect(
        client.query(`UPDATE account_security_events SET event='changed'`),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        client.query('DELETE FROM account_security_events'),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        client.query(
          `INSERT INTO account_security_events("userId",event,"fromVersion","toVersion") VALUES(1,'PASSWORD_CHANGED',1,2)`,
        ),
      ).rejects.toMatchObject({ code: '23505' });
      assert.deepEqual(
        (await client.query('SELECT * FROM account_security_events')).rows,
        audit,
      );
    } finally {
      client.release();
      await pool.end();
      // Keep the QA-only schema and temporary migration fixture as upgrade evidence.
    }
  }, 60000);
});
