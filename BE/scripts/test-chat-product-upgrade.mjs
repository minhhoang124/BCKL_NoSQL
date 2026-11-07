// SQL21 ->22 compatibility probe. Unique retained QA schema; no dotenv/reset.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
const target = new URL(process.env.DATABASE_URL ?? '');
assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '5549');
assert.equal(target.pathname, '/bckl_order_resolution_test_attributes_20261019_v944');
assert(!target.hash && [...target.searchParams].every(([k,v]) => k === 'schema' && v === 'public'));
const db = new Client({ connectionString: target.toString() });
await db.connect();
const schema = 'chat_product_upgrade_' + randomUUID().replaceAll('-', '');
try {
  assert.equal((await db.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper, false);
  await db.query(`CREATE SCHEMA "${schema}"`);
  await db.query(`SET search_path TO "${schema}"`);
  // Prerequisite PKs are synthetic; all Chat tables/triggers use actual SQL20/21.
  await db.query('CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE stores(id INTEGER PRIMARY KEY)');
  for (const migration of ['20261023150000_chat_text_runtime','20261023153000_chat_parent_fence'])
    await db.query(await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), 'utf8'));
  await db.query('INSERT INTO users VALUES (1),(2); INSERT INTO stores VALUES (1)');
  await db.query('INSERT INTO chat_conversations("buyerId","storeId") VALUES (1,1)');
  await db.query(`INSERT INTO chat_messages("conversationId",sequence,"senderId","senderType","clientMessageId",content,"payloadHash")
    VALUES(1,1,1,'BUYER','pre-upgrade-key','Legacy TEXT',$1)`, ['a'.repeat(64)]);
  await db.query('INSERT INTO chat_read_states VALUES(1,2,1,1,CURRENT_TIMESTAMP)');
  const before = (await db.query('SELECT * FROM chat_messages')).rows;
  const cursor = (await db.query('SELECT * FROM chat_read_states')).rows;
  await db.query(await readFile(new URL('../prisma/migrations/20261024110000_chat_product_context/migration.sql', import.meta.url), 'utf8'));
  const after = (await db.query('SELECT * FROM chat_messages')).rows;
  assert.equal(after[0].contextProductId, null); delete after[0].contextProductId;
  assert.deepEqual(after, before);
  assert.deepEqual((await db.query('SELECT * FROM chat_read_states')).rows, cursor);
  await assert.rejects(db.query('UPDATE chat_messages SET "contextProductId"=1 WHERE id=1'));
  assert.equal((await db.query('SELECT "lastSequence" FROM chat_conversations WHERE id=1')).rows[0].lastSequence, 1);
  console.log(JSON.stringify({ result: 'PASS', check: 'RealChatSQL21to22', preservedTextAndReadCursor: true, schemaRetained: schema,
    limitation: 'Synthetic prerequisite User/Store PKs; not full Prisma19-to22 or app restart proof' }));
} finally { await db.end(); }
