// Isolated upgrade proof. No dotenv, no reset, no demo, no credentials in output.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = path.resolve(process.cwd(), '..');
const baseline = path.resolve(root, '../seller-onboarding-20261026/BE');
const req = createRequire(path.join(root, 'BE/package.json'));
const { Client } = req('pg');
const url = new URL(process.env.DATABASE_URL ?? '');
assert.equal(url.protocol, 'postgresql:');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '5549');
assert.equal(
  url.pathname,
  '/bckl_order_resolution_test_attributes_20261019_v956',
);
assert.equal(url.username, 'bckl_qa_migrator_20261021');
assert(
  !url.hash &&
    [...url.searchParams].every(([k, v]) => k === 'schema' && v === 'public') &&
    url.searchParams.getAll('schema').length <= 1,
);
for (const folder of [path.join(root, 'BE'), baseline])
  for (const env of ['.env', '../.env'])
    assert(!existsSync(path.resolve(folder, env)), 'Refusing dotenv');
assert.equal(
  readdirSync(path.join(baseline, 'prisma/migrations')).filter((n) =>
    /^\d/.test(n),
  ).length,
  28,
);
const db = new Client({ connectionString: url.toString() });
await db.connect();
const digest = (v) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
function migrate(config) {
  const p = spawnSync(
    process.execPath,
    [
      req.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--config',
      config,
    ],
    {
      cwd: path.join(root, 'BE'),
      env: process.env,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (p.status !== 0) throw Error('Scoped upgrade migration failed');
}
try {
  const role = (
    await db.query(
      'SELECT rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user',
    )
  ).rows[0];
  assert(!role.rolsuper && !role.rolcreaterole);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'",
      )
    ).rows[0].n,
    0,
    'Refusing existing target schema',
  );
  migrate(path.join(baseline, 'prisma.config.ts'));
  const marker = 'upgrade-' + Date.now() + '@example.invalid';
  const owner = (
    await db.query(
      'INSERT INTO users(email,"passwordHash",role,"updatedAt") VALUES($1,$2,\'SELLER\',CURRENT_TIMESTAMP) RETURNING id',
      [marker, 'NOT_A_LOGIN_FIXTURE'],
    )
  ).rows[0];
  const store = (
    await db.query(
      'INSERT INTO stores("sellerId",name,status,"updatedAt") VALUES($1,$2,\'ACTIVE\',CURRENT_TIMESTAMP) RETURNING id',
      [owner.id, 'Synthetic legacy Store without approval proof'],
    )
  ).rows[0];
  await db.query(
    'INSERT INTO store_status_history("storeId","fromStatus","toStatus","actorId",reason) VALUES($1,NULL,\'ACTIVE\',$2,$3)',
    [store.id, owner.id, 'Synthetic legacy snapshot, not a verified grant'],
  );
  const snapshot = async () => ({
    users: (await db.query('SELECT * FROM users ORDER BY id')).rows,
    stores: (await db.query('SELECT * FROM stores ORDER BY id')).rows,
    history: (await db.query('SELECT * FROM store_status_history ORDER BY id'))
      .rows,
    migrations: (
      await db.query(
        'SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name',
      )
    ).rows,
  });
  const before = await snapshot();
  assert.equal(before.migrations.length, 28);
  migrate(path.join(root, 'BE/prisma.config.ts'));
  const after = await snapshot();
  assert.equal(after.migrations.length, 29);
  assert.deepEqual(after.migrations.slice(0, 28), before.migrations);
  for (const key of ['users', 'stores', 'history'])
    assert.deepEqual(after[key], before[key]);
  for (const table of [
    'product_reviews',
    'product_review_audits',
    'product_review_commands',
    'product_review_replies',
  ])
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,
      0,
    );
  console.log(
    JSON.stringify({
      result: 'PASS',
      check: 'Prisma28to29ProductReviewUpgrade',
      database: url.pathname.slice(1),
      migrations: 29,
      legacyRowsPreserved: true,
      noSyntheticReviews: true,
      beforeDigest: digest({
        users: before.users,
        stores: before.stores,
        history: before.history,
      }),
      afterDigest: digest({
        users: after.users,
        stores: after.stores,
        history: after.history,
      }),
    }),
  );
} finally {
  await db.end();
}
