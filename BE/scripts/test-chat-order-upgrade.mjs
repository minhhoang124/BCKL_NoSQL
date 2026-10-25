// Actual SQL22 ->23 preservation probe in a unique retained schema, QA only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
const target = new URL(process.env.DATABASE_URL ?? '');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '5549');
assert.equal(
  target.pathname,
  '/bckl_order_resolution_test_attributes_20261019_v945',
);
assert(
  !target.hash &&
    [...target.searchParams].every(
      ([k, v]) => k === 'schema' && v === 'public',
    ),
);
const db = new Client({ connectionString: target.toString() }),
  schema = 'chat_order_upgrade_' + randomUUID().replaceAll('-', '');
await db.connect();
try {
  assert.equal(
    (await db.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user'))
      .rows[0].rolsuper,
    false,
  );
  await db.query(`CREATE SCHEMA "${schema}"`);
  await db.query(`SET search_path TO "${schema}"`);
  await db.query(
    'CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE stores(id INTEGER PRIMARY KEY)',
  );
  for (const migration of [
    '20261023150000_chat_text_runtime',
    '20261023153000_chat_parent_fence',
    '20261024110000_chat_product_context',
  ])
    await db.query(
      await readFile(
        new URL(
          `../prisma/migrations/${migration}/migration.sql`,
          import.meta.url,
        ),
        'utf8',
      ),
    );
  await db.query(
    'INSERT INTO users VALUES(1),(2); INSERT INTO stores VALUES(1)',
  );
  await db.query(
    'INSERT INTO chat_conversations("buyerId","storeId") VALUES(1,1)',
  );
  await db.query(
    `INSERT INTO chat_messages("conversationId",sequence,"senderId","senderType","clientMessageId",content,"payloadHash") VALUES(1,1,1,'BUYER','old-text','Legacy TEXT',$1)`,
    ['a'.repeat(64)],
  );
  await db.query(
    `INSERT INTO chat_messages("conversationId",sequence,"senderId","senderType","clientMessageId",content,"contextProductId","payloadHash") VALUES(1,2,2,'SELLER','old-product','Đã chia sẻ sản phẩm',125,$1)`,
    ['b'.repeat(64)],
  );
  await db.query(
    'INSERT INTO chat_read_states VALUES(1,1,2,2,CURRENT_TIMESTAMP)',
  );
  const before = (
      await db.query('SELECT * FROM chat_messages ORDER BY sequence')
    ).rows,
    reads = (await db.query('SELECT * FROM chat_read_states')).rows;
  await db.query(
    await readFile(
      new URL(
        '../prisma/migrations/20261024170000_chat_order_context/migration.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const after = (
    await db.query('SELECT * FROM chat_messages ORDER BY sequence')
  ).rows;
  for (const row of after) {
    assert.equal(row.contextOrderId, null);
    delete row.contextOrderId;
  }
  assert.deepEqual(after, before);
  assert.deepEqual(
    (await db.query('SELECT * FROM chat_read_states')).rows,
    reads,
  );
  await assert.rejects(
    db.query('UPDATE chat_messages SET "contextOrderId"=8 WHERE id=1'),
  );
  console.log(
    JSON.stringify({
      result: 'PASS',
      check: 'RealChatSQL22to23',
      preservedTextProductReadCursor: true,
      schemaRetained: schema,
      limitation:
        'Synthetic User/Store prerequisites; not a full app/process crash migration proof',
    }),
  );
} finally {
  await db.end();
}
