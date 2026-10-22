// Isolated SQL prototype. Not the Accounts API, JWT implementation or migration.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../package.json', import.meta.url));
const { Pool } = require('pg');
const target = new URL(process.env.DATABASE_URL ?? '');
assert.equal(target.protocol, 'postgresql:'); assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '5549'); assert.equal(target.pathname, '/bckl_order_resolution_test_account_status_protocol');
assert(!target.search && !target.hash);
const pool = new Pool({ connectionString: target.href, max: 6 });
const schema = `status_probe_${randomUUID().replaceAll('-', '')}`;
const t = name => `"${schema}"."${name}"`;
const results = [];
async function transaction(work) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await c.query("SET LOCAL statement_timeout='3000ms'");
      const value = await work(c); await c.query('COMMIT'); return value;
    } catch (error) {
      await c.query('ROLLBACK');
      if (!['40001','40P01'].includes(error.code) || attempt === 2) throw error;
    } finally { c.release(); }
  }
}
async function status(actorId, targetId, active, expected, fault) {
  return transaction(async c => {
    await c.query('SELECT pg_advisory_xact_lock(20261021,21)');
    const rows = (await c.query(`SELECT * FROM ${t('account')} WHERE id IN($1,$2) OR role='ADMIN' ORDER BY id FOR UPDATE`, [actorId,targetId])).rows;
    const actor = rows.find(x=>x.id===actorId), account=rows.find(x=>x.id===targetId);
    if (!actor?.active || actor.role !== 'ADMIN') return 'ACTOR_FORBIDDEN';
    if (!account) return 'NOT_FOUND';
    if (account.revision !== expected) return 'STALE';
    if (account.active === active) return 'NO_OP';
    if (!active && actorId===targetId) return 'SELF_LOCK';
    if (!active && account.role==='ADMIN' && rows.filter(x=>x.role==='ADMIN' && x.active).length<=1) return 'LAST_ADMIN';
    if (account.revision===2147483647 || (!active && account.epoch===2147483647)) return 'EXHAUSTED';
    await c.query(`UPDATE ${t('account')} SET active=$2,revision=revision+1,epoch=epoch+$3 WHERE id=$1`, [targetId,active,active?0:1]);
    if (!active) await c.query(`UPDATE ${t('token')} SET revoked=true WHERE user_id=$1`,[targetId]);
    if(fault==='revoke') throw Error('INJECTED_FAILURE');
    await c.query(`INSERT INTO ${t('audit')}(user_id,revision) VALUES($1,$2)`,[targetId,expected+1]);
    if(fault==='audit') throw Error('INJECTED_FAILURE');
    await c.query(`INSERT INTO ${t('job')}(user_id,revision) VALUES($1,$2)`,[targetId,expected+1]);
    if(fault==='job') throw Error('INJECTED_FAILURE');
    return 'CHANGED';
  });
}
async function refresh(userId, epoch, onLocked) {
  return transaction(async c=>{
    const user=(await c.query(`SELECT * FROM ${t('account')} WHERE id=$1 FOR UPDATE`,[userId])).rows[0];
    if(onLocked) await onLocked();
    if(!user.active || user.epoch!==epoch) return 'REFUSED';
    await c.query(`INSERT INTO ${t('token')}(user_id,epoch,revoked) VALUES($1,$2,false)`,[userId,epoch]);
    return 'ISSUED';
  });
}
const latch=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
async function reset(){
  await pool.query(`TRUNCATE ${t('token')},${t('audit')},${t('job')},${t('account')} RESTART IDENTITY CASCADE;
    INSERT INTO ${t('account')} VALUES(1,'ADMIN',true,1,0),(2,'ADMIN',true,1,0),(3,'USER',true,1,0);
    INSERT INTO ${t('token')}(user_id,epoch,revoked) VALUES(3,0,false)`);
}
async function snapshot(){return Promise.all(['account','token','audit','job'].map(async name=>(await pool.query(`SELECT * FROM ${t(name)} ORDER BY 1,2`)).rows));}
try {
  await pool.query(`CREATE SCHEMA "${schema}";
    CREATE TABLE ${t('account')}(id int PRIMARY KEY,role text NOT NULL,active boolean NOT NULL,revision int NOT NULL,epoch int NOT NULL);
    CREATE TABLE ${t('token')}(id serial PRIMARY KEY,user_id int REFERENCES ${t('account')}(id),epoch int,revoked boolean);
    CREATE TABLE ${t('audit')}(user_id int,revision int,PRIMARY KEY(user_id,revision));
    CREATE TABLE ${t('job')}(user_id int,revision int,PRIMARY KEY(user_id,revision));`);
  await reset();
  const crossing=await Promise.all([status(1,2,false,1),status(2,1,false,1)]);
  assert.deepEqual(crossing.sort(),['ACTOR_FORBIDDEN','CHANGED']);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${t('account')} WHERE role='ADMIN' AND active`)).rows[0].n,1);
  results.push('two Admins locking each other: one commit, one current-actor refusal, at least one Admin remains');
  await reset();
  assert.deepEqual((await Promise.all([status(1,3,false,1),status(2,3,false,1)])).sort(),['CHANGED','STALE']);
  const before=await snapshot(); assert.equal(await status(1,3,false,2),'NO_OP'); assert.deepEqual(await snapshot(),before);
  assert.equal(await status(1,1,false,1),'SELF_LOCK');
  results.push('same revision: one change; no-op/stale/self-lock do not create extra work');
  for(const fault of ['audit','job','revoke']){
    await reset();const original=await snapshot();await assert.rejects(status(1,3,false,1,fault),/INJECTED_FAILURE/);assert.deepEqual(await snapshot(),original);
  }
  results.push('audit/job/revoke fault restores state, revision, epoch and tokens');
  await reset(); assert.equal(await status(1,3,false,1),'CHANGED'); assert.equal(await status(1,3,true,2),'CHANGED');
  assert.equal(await refresh(3,0),'REFUSED'); assert.equal(await refresh(3,1),'ISSUED');
  results.push('lock-unlock does not revive epoch0; new epoch can issue token (SQL only)');
  await reset();const entered=latch(),release=latch();let initial=true;
  const issuing=refresh(3,0,async()=>{if(initial){initial=false;entered.release();await release.promise;}});
  await entered.promise;const locking=status(1,3,false,1);release.release();
  assert.equal(await issuing,'ISSUED');assert.equal(await locking,'CHANGED');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${t('token')} WHERE user_id=3 AND NOT revoked`)).rows[0].n,0);
  assert.equal(await refresh(3,0),'REFUSED');
  results.push('refresh holds User first: later lock revokes issued token; refresh after lock refused');
  for(const column of ['revision','epoch']) {
    await reset();
    await pool.query(`UPDATE ${t('account')} SET ${column}=2147483647 WHERE id=3`);
    const before=await snapshot();
    assert.equal(await status(1,3,false,column==='revision'?2147483647:1),'EXHAUSTED');
    assert.deepEqual(await snapshot(),before);
  }
  results.push('revision/epoch integer exhaustion fails without wrap, revoke or partial write');
  console.log(JSON.stringify({status:'PASS',groups:results,limitations:['fixture tables only','no JWT/signature/HTTP/Prisma runtime proof','no migration or token rollout performed']},null,2));
} finally {await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await pool.end();}
