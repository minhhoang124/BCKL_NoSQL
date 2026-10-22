// SQL experiment only; no Chat runtime, auth, migration or messaging acceptance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../package.json', import.meta.url));
const { Pool } = require('pg');
const url = new URL(process.env.DATABASE_URL ?? '');
assert.equal(url.protocol, 'postgresql:');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '5549');
assert.equal(url.pathname, '/bckl_order_resolution_test_chat_sequence');
assert(!url.search && !url.hash);
const pool = new Pool({ connectionString: url.href, max: 8 });
const schema = `chat_probe_${randomUUID().replaceAll('-', '')}`;
const t = name => `"${schema}"."${name}"`;
const results = [];
async function send(conversation, key, body, fault = false) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='3000ms'");
    const parent = (await client.query(`SELECT last_seq FROM ${t('conversation')} WHERE id=$1 FOR UPDATE`, [conversation])).rows[0];
    assert(parent);
    const existing = (await client.query(`SELECT * FROM ${t('message')} WHERE conversation_id=$1 AND client_key=$2`, [conversation, key])).rows[0];
    if (existing) {
      if (existing.body !== body) throw new Error('PAYLOAD_CONFLICT');
      await client.query('COMMIT'); return { id: existing.id, sequence: existing.seq, replayed: true };
    }
    const sequence = parent.last_seq + 1;
    const row = (await client.query(`INSERT INTO ${t('message')}(conversation_id,seq,client_key,body) VALUES($1,$2,$3,$4) RETURNING id`, [conversation, sequence, key, body])).rows[0];
    await client.query(`UPDATE ${t('conversation')} SET last_seq=$2 WHERE id=$1`, [conversation, sequence]);
    if (fault) throw new Error('INJECTED_FAILURE');
    await client.query('COMMIT');
    return { id: row.id, sequence, replayed: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
try {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`CREATE TABLE ${t('conversation')}(id int PRIMARY KEY,last_seq int NOT NULL DEFAULT 0 CHECK(last_seq>=0));`);
  await pool.query(`CREATE TABLE ${t('message')}(id serial PRIMARY KEY, conversation_id int NOT NULL REFERENCES ${t('conversation')}(id),seq int NOT NULL,client_key text NOT NULL,body text NOT NULL,UNIQUE(conversation_id,seq),UNIQUE(conversation_id,client_key)); INSERT INTO ${t('conversation')}(id) VALUES(1),(2)`);
  const concurrent = await Promise.all([1,2,3,4,5].map(n => send(1, `key-${n}`, `text-${n}`)));
  assert.deepEqual(concurrent.map(x => x.sequence).sort((a,b) => a-b), [1,2,3,4,5]);
  results.push('5 concurrent writers: per-conversation committed sequence1..5');
  const replay = await Promise.all([send(1,'key-1','text-1'),send(1,'key-1','text-1')]);
  assert(replay.every(x => x.replayed && x.id === concurrent[0].id));
  await assert.rejects(send(1,'key-1','different'), /PAYLOAD_CONFLICT/);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${t('message')} WHERE conversation_id=1`)).rows[0].n,5);
  results.push('replay same payload keeps one row; changed payload rejected');
  await assert.rejects(send(1,'failed','text',true), /INJECTED_FAILURE/);
  const next = await send(1,'after-rollback','text'); assert.equal(next.sequence,6);
  assert(next.id > 6); // serial ID can have a rollback gap, sequence does not.
  results.push('rollback restores parent sequence; global serial ID is not the cursor');
  const page1=(await pool.query(`SELECT seq FROM ${t('message')} WHERE conversation_id=1 AND seq>0 ORDER BY seq LIMIT 2`)).rows;
  const page2=(await pool.query(`SELECT seq FROM ${t('message')} WHERE conversation_id=1 AND seq>$1 ORDER BY seq LIMIT 2`,[page1.at(-1).seq])).rows;
  assert.deepEqual([...page1,...page2].map(x=>x.seq),[1,2,3,4]);
  const other=await send(2,'key-1','other'); assert.equal(other.sequence,1);
  results.push('cursor pages remain ordered and sequences are conversation-scoped');
  console.log(JSON.stringify({ status:'PASS', tests:results, limitations:['fixture schema only','no actual Chat API/auth/socket/read state','not a migration or production locking proof'] },null,2));
} finally {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
}
