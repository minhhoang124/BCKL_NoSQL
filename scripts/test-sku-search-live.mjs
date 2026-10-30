// Isolated synthetic fixtures -> real Checkout/Order HTTP -> native Chrome Seller -> PG ledger.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import net from 'node:net';

const {values}=parseArgs({options:{output:{type:'string'},python:{type:'string'}}});
assert(values.output&&values.python,'Explicit output and Python executable required');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(values.output);
const rootIdentity=root.toLowerCase(),outIdentity=out.toLowerCase();
assert(outIdentity!==rootIdentity&&!outIdentity.startsWith(rootIdentity+path.sep),'Private fixture output must be outside checkout');
assert(!fs.existsSync(out),'Output must be new');fs.mkdirSync(out,{recursive:true});
const u=new URL(process.env.DATABASE_URL??'');
assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'5549');
assert.match(u.pathname,/^\/bckl_order_resolution_test_sku_search_20261030_[a-z0-9_]+$/);
assert.equal(u.username,'bckl_local_app');
assert(!u.hash&&[...u.searchParams].every(([k,v])=>k==='schema'&&v==='public')&&u.searchParams.getAll('schema').length<=1);
for(const f of ['.env','BE/.env','FE/.env','FE/.env.local'])assert(!fs.existsSync(path.join(root,f)),'Do not load local profile');
assert(process.env.JWT_ACCESS_SECRET&&process.env.JWT_REFRESH_SECRET);
const web='http://127.0.0.1:5198';process.env.AI_SERVICE_URL='http://127.0.0.1:8146';
Object.assign(process.env,{FRONTEND_URL:web,CHECKOUT_CREATE_INTENTS_PER_MINUTE:'60',ORDER_COMMAND_RATE_PER_MINUTE:'200',SEARCH_SYNC_ENABLED:'false',SEARCH_RECONCILIATION_ENABLED:'false',PRODUCT_IMAGE_REPAIR_ENABLED:'false',ORDER_AUTO_COMPLETE_ENABLED:'false',EMAIL_NOTIFICATION_WORKER_ENABLED:'false',NOTIFICATION_EMAIL_ENABLED:'false',NOTIFICATION_EMAIL_WORKER_ENABLED:'false',NOTIFICATIONS_WORKER_ENABLED:'false',AUTH_GOOGLE_ENABLED:'false',AUTH_EMAIL_ENABLED:'false',AUTH_PHONE_OTP_SANDBOX_ENABLED:'false'});
const req=createRequire(path.join(root,'BE/package.json')),rf=createRequire(path.join(root,'FE/package.json'));
req('reflect-metadata');const load=p=>import(pathToFileURL(path.join(root,'BE/dist',p)).href);
const {AppModule}=await load('app.module.js'),{configureApp}=await load('configure-app.js'),{PrismaService}=await load('prisma.service.js'),{Test}=req('@nestjs/testing');
const files=['BE/src/search/search-outbox.service.ts','BE/src/search/search-image-url-policy.ts','BE/src/search/search-reconciliation.service.ts','BE/src/search/search-sync.worker.ts','BE/src/product/seller-variant-inventory.service.ts','BE/src/product/product-image-storage.service.ts','BE/src/product/product.service.ts','BE/src/product/product-lifecycle.service.ts','scripts/test-sku-search-live.mjs'];
const hashes=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
const sourceBefore=hashes(),marker='seller-close-'+randomUUID().slice(0,8),password='Qa-'+randomUUID()+'!';
let app,vite,aiChild;const orders=[],probes=[];
try{
 app=(await Test.createTestingModule({imports:[AppModule]}).compile()).createNestApplication({bodyParser:false});configureApp(app);fs.mkdirSync(process.env.UPLOAD_ROOT,{recursive:true});app.useStaticAssets(process.env.UPLOAD_ROOT,{prefix:'/uploads/'});await app.listen(0,'127.0.0.1');
 const api=await app.getUrl(),db=app.get(PrismaService);
 const [role]=await db.$queryRaw`SELECT current_user name,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super,has_schema_privilege(current_user,'public','CREATE') ddl`;
 assert.equal(role.name,'bckl_local_app');assert(!role.super&&!role.ddl);
 const migrationNames=fs.readdirSync(path.join(root,'BE/prisma/migrations'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort();
 const applied=await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
 assert.deepEqual(applied.map(m=>m.migration_name),migrationNames,'Applied migrations must match source names exactly');
 assert.equal(await db.order.count(),0,'Use a fresh migrated QA DB, not an existing fixture/demo DB');
 const request=(endpoint,token,method='GET',body,key)=>fetch(api+endpoint,{method,headers:{'Content-Type':'application/json',Origin:web,...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const http=async(endpoint,token,method='GET',body,key)=>{const r=await request(endpoint,token,method,body,key);assert(r.ok,'Fixture HTTP '+r.status+' '+endpoint);return r.json();};
 const passwordHash=await req('bcryptjs').hash(password,10),actors={};
 for(const [name,roleName]of [['ADMIN','ADMIN'],['SELLER','SELLER'],['FOREIGN','SELLER'],['USER','USER']]){
  const a=await db.user.create({data:{email:marker+'-'+name.toLowerCase()+'@example.test',passwordHash,role:roleName}});
  const s=await http('/auth/login',null,'POST',{email:a.email,password});actors[name]={id:a.id,email:a.email,password,token:s.accessToken};
 }
 process.env.BACKEND_PUBLIC_URL=api;
 const sharp=req('sharp'),png=await sharp({create:{width:40,height:40,channels:3,background:{r:40,g:100,b:180}}}).png().toBuffer();fs.writeFileSync(path.join(process.env.UPLOAD_ROOT,'fixture.png'),png);
 const store=await db.store.create({data:{sellerId:actors.SELLER.id,name:'Synthetic Search SKU QA',status:'ACTIVE'}}),category=await db.category.create({data:{slug:marker,name:'Synthetic Search SKU'}});
 const {buildUpsertPayload}=await load('search/search-outbox.service.js'),{listingInclude}=await load('product/product-public-policy.js'),{SearchSyncWorker}=await load('search/search-sync.worker.js'),{SearchReconciliationService}=await load('search/search-reconciliation.service.js');
 const cats=await db.category.findMany({select:{id:true,parentId:true,isActive:true}});
 async function fixture(name){const p=await db.product.create({data:{storeId:store.id,categoryId:category.id,name:'Wireless speaker '+name,description:'Synthetic QA fixture not quality benchmark',sellerStatus:'ACTIVE',moderationStatus:'APPROVED',images:{create:{url:'/uploads/fixture.png',isPrimary:true}},shippingProfile:{create:{packageWeightGrams:100}},variants:{create:{skuCode:marker+'-'+name,optionSignature:'default',price:'10000',stock:5}}},include:listingInclude});const payload=buildUpsertPayload(p,cats);payload.imageUrls=['/uploads/fixture.png'];const old=await db.searchOutbox.create({data:{target:'SEARCH_SERVICE',operation:'UPSERT',productId:p.id,version:1,payload,status:'PENDING'}});return {p,v:p.variants[0],old};}
 const one=await fixture('one'),two=await fixture('two'),oldRows=JSON.stringify([one.old,two.old],(_,v)=>typeof v==='bigint'?v.toString():v);
 await new Promise((resolve,reject)=>{const guard=net.createServer();guard.once('error',reject);guard.listen(8146,'127.0.0.1',()=>guard.close(resolve));});
 const es='http://127.0.0.1:9200',esIndex='bckl-sku-search-qa-'+Date.now(),art=path.join(out,'ai-artifacts');fs.mkdirSync(art);
 const aiEnv={...process.env,AI_SERVICE_URL:'http://127.0.0.1:8146',AI_ARTIFACTS_DIR:art,AI_FAISS_INDEX_PATH:path.join(art,'products.faiss'),AI_FAISS_STATE_PATH:path.join(art,'faiss_state.json'),AI_PRODUCT_SYNC_STATE_PATH:path.join(art,'product_sync_state.json'),AI_ELASTICSEARCH_URL:es,ELASTICSEARCH_URL:es,AI_ELASTICSEARCH_INDEX_NAME:esIndex,ELASTICSEARCH_INDEX_NAME:esIndex,AI_INTERNAL_HEALTH_TOKEN:'',SEARCH_INTERNAL_HEALTH_TOKEN:'',AI_LOAD_RUNTIME_ON_STARTUP:'true',AI_IMAGE_URL_ALLOWED_HOSTS:'127.0.0.1,localhost',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',OMP_NUM_THREADS:'1'};
 const python=(code)=>execFileSync(values.python,['-c',code],{cwd:path.join(root,'AI_CLIP'),env:aiEnv,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const mapping=JSON.parse(python('import faiss,os,json;from app.services.elasticsearch_service import INDEX_MAPPING;faiss.write_index(faiss.IndexIDMap2(faiss.IndexFlatIP(512)),os.environ["AI_FAISS_INDEX_PATH"]);print(json.dumps(INDEX_MAPPING))'));
 const beforeIndex=await fetch(es+'/'+esIndex,{method:'HEAD'});assert.equal(beforeIndex.status,404);assert.equal((await fetch(es+'/'+esIndex,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(mapping)})).status,200);
 const aiOut=fs.openSync(path.join(out,'ai.stdout.private.log'),'w'),aiErr=fs.openSync(path.join(out,'ai.stderr.private.log'),'w');aiChild=spawn(values.python,['-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8146','--workers','1'],{cwd:path.join(root,'AI_CLIP'),env:aiEnv,windowsHide:true,stdio:['ignore',aiOut,aiErr]});fs.closeSync(aiOut);fs.closeSync(aiErr);
 const ai='http://127.0.0.1:8146';let ready=false;for(let i=0;i<90;i++){if(aiChild.exitCode!==null)throw Error('QA AI exited; inspect private log');try{const h=await (await fetch(ai+'/health',{signal:AbortSignal.timeout(1000)})).json();if(h.modelLoaded&&h.indexLoaded){assert.equal(h.vectorCount,0);ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}assert(ready,'QA AI real models not ready');
 const legacy=await fetch(ai+'/index/product',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(one.old.payload)});assert.equal(legacy.status,422);
 const checks=[];const worker=app.get(SearchSyncWorker),reconcile=app.get(SearchReconciliationService);
 async function dispatch(productId,version){const event=await db.searchOutbox.findFirstOrThrow({where:{productId,version}});assert(event.payload.imageUrls.every(u=>u.startsWith(api+'/uploads/')));await worker.processOne(event);const after=await db.searchOutbox.findUniqueOrThrow({where:{id:event.id}});assert.equal(after.status,'SUCCEEDED');assert.equal(after.attemptCount,1);const doc=await(await fetch(es+'/'+esIndex+'/_doc/'+productId)).json();assert.equal(doc._source.version,version);const state=JSON.parse(fs.readFileSync(aiEnv.AI_FAISS_STATE_PATH,'utf8'));assert.equal(state.products[String(productId)].version,version);const replay=await fetch(ai+'/index/product',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event.payload)});assert.equal(replay.status,200);assert.equal((await replay.json()).outcome,'NOOP');return doc._source;}
 async function edit(version,price,stock,expectedPrice,expectedStock){return http(`/seller/products/${one.p.id}/variants/${one.v.id}`,actors.SELLER.token,'PATCH',{expectedProductVersion:version,expectedPrice,expectedStock,price,stock,reason:'Synthetic QA price stock correction'});}
 await edit(1,'12000',0,'10000',5);let doc=await dispatch(one.p.id,2);assert.equal(Number(doc.minPrice),12000);assert.equal(Number(doc.maxPrice),12000);assert.equal(doc.inStock,false);checks.push('SKU zero stock and newprice -> real worker -> ES/FAISSv2 -> NOOP replay');
 await fetch(es+'/'+esIndex+'/_refresh',{method:'POST'});const outOfStockSearch=await http('/search/hybrid',null,'POST',{query:'wireless speaker',topK:10,candidateK:30,inStock:true});assert(!outOfStockSearch.items.some(row=>row.productId===one.p.id));
 await edit(2,'15000',7,'12000',0);doc=await dispatch(one.p.id,3);assert.equal(Number(doc.minPrice),15000);assert.equal(doc.inStock,true);checks.push('SKU restock and price -> ES/FAISSv3, no vector duplication');
 assert.equal(await reconcile.reconcileProduct(two.p.id),'CREATED');doc=await dispatch(two.p.id,2);assert.equal(Number(doc.minPrice),10000);assert.equal(await reconcile.reconcileProduct(two.p.id),'SKIPPED');checks.push('targeted reconciliation supersedes legacy payload once without churn');
 const oldAgain=await db.searchOutbox.findMany({where:{id:{in:[one.old.id,two.old.id]}},orderBy:{id:'asc'}});assert.equal(JSON.stringify(oldAgain,(_,v)=>typeof v==='bigint'?v.toString():v),oldRows);checks.push('historical event payload, status and attempts unchanged');
 await fetch(es+'/'+esIndex+'/_refresh',{method:'POST'});let search=await http('/search/hybrid',null,'POST',{query:'wireless speaker',topK:10,candidateK:30,minPrice:14000,inStock:true});assert(search.items.some(row=>row.productId===one.p.id));assert(!search.items.some(row=>row.productId===two.p.id));checks.push('Backend hybrid with real CLIP and price/stock filtering');
 const forbidden={...one.old.payload,version:99,imageUrls:['http://not-allowed.invalid/fixture.png']};const denied=await fetch(ai+'/index/product',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(forbidden)});assert.equal(denied.status,422);checks.push('AI forbidden host still denied');
  const indexBytesBefore=createHash('sha256').update(fs.readFileSync(aiEnv.AI_FAISS_INDEX_PATH)).digest('hex');
 await worker.runBatch();
 for(const legacyRow of [one.old,two.old]){const old=await db.searchOutbox.findUniqueOrThrow({where:{id:legacyRow.id}});assert.equal(old.status,'FAILED');assert(old.processedAt);assert.equal(old.attemptCount,1);assert.deepEqual(old.payload,legacyRow.payload);assert.match(old.lastError,/HTTP 422/);}
 assert.equal(createHash('sha256').update(fs.readFileSync(aiEnv.AI_FAISS_INDEX_PATH)).digest('hex'),indexBytesBefore);checks.push('normal worker classifies superseded historical422 terminal, payload and currentindex unchanged');
 const bad=await fixture('bad-path');await db.productImage.updateMany({where:{productId:bad.p.id},data:{url:'/uploads/../not-managed.png'}});
 const beforeBad=JSON.stringify({p:await db.product.findUnique({where:{id:bad.p.id},include:{variants:true}}),moves:await db.stockMovement.findMany({where:{variantId:bad.v.id}}),events:await db.searchOutbox.findMany({where:{productId:bad.p.id}})},(_,v)=>typeof v==='bigint'?v.toString():v);
 const badEdit=await request(`/seller/products/${bad.p.id}/variants/${bad.v.id}`,actors.SELLER.token,'PATCH',{expectedProductVersion:1,expectedPrice:'10000',expectedStock:5,price:'13000',stock:8,reason:'Synthetic bad image rollback'});assert.equal(badEdit.status,400);
 const afterBad=JSON.stringify({p:await db.product.findUnique({where:{id:bad.p.id},include:{variants:true}}),moves:await db.stockMovement.findMany({where:{variantId:bad.v.id}}),events:await db.searchOutbox.findMany({where:{productId:bad.p.id}})},(_,v)=>typeof v==='bigint'?v.toString():v);assert.equal(afterBad,beforeBad);checks.push('invalid managed URL rolls back SKU price/stock/version/ledger/outbox together');
 const newProduct=await http('/seller/products',actors.SELLER.token,'POST',{name:'Wireless speaker uploaded WebP',categoryId:category.id});
 const webp=await sharp({create:{width:48,height:48,channels:4,background:{r:120,g:30,b:170,alpha:0.5}}}).webp({lossless:true}).toBuffer();
 const form=new FormData();form.set('file',new Blob([webp],{type:'image/webp'}),'fixture.webp');form.set('isPrimary','true');form.set('sortOrder','0');
 const upload=await fetch(api+`/seller/products/${newProduct.id}/images`,{method:'POST',headers:{Authorization:'Bearer '+actors.SELLER.token,Origin:web},body:form});assert.equal(upload.status,201);const uploaded=await upload.json();assert.match(uploaded.url,/\.png$/);
 const media=await fetch(uploaded.url);assert.equal(media.status,200);assert.match(media.headers.get('content-type'),/^image\/png/);const storedBytes=Buffer.from(await media.arrayBuffer());assert.equal((await sharp(storedBytes).metadata()).format,'png');
 await http(`/seller/products/${newProduct.id}/variants`,actors.SELLER.token,'POST',{price:'8000',stock:3,optionValueIds:[]});
 await http(`/seller/products/${newProduct.id}/shipping-profile`,actors.SELLER.token,'PATCH',{packageWeightGrams:100});
 await http(`/seller/products/${newProduct.id}/submit`,actors.SELLER.token,'POST',{});const pendingProduct=await http(`/seller/products/${newProduct.id}`,actors.SELLER.token);
 await http(`/admin/products/${newProduct.id}/approve`,actors.ADMIN.token,'POST',{version:pendingProduct.version});const published=await db.product.findUniqueOrThrow({where:{id:newProduct.id}});const uploadedDoc=await dispatch(newProduct.id,published.version);assert.equal(Number(uploadedDoc.minPrice),8000);assert.equal(uploadedDoc.inStock,true);checks.push('actual WebP upload -> stored PNG HTTP -> Seller submit/Admin approve -> CLIP/ES/FAISS and NOOP');
 const h=await(await fetch(ai+'/health')).json();assert.equal(h.vectorCount,3);assert.equal(await db.order.count(),0);assert.equal(await db.payment.count(),0);assert.equal(await db.stockMovement.count({where:{type:'MANUAL_ADJUSTMENT'}}),2);assert.deepEqual(hashes(),sourceBefore);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({result:'PASS',scope:'REAL_PG_SKU_HTTP_OUTBOX_CLIP_ES_FAISS_QA',sourceHashes:sourceBefore,database:u.pathname,role:role.name,migrations:applied.length,index:esIndex,modelLoaded:h.modelLoaded,vectorCount:h.vectorCount,checks,legacyEventsPreservedBeforeDispatch:2,legacyPayloadsUnchangedAfterTerminalDispatch:2,orders:0,payments:0,limits:['Synthetic fixtures and three indexed products, not retrieval quality benchmark','Only exact new events dispatched, no demo/index86 writes','Historical rows unchanged by producer/reconciliation; later normalworker classifies422 terminal, payload unchanged','WebP actual upload normalized to PNG by Backend; public image-query JPEG/PNG contract unchanged']},null,2));console.log(JSON.stringify({result:'PASS',out,checks:checks.length,vectorCount:h.vectorCount}));
}finally{aiChild?.kill();await app?.close();}
