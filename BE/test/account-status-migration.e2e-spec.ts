import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

describe('Accounts migration — real SQL baseline upgrade', () => {
  it('preserves existing active/inactive identities, Store and refresh state without fabricated audit', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('5549');
    expect([
      '/bckl_order_resolution_test_attributes_20261019',
      '/bckl_order_resolution_test_accounts_20261024_v946',
      '/bckl_order_resolution_test_attributes_20261019_v947',
      '/bckl_order_resolution_test_attributes_20261019_v948',
      '/bckl_order_resolution_test_attributes_20261019_v949',
    ]).toContain(url.pathname);
    const db = new Client({ connectionString: url.toString() });
    await db.connect();
    // Unique retained schema, never DROP/reset or alter public business tables.
    const schema = `account_upgrade_${randomUUID().replaceAll('-', '')}`;
    try {
      await db.query(`CREATE SCHEMA "${schema}"`);
      await db.query(`SET search_path TO "${schema}"`);
      const directory = new URL('../prisma/migrations/', import.meta.url);
      const allMigrations = (await readdir(directory))
        .filter((name) => /^\d/.test(name))
        .sort();
      // This historical probe remains SQL23→24 when later migrations are added.
      const migrations = allMigrations.slice(
        0,
        allMigrations.indexOf('20261024180000_account_status_hardening') + 1,
      );
      expect(migrations.at(-1)).toBe('20261024180000_account_status_hardening');
      expect(migrations).toHaveLength(24);
      for (const migration of migrations.slice(0, -1)) {
        const sql = await readFile(
          new URL(`${migration}/migration.sql`, directory),
          'utf8',
        );
        // pg sends a batch in one implicit transaction. Enum additions must commit
        // before the following statements use them, as in the migration runner.
        // Split only complete ALTER TYPE ADD VALUE lines; never split PL/pgSQL.
        for (const part of sql.split(
          /(^ALTER TYPE [^\r\n;]+ ADD VALUE [^\r\n;]+;\r?$)/m,
        )) {
          if (part.trim()) await db.query(part);
        }
      }
      await db.query(`INSERT INTO users (email,"passwordHash",role,"isActive","credentialVersion","updatedAt")
        VALUES ('upgrade-admin@example.invalid','not-a-login','ADMIN',true,3,CURRENT_TIMESTAMP),
          ('upgrade-inactive@example.invalid','not-a-login','SELLER',false,7,CURRENT_TIMESTAMP)`);
      await db.query(
        `INSERT INTO stores ("sellerId",name,status,"updatedAt") VALUES (2,'Upgrade Store','SUSPENDED',CURRENT_TIMESTAMP)`,
      );
      await db.query(
        `INSERT INTO refresh_tokens ("tokenHash","userId","expiresAt") VALUES ('synthetic-token-hash',2,CURRENT_TIMESTAMP + interval '1 day')`,
      );
      const users = (await db.query('SELECT * FROM users ORDER BY id')).rows;
      const stores = (await db.query('SELECT * FROM stores ORDER BY id')).rows;
      const refresh = (
        await db.query('SELECT * FROM refresh_tokens ORDER BY id')
      ).rows;
      await db.query(
        await readFile(
          new URL(`${migrations.at(-1)}/migration.sql`, directory),
          'utf8',
        ),
      );
      const after = (await db.query('SELECT * FROM users ORDER BY id')).rows;
      for (const row of after) {
        expect(row.statusRevision).toBe(1);
        delete row.statusRevision;
      }
      expect(after).toEqual(users);
      expect((await db.query('SELECT * FROM stores ORDER BY id')).rows).toEqual(
        stores,
      );
      expect(
        (await db.query('SELECT * FROM refresh_tokens ORDER BY id')).rows,
      ).toEqual(refresh);
      expect(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM account_status_history',
          )
        ).rows[0].n,
      ).toBe(0);
      await expect(
        db.query('UPDATE users SET "statusRevision"=0 WHERE id=1'),
      ).rejects.toMatchObject({ code: '23514' });
      // Synthetic pre-recovery status/audit fixture; not a runtime status call.
      await db.query(
        'UPDATE users SET "statusRevision"=2,"credentialVersion"=8 WHERE id=2',
      );
      await db.query(`INSERT INTO account_status_history ("actorId","targetId","beforeActive","afterActive","fromRevision","toRevision","fromCredentialVersion","toCredentialVersion",reason)
        VALUES (1,2,true,false,1,2,7,8,'Synthetic pre-recovery status audit')`);
      const beforeRecovery = {
        users: (await db.query('SELECT * FROM users ORDER BY id')).rows,
        audit: (
          await db.query('SELECT * FROM account_status_history ORDER BY id')
        ).rows,
        refresh: (await db.query('SELECT * FROM refresh_tokens ORDER BY id'))
          .rows,
      };
      await db.query(
        await readFile(
          new URL(
            '20261025150000_account_status_command_receipts/migration.sql',
            directory,
          ),
          'utf8',
        ),
      );
      expect({
        users: (await db.query('SELECT * FROM users ORDER BY id')).rows,
        audit: (
          await db.query('SELECT * FROM account_status_history ORDER BY id')
        ).rows,
        refresh: (await db.query('SELECT * FROM refresh_tokens ORDER BY id'))
          .rows,
      }).toEqual(beforeRecovery);
      expect(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM account_status_commands',
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await db.end();
    }
  }, 15000);
});
