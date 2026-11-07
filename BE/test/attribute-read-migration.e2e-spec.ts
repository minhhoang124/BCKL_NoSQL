import { readFileSync } from 'node:fs';
import { Pool, PoolClient } from 'pg';
import { assertAttributeReadQaTarget } from './helpers/attribute-read-qa-target.js';

describe('Attribute read foundation migration', () => {
  let pool: Pool;
  let client: PoolClient;
  const schema = `attribute_read_upgrade_${Date.now()}`;

  beforeAll(async () => {
    const url = assertAttributeReadQaTarget(process.env.DATABASE_URL);
    pool = new Pool({ connectionString: url.toString() });
    client = await pool.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    // Minimal pre-migration tables with existing rows, not a claim about every prior migration.
    await client.query(`
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE category_attribute_definitions (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, "dataType" TEXT NOT NULL,
        "isRequired" BOOLEAN NOT NULL, "isFilterable" BOOLEAN NOT NULL, "allowsCustom" BOOLEAN NOT NULL,
        "sortOrder" INTEGER NOT NULL, "isActive" BOOLEAN NOT NULL, "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE category_attribute_options (
        id INTEGER PRIMARY KEY,"attributeDefinitionId" INTEGER REFERENCES category_attribute_definitions(id),
        value TEXT,slug TEXT,"sortOrder" INTEGER,"isActive" BOOLEAN
      );
      INSERT INTO users VALUES (1);
      INSERT INTO category_attribute_definitions(id,name,slug,"dataType","isRequired","isFilterable","allowsCustom","sortOrder","isActive")
        VALUES (1,'Existing','existing','SINGLE_SELECT',false,false,true,0,true),
               (2,'Other','other','SINGLE_SELECT',false,false,true,0,true);
      INSERT INTO category_attribute_options VALUES (1,1,'USB','usb',0,true);
    `);
    const migration = readFileSync(
      new URL(
        '../prisma/migrations/20261019110000_attribute_read_foundation/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await client.query(migration);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      await client.query('SET search_path TO public');
      // Only the uniquely named schema created above is removed; no shared schema/data.
      if (!/^attribute_read_upgrade_\d+$/.test(schema))
        throw new Error('Unsafe test schema');
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
    }
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    await client.query('BEGIN');
  });
  afterEach(async () => {
    await client.query('ROLLBACK');
  });

  it('preserves existing metadata/options, initializes revision, and does not invent old audit history', async () => {
    expect(
      (
        await client.query(
          'SELECT name,revision FROM category_attribute_definitions WHERE id=1',
        )
      ).rows[0],
    ).toEqual({ name: 'Existing', revision: 1 });
    expect(
      (
        await client.query(
          'SELECT value FROM category_attribute_options WHERE id=1',
        )
      ).rows[0].value,
    ).toBe('USB');
    expect(
      (
        await client.query(
          'SELECT count(*)::int AS n FROM category_attribute_audits',
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('increments metadata once, preserves no-op, and supports one explicit CAS increment', async () => {
    await client.query(
      `UPDATE category_attribute_definitions SET name='New' WHERE id=1`,
    );
    await client.query(
      `UPDATE category_attribute_definitions SET name='New' WHERE id=1`,
    );
    expect(
      (
        await client.query(
          'SELECT revision FROM category_attribute_definitions WHERE id=1',
        )
      ).rows[0].revision,
    ).toBe(2);
    await client.query(
      `UPDATE category_attribute_definitions SET name='Newer',revision=3 WHERE id=1 AND revision=2`,
    );
    expect(
      (
        await client.query(
          'SELECT revision FROM category_attribute_definitions WHERE id=1',
        )
      ).rows[0].revision,
    ).toBe(3);
  });

  it('increments parent for actual option mutations but not no-op updates', async () => {
    await client.query(
      `UPDATE category_attribute_options SET value='USB' WHERE id=1`,
    );
    await client.query(
      `UPDATE category_attribute_options SET "isActive"=false WHERE id=1`,
    );
    expect(
      (
        await client.query(
          'SELECT revision FROM category_attribute_definitions WHERE id=1',
        )
      ).rows[0].revision,
    ).toBe(2);
  });

  it('rejects revision reset', async () => {
    await expect(
      client.query(
        'UPDATE category_attribute_definitions SET revision=0 WHERE id=1',
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'attribute_revision_monotonic',
    });
  });

  it('rejects option reparenting', async () => {
    await expect(
      client.query(
        'UPDATE category_attribute_options SET "attributeDefinitionId"=2 WHERE id=1',
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'attribute_option_parent_immutable',
    });
  });

  it('guards option revision overflow without leaving an option update behind', async () => {
    // Test-only bypass to arrange exhausted state; restore trigger before the operation.
    await client.query(
      'ALTER TABLE category_attribute_definitions DISABLE TRIGGER category_attribute_revision',
    );
    await client.query(
      'UPDATE category_attribute_definitions SET revision=2147483647 WHERE id=1',
    );
    await client.query(
      'ALTER TABLE category_attribute_definitions ENABLE TRIGGER category_attribute_revision',
    );
    await client.query('SAVEPOINT exhausted');
    await expect(
      client.query(
        `UPDATE category_attribute_options SET value='Changed' WHERE id=1`,
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'attribute_revision_exhausted',
    });
    await client.query('ROLLBACK TO SAVEPOINT exhausted');
    expect(
      (
        await client.query(
          'SELECT value FROM category_attribute_options WHERE id=1',
        )
      ).rows[0].value,
    ).toBe('USB');
  });

  it.each([
    "UPDATE category_attribute_audits SET reason='Changed'",
    'DELETE FROM category_attribute_audits',
  ])('freezes audit rows: %s', async (statement) => {
    await client.query(`INSERT INTO category_attribute_audits("actorId","categoryId","definitionId","entityType",command,revision,"correlationId","newValues")
      VALUES (1,1,1,'DEFINITION','CREATE',1,'00000000-0000-4000-8000-000000000001','{}')`);
    await expect(client.query(statement)).rejects.toMatchObject({
      code: '23514',
      constraint: 'attribute_audit_immutable',
    });
  });

  it('rejects OPTION audit with a missing option identity', async () => {
    await expect(
      client.query(`INSERT INTO category_attribute_audits("actorId","categoryId","definitionId","entityType",command,revision,"correlationId","newValues")
      VALUES (1,1,1,'OPTION','CREATE',1,'00000000-0000-4000-8000-000000000001','{}')`),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'attribute_audit_shape',
    });
  });
});
