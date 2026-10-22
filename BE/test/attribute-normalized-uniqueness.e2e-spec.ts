import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool, type PoolClient } from 'pg';
import { normalizedAttributeNameKey } from '../src/catalog/attribute-name-key.js';
import { assertAttributeReadQaTarget } from './helpers/attribute-read-qa-target.js';

const migration = readFileSync(
  new URL(
    '../prisma/migrations/20261021100000_attribute_normalized_uniqueness/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const foundation = readFileSync(
  new URL(
    '../prisma/migrations/20261019110000_attribute_read_foundation/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Normalized Attribute uniqueness — real PostgreSQL', () => {
  let pool: Pool;
  let client: PoolClient;
  let schema: string;

  beforeAll(() => {
    const url = assertAttributeReadQaTarget(process.env.DATABASE_URL);
    pool = new Pool({ connectionString: url.toString(), max: 4 });
  });
  beforeEach(async () => {
    client = await pool.connect();
    schema = `attribute_normalized_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE users (id integer PRIMARY KEY);
      CREATE TABLE category_attribute_definitions (
        id SERIAL PRIMARY KEY,"categoryId" integer NOT NULL,name text NOT NULL,slug text NOT NULL,
        "dataType" text NOT NULL DEFAULT 'SINGLE_SELECT',"isRequired" boolean NOT NULL DEFAULT false,
        "isFilterable" boolean NOT NULL DEFAULT false,"allowsCustom" boolean NOT NULL DEFAULT true,
        "sortOrder" integer NOT NULL DEFAULT 0,"isActive" boolean NOT NULL DEFAULT true,
        "updatedAt" timestamp NOT NULL DEFAULT '2026-01-01',
        UNIQUE("categoryId",slug)
      );
      CREATE TABLE category_attribute_options (
        id SERIAL PRIMARY KEY,"attributeDefinitionId" integer NOT NULL REFERENCES category_attribute_definitions(id),
        value text NOT NULL,slug text NOT NULL,"sortOrder" integer NOT NULL DEFAULT 0,
        "isActive" boolean NOT NULL DEFAULT true,UNIQUE("attributeDefinitionId",slug)
      );
      CREATE TABLE product_attribute_values (
        id integer PRIMARY KEY,"productId" integer NOT NULL,
        "attributeDefinitionId" integer NOT NULL REFERENCES category_attribute_definitions(id),
        "attributeOptionId" integer REFERENCES category_attribute_options(id),"textValue" text
      );
      INSERT INTO users VALUES (1);
      INSERT INTO category_attribute_definitions("categoryId",name,slug) VALUES
        (10,'  Kết   nối ','connectivity'),
        (10,'Màu sắc','color'), (20,'Màu sắc','other-category-color');
      INSERT INTO category_attribute_options("attributeDefinitionId",value,slug) VALUES
        (1,'USB A','usb-a'),(1,'WiFi','wifi'),(2,'USB A','usb-a');
      INSERT INTO product_attribute_values VALUES (1,100,1,1,NULL);
    `);
    // The real preceding revision/audit migration, not a fake revision trigger.
    await client.query(foundation);
    await client.query(`INSERT INTO category_attribute_audits("actorId","categoryId","definitionId", "entityType",command,revision,"correlationId","newValues")
      VALUES (1,10,1,'DEFINITION','CREATE_DEFINITION',1,'00000000-0000-4000-8000-000000000001','{}')`);
  });
  afterEach(async () => {
    if (!client) return;
    await client.query('ROLLBACK');
    await client.query('RESET search_path');
    if (!/^attribute_normalized_[a-f0-9]{32}$/.test(schema))
      throw Error('Unsafe schema cleanup');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    client.release();
  });
  afterAll(async () => {
    await pool?.end();
  });

  async function snapshot() {
    const result: Record<string, unknown> = {};
    for (const table of [
      'category_attribute_definitions',
      'category_attribute_options',
      'product_attribute_values',
      'category_attribute_audits',
    ]) {
      result[table] = (
        await client.query(
          `SELECT row_to_json(t) AS data FROM "${table}" t ORDER BY id`,
        )
      ).rows;
    }
    return result;
  }

  it('upgrades without rewriting display metadata, revision, timestamps, values or immutable audits', async () => {
    const before = await snapshot();
    await client.query(migration);
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname=$1 AND indexname IN
      ('attribute_definition_category_normalized_name_key','attribute_option_definition_normalized_value_key')`,
          [schema],
        )
      ).rows[0].n,
    ).toBe(2);
  });

  it('matches contract normalization including every ECMAScript whitespace code point and accented/astral text', async () => {
    await client.query(migration);
    const whitespace = [
      9,
      10,
      11,
      12,
      13,
      32,
      160,
      5760,
      ...Array.from({ length: 11 }, (_, i) => 8192 + i),
      8232,
      8233,
      8239,
      8287,
      12288,
      65279,
    ];
    const corpus = [
      'Kết  nối',
      '  MÀU SẮC  ',
      'Mau sac',
      'İIıi',
      'ΟΣ ΟΣΑ',
      'K ẞ SS',
      'Ａ A',
      '𐐀𐐁 😀',
      'ĐƯỜNG DẪN',
      'A\u0085B',
      'A\u200bB',
      ...whitespace.map(
        (cp) =>
          `${String.fromCodePoint(cp)}MÀU${String.fromCodePoint(cp)} SẮC${String.fromCodePoint(cp)}`,
      ),
    ];
    for (const text of corpus) {
      const actual = (
        await client.query('SELECT attribute_normalized_key_v1($1) AS key', [
          text,
        ])
      ).rows[0].key;
      expect(actual, JSON.stringify(text)).toBe(
        normalizedAttributeNameKey(text),
      );
    }
  });

  it.each(['definition', 'option'] as const)(
    'refuses legacy %s collisions atomically, including inactive rows',
    async (entity) => {
      if (entity === 'definition')
        await client.query(
          `INSERT INTO category_attribute_definitions("categoryId",name,slug,"isActive") VALUES (10,' KẾT NỐI ','duplicate',false)`,
        );
      else
        await client.query(
          `INSERT INTO category_attribute_options("attributeDefinitionId",value,slug,"isActive") VALUES (1,' usb  a ','duplicate',false)`,
        );
      const before = await snapshot();
      await expect(client.query(migration)).rejects.toMatchObject({
        code: '23505',
        constraint: 'attribute_normalized_upgrade_conflict',
      });
      await client.query('ROLLBACK');
      expect(await snapshot()).toEqual(before);
      expect(
        (
          await client.query(
            `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=$1 AND p.proname='attribute_normalized_key_v1'`,
            [schema],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await client.query(
            `SELECT count(*)::int AS n FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace
      WHERE n.nspname=$1 AND c.collname='attribute_vi_v1'`,
            [schema],
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );

  it('refuses oversized legacy index input without truncation or partial DDL', async () => {
    await client.query(
      `UPDATE category_attribute_definitions SET name=$1 WHERE id=1`,
      ['あ'.repeat(800)],
    );
    const before = await snapshot();
    await expect(client.query(migration)).rejects.toMatchObject({
      code: '54000',
    });
    await client.query('ROLLBACK');
    expect(await snapshot()).toEqual(before);
  });

  it.each([true, false])(
    'reserves definition name even if isActive=%s and a different slug is supplied',
    async (active) => {
      await client.query(
        `UPDATE category_attribute_definitions SET "isActive"=$1 WHERE id=1`,
        [active],
      );
      await client.query(migration);
      await expect(
        client.query(
          `INSERT INTO category_attribute_definitions("categoryId",name,slug) VALUES (10,'kết nối','different-slug')`,
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'attribute_definition_category_normalized_name_key',
      });
    },
  );

  it('rejects option aliases by value, retains inactive reservations and rolls parent revision back', async () => {
    await client.query(
      `UPDATE category_attribute_options SET "isActive"=false WHERE id=1`,
    );
    await client.query(migration);
    const before = await snapshot();
    await expect(
      client.query(
        `INSERT INTO category_attribute_options("attributeDefinitionId",value,slug) VALUES (1,' usb  A ','another-slug')`,
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'attribute_option_definition_normalized_value_key',
    });
    expect(await snapshot()).toEqual(before);
  });

  it('rejects PATCH to another reserved name/value without leaving revision changes', async () => {
    await client.query(migration);
    const before = await snapshot();
    await expect(
      client.query(
        `UPDATE category_attribute_definitions SET name=' KẾT NỐI ' WHERE id=2`,
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'attribute_definition_category_normalized_name_key',
    });
    await expect(
      client.query(
        `UPDATE category_attribute_options SET value=' USB A ' WHERE id=2`,
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'attribute_option_definition_normalized_value_key',
    });
    expect(await snapshot()).toEqual(before);
  });

  it('allows scope separation and preserves accents/compatibility characters and existing slug uniqueness', async () => {
    await client.query(migration);
    await client.query(`INSERT INTO category_attribute_definitions("categoryId",name,slug) VALUES
      (30,'Màu sắc','color'),(10,'Mau sac','no-accents'),(10,'Ａ','wide-a'),(10,'A','ascii-a')`);
    await client.query(
      `INSERT INTO category_attribute_options("attributeDefinitionId",value,slug) VALUES (3,'usb a','usb-a')`,
    );
    await expect(
      client.query(
        `INSERT INTO category_attribute_definitions("categoryId",name,slug) VALUES (10,'Distinct name','color')`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it.each(['definition', 'option'] as const)(
    'serializes competing %s aliases across two real connections; one winner only',
    async (entity) => {
      await client.query(migration);
      const first = await pool.connect();
      const second = await pool.connect();
      let pending: Promise<unknown> | undefined;
      try {
        for (const connection of [first, second]) {
          await connection.query(`SET search_path TO "${schema}"`);
          await connection.query('BEGIN');
          await connection.query(`SET LOCAL statement_timeout='5s'`);
        }
        const pid1 = (await first.query('SELECT pg_backend_pid() AS pid'))
          .rows[0].pid;
        const pid2 = (await second.query('SELECT pg_backend_pid() AS pid'))
          .rows[0].pid;
        const insert =
          entity === 'definition'
            ? `INSERT INTO category_attribute_definitions("categoryId",name,slug) VALUES (10,$1,$2)`
            : `INSERT INTO category_attribute_options("attributeDefinitionId",value,slug) VALUES (1,$1,$2)`;
        // Parent-first protocol prevents the pre-existing FK/AFTER-trigger lock upgrade deadlock.
        if (entity === 'option')
          await first.query(
            'SELECT id FROM category_attribute_definitions WHERE id=1 FOR UPDATE',
          );
        await first.query(insert, ['Concurrent Label', 'race-a']);
        // Attach rejection handler immediately so a quick error is not unhandled.
        pending = (async () => {
          if (entity === 'option')
            await second.query(
              'SELECT id FROM category_attribute_definitions WHERE id=1 FOR UPDATE',
            );
          return second.query(insert, ['  CONCURRENT   LABEL ', 'race-b']);
        })().then(
          () => ({ ok: true }),
          (error) => ({ code: error.code, constraint: error.constraint }),
        );
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          if (
            (
              await client.query(
                'SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked',
                [pid1, pid2],
              )
            ).rows[0].blocked
          ) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        await first.query('COMMIT');
        expect(await pending).toEqual({
          code: '23505',
          constraint:
            entity === 'definition'
              ? 'attribute_definition_category_normalized_name_key'
              : 'attribute_option_definition_normalized_value_key',
        });
        await second.query('ROLLBACK');
        const table =
          entity === 'definition'
            ? 'category_attribute_definitions'
            : 'category_attribute_options';
        expect(
          (
            await client.query(
              `SELECT count(*)::int AS n FROM "${table}" WHERE slug IN ('race-a','race-b')`,
            )
          ).rows[0].n,
        ).toBe(1);
        if (entity === 'option')
          expect(
            (
              await client.query(
                'SELECT revision FROM category_attribute_definitions WHERE id=1',
              )
            ).rows[0].revision,
          ).toBe(2);
      } finally {
        await first.query('ROLLBACK');
        await pending;
        await second.query('ROLLBACK');
        for (const connection of [first, second]) {
          await connection.query('RESET search_path');
          connection.release();
        }
      }
    },
  );
});
