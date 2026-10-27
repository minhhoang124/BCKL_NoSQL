// Fresh isolated target only: preserve legacy auth records during migration 34 -> 35.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const be=process.cwd(),baseline=path.resolve(be,'../../auth-google-20261027/BE'),req=createRequire(path.join(be,'package.json')),{Client}=req('pg'),u=new URL(process.env.DATABASE_URL??'');
assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'5549');assert.equal(u.username,'bckl_qa_migrator_20261021');assert.equal(u.pathname,'/bckl_order_resolution_test_attributes_20261019_v966');assert(!u.hash&&[...u.searchParams].every(([k,v])=>k==='schema'&&v==='public')&&u.searchParams.getAll('schema').length<=1);
for(const folder of [be,baseline])for(const f of ['.env','../.env'])assert(!existsSync(path.resolve(folder,f)),'Refusing dotenv');
assert.equal(readdirSync(path.join(baseline,'prisma/migrations')).filter(n=>/^\d/.test(n)).length,34);
function migrate(folder){const p=spawnSync(process.execPath,[req.resolve('prisma/build/index.js'),'migrate','deploy'],{cwd:folder,env:process.env,encoding:'utf8',windowsHide:true});if(p.status!==0)throw Error('Isolated migration failed; details withheld');}
const db=new Client({connectionString:u.toString()});await db.connect();
try{
 const role=(await db.query('SELECT rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];assert(!role.rolsuper&&!role.rolcreaterole);
 assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,0,'Refusing an existing schema');
 migrate(baseline);
 const user=(await db.query('INSERT INTO users(email,"passwordHash",role,"updatedAt") VALUES($1,$2,\'USER\',CURRENT_TIMESTAMP) RETURNING id',['phone-upgrade-'+randomUUID()+'@example.invalid','NOT_A_LOGIN_FIXTURE'])).rows[0];
 await db.query('INSERT INTO google_identities(id,"userId",provider,subject,"emailSnapshot") VALUES($1,$2,\'GOOGLE\',$3,$4)',[randomUUID(),user.id,'synthetic-'+randomUUID(),'synthetic@example.invalid']);
 await db.query('INSERT INTO refresh_tokens("tokenHash","userId","expiresAt") VALUES($1,$2,CURRENT_TIMESTAMP+INTERVAL \'1 day\')',['synthetic-'+randomUUID(),user.id]);
 const snapshot=async()=>{const out={};for(const t of ['users','google_identities','refresh_tokens','auth_email_tokens','orders','payments','stock_movements','search_outbox'])out[t]=(await db.query(`SELECT md5(COALESCE(jsonb_agg(t ORDER BY id)::text,'[]')) digest FROM "${t}" t`)).rows[0].digest;return out;};
 const before=await snapshot(),checksums=(await db.query('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')).rows;assert.equal(checksums.length,34);
 migrate(be);assert.deepEqual(await snapshot(),before);const after=(await db.query('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')).rows;assert.equal(after.length,35);assert.deepEqual(after.filter(x=>x.migration_name!=='20261027130000_phone_otp_sandbox'),checksums);
 for(const t of ['phone_otp_challenges','user_phone_contacts','phone_otp_rates'])assert.equal((await db.query(`SELECT count(*)::int n FROM "${t}"`)).rows[0].n,0);
 console.log(JSON.stringify({result:'PASS',upgrade:'34->35',legacyAuthAndFinancialDigestsUnchanged:true,previousMigrationChecksumsUnchanged:true,database:'QA_v966'}));
}finally{await db.end();}
