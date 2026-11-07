import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { assertOrderResolutionQaTarget } from './helpers/order-resolution-qa-target.js';

/** SQL mechanism experiment only, NOT the Admin/Seller runtime or its migrations.
 * Isolated fixture tables deliberately expose both writers to the same lock.
 * Production must adopt the protocol and pass its own HTTP/domain tests later.
 */
describe('Attribute write protocol preparation — real multi-connection PostgreSQL', () => {
  let pool: Pool;
  const schema = `attr_protocol_${randomUUID().replaceAll('-', '')}`;
  const table = (name: string) => `"${schema}"."${name}"`;
  beforeAll(async () => {
    assertOrderResolutionQaTarget(process.env.DATABASE_URL);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`
      CREATE TABLE ${table('category')} (id int PRIMARY KEY);
      CREATE TABLE ${table('definition')} (id int PRIMARY KEY, revision int NOT NULL,
        kind text NOT NULL, required boolean NOT NULL DEFAULT false);
      CREATE TABLE ${table('value')} (product_id int PRIMARY KEY, definition_id int REFERENCES ${table('definition')}(id), kind text NOT NULL);
      CREATE TABLE ${table('audit')} (revision int PRIMARY KEY, actor int NOT NULL);
      CREATE TABLE ${table('job')} (revision int PRIMARY KEY);
      CREATE TABLE ${table('option')} (id int PRIMARY KEY,
        definition_id int NOT NULL REFERENCES ${table('definition')}(id));
      CREATE FUNCTION ${table('bump_option_revision')}() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        UPDATE ${table('definition')} SET revision=revision+1
          WHERE id=NEW.definition_id;
        RETURN NEW;
      END $body$;
      CREATE TRIGGER option_revision AFTER INSERT ON ${table('option')}
        FOR EACH ROW EXECUTE FUNCTION ${table('bump_option_revision')}();
      INSERT INTO ${table('category')} VALUES(1);
    `);
  });
  afterAll(async () => {
    if (pool) {
      // Exact UUID schema created by this suite; never drop shared public schema.
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  });
  beforeEach(async () => {
    await pool.query(
      `TRUNCATE ${table('option')},${table('value')},${table('audit')},${table('job')},${table('definition')}`,
    );
    await pool.query(
      `INSERT INTO ${table('definition')} VALUES(1,1,'TEXT',false)`,
    );
  });
  async function transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await client.query("SET LOCAL statement_timeout='3000ms'");
        // SELECT FOR UPDATE alone does not refresh a SERIALIZABLE snapshot
        // after waiting when only a different definition row changed. A shared
        // write fence forces overlapping snapshots to fail/retry consistently.
        await client.query(
          `UPDATE ${table('category')} SET id=id WHERE id=1 RETURNING id`,
        );
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        if (
          !['40001', '40P01'].includes(
            (error as { code?: string }).code ?? '',
          ) ||
          attempt === 2
        )
          throw error;
      } finally {
        client.release();
      }
    }
    throw new Error('Retry exhausted');
  }
  const latch = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };
  async function admin(
    expected: number,
    kind: string,
    actor: number,
    fault?: 'audit' | 'job',
  ) {
    return transaction(async (client) => {
      const row = (
        await client.query(
          `SELECT * FROM ${table('definition')} WHERE id=1 FOR UPDATE`,
        )
      ).rows[0];
      if (row.revision !== expected) return 'STALE';
      if (row.kind === kind) return 'NO_OP';
      const usage = await client.query(
        `SELECT 1 FROM ${table('value')} WHERE definition_id=1 LIMIT 1`,
      );
      if (usage.rowCount) return 'IN_USE';
      if (row.revision === 2147483647) return 'EXHAUSTED';
      await client.query(
        `UPDATE ${table('definition')} SET kind=$1,revision=revision+1 WHERE id=1`,
        [kind],
      );
      await client.query(`INSERT INTO ${table('audit')} VALUES($1,$2)`, [
        expected + 1,
        actor,
      ]);
      if (fault === 'audit') throw new Error('Injected audit failure');
      await client.query(`INSERT INTO ${table('job')} VALUES($1)`, [
        expected + 1,
      ]);
      if (fault === 'job') throw new Error('Injected job failure');
      return 'CHANGED';
    });
  }
  async function snapshot() {
    return Promise.all(
      ['definition', 'value', 'audit', 'job'].map(
        async (name) =>
          (await pool.query(`SELECT * FROM ${table(name)} ORDER BY 1`)).rows,
      ),
    );
  }
  it('counterexample: SELECT-only category lock can preserve a stale Serializable snapshot', async () => {
    const first = await pool.connect(),
      second = await pool.connect();
    try {
      await first.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await first.query(
        `SELECT id FROM ${table('category')} WHERE id=1 FOR UPDATE`,
      );
      await second.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await second.query("SET LOCAL statement_timeout='3000ms'");
      const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid;
      const waiting = second.query(
        `SELECT id FROM ${table('category')} WHERE id=1 FOR UPDATE`,
      );
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const observation = await pool.query(
          'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',
          [pid],
        );
        if (observation.rows[0]?.wait_event_type === 'Lock') {
          blocked = true;
          break;
        }
      }
      expect(blocked).toBe(true);
      await first.query(
        `UPDATE ${table('definition')} SET required=true,revision=2 WHERE id=1`,
      );
      await first.query('COMMIT');
      await waiting;
      const stale = (
        await second.query(
          `SELECT required FROM ${table('definition')} WHERE id=1`,
        )
      ).rows[0].required;
      expect(stale).toBe(false);
      expect(
        (
          await pool.query(
            `SELECT required FROM ${table('definition')} WHERE id=1`,
          )
        ).rows[0].required,
      ).toBe(true);
    } finally {
      await first.query('ROLLBACK');
      await second.query('ROLLBACK');
      first.release();
      second.release();
    }
  });
  it('two Admin connections with same expected revision commit only one change/audit/job', async () => {
    const result = await Promise.all([
      admin(1, 'NUMBER', 11),
      admin(1, 'BOOLEAN', 12),
    ]);
    expect(result.sort()).toEqual(['CHANGED', 'STALE']);
    const [definitions, , audits, jobs] = await snapshot();
    expect(definitions[0].revision).toBe(2);
    expect(audits).toHaveLength(1);
    expect(jobs).toHaveLength(1);
    expect(await admin(2, definitions[0].kind, 11)).toBe('NO_OP');
    expect(await admin(1, 'NUMBER', 11)).toBe('STALE');
    expect((await snapshot()).slice(2)).toEqual([audits, jobs]);
  });
  it('Seller holding category scope commits usage before waiting Admin may change type', async () => {
    const entered = latch(),
      release = latch();
    const seller = transaction(async (client) => {
      entered.release();
      await release.promise;
      const row = (
        await client.query(`SELECT kind FROM ${table('definition')} WHERE id=1`)
      ).rows[0];
      await client.query(`INSERT INTO ${table('value')} VALUES(21,1,$1)`, [
        row.kind,
      ]);
    });
    await entered.promise;
    const mutation = admin(1, 'NUMBER', 11);
    release.release();
    await seller;
    expect(await mutation).toBe('IN_USE');
    const [definitions, values, audits, jobs] = await snapshot();
    expect(definitions[0]).toMatchObject({ revision: 1, kind: 'TEXT' });
    expect(values[0].kind).toBe('TEXT');
    expect(audits).toEqual([]);
    expect(jobs).toEqual([]);
  });
  it('waiting Seller rereads canonical rule after Admin commit, not an old external snapshot', async () => {
    const entered = latch(),
      release = latch();
    const adminWrite = transaction(async (client) => {
      entered.release();
      await release.promise;
      await client.query(
        `UPDATE ${table('definition')} SET required=true,revision=2 WHERE id=1`,
      );
    });
    await entered.promise;
    const seller = transaction(async (client) => {
      const row = (
        await client.query(
          `SELECT required FROM ${table('definition')} WHERE id=1`,
        )
      ).rows[0];
      return row.required ? 'MISSING_REQUIRED' : 'SUBMIT';
    });
    release.release();
    await adminWrite;
    expect(await seller).toBe('MISSING_REQUIRED');
  });
  it.each(['audit', 'job'] as const)(
    'rollback on %s fault preserves metadata/revision/history/work',
    async (fault) => {
      const before = await snapshot();
      await expect(admin(1, 'NUMBER', 11, fault)).rejects.toThrow('Injected');
      expect(await snapshot()).toEqual(before);
      expect(await admin(1, 'NUMBER', 11)).toBe('CHANGED');
      expect((await snapshot())[0][0].revision).toBe(2);
    },
  );
  it('does not reset or wrap exhausted revisions', async () => {
    await pool.query(
      `UPDATE ${table('definition')} SET revision=2147483647 WHERE id=1`,
    );
    const before = await snapshot();
    expect(await admin(2147483647, 'NUMBER', 11)).toBe('EXHAUSTED');
    expect(await snapshot()).toEqual(before);
  });
  async function createOption(id: number, expected?: number, fault = false) {
    return transaction(async (client) => {
      // Parent-before-child: do not acquire the child's FK KEY SHARE first.
      const parent = (
        await client.query(
          `SELECT revision FROM ${table('definition')} WHERE id=1 FOR UPDATE`,
        )
      ).rows[0];
      if (expected !== undefined && parent.revision !== expected)
        return 'STALE';
      await client.query(`INSERT INTO ${table('option')} VALUES($1,1)`, [id]);
      if (fault) throw new Error('Injected option failure');
      return 'CREATED';
    });
  }
  it('five option writers preserve atomicity under bounded retries and allow later retry after exhaustion', async () => {
    // The category fence serializes this prototype; production still needs
    // its own actual trigger/writer test after foundation #77 is merged.
    const ids = [1, 2, 3, 4, 5];
    const outcomes = await Promise.allSettled(
      ids.map((id) => createOption(id)),
    );
    const committed = outcomes.filter(
      (result) => result.status === 'fulfilled',
    );
    expect(committed.length).toBeGreaterThan(0);
    for (const result of committed) {
      if (result.status === 'fulfilled') expect(result.value).toBe('CREATED');
    }
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${table('option')}`,
        )
      ).rows[0].count,
    ).toBe(committed.length);
    expect(
      (
        await pool.query(
          `SELECT revision FROM ${table('definition')} WHERE id=1`,
        )
      ).rows[0].revision,
    ).toBe(1 + committed.length);
    for (const [index, result] of outcomes.entries()) {
      if (result.status !== 'rejected') continue;
      expect(['40001', '40P01']).toContain(result.reason.code);
      // Retry exhaustion is a visible failure, not an accepted mutation. Only
      // these rolled-back requests are retried later, never successful writes.
      expect(await createOption(ids[index])).toBe('CREATED');
    }
    expect(
      (
        await pool.query(
          `SELECT revision FROM ${table('definition')} WHERE id=1`,
        )
      ).rows[0].revision,
    ).toBe(6);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${table('option')}`,
        )
      ).rows[0].count,
    ).toBe(5);
  });
  it('concurrent option writes with the same expected parent revision admit only one', async () => {
    expect(
      (await Promise.all([createOption(1, 1), createOption(2, 1)])).sort(),
    ).toEqual(['CREATED', 'STALE']);
    expect(
      (
        await pool.query(
          `SELECT revision FROM ${table('definition')} WHERE id=1`,
        )
      ).rows[0].revision,
    ).toBe(2);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${table('option')}`,
        )
      ).rows[0].count,
    ).toBe(1);
  });
  it('option insertion failure rolls back the child and its trigger revision', async () => {
    await expect(createOption(1, 1, true)).rejects.toThrow(
      'Injected option failure',
    );
    expect(
      (
        await pool.query(
          `SELECT revision FROM ${table('definition')} WHERE id=1`,
        )
      ).rows[0].revision,
    ).toBe(1);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${table('option')}`,
        )
      ).rows[0].count,
    ).toBe(0);
    expect(await createOption(1, 1)).toBe('CREATED');
  });
});
