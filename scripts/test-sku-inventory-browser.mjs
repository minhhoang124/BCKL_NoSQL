// Isolated synthetic fixtures -> real Checkout/Order HTTP -> native Chrome Seller -> PG ledger.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';

const {values}=parseArgs({options:{output:{type:'string'},python:{type:'string'}}});
assert(values.output&&values.python,'Explicit output and Python executable required');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(values.output);
const rootIdentity=root.toLowerCase(),outIdentity=out.toLowerCase();
assert(outIdentity!==rootIdentity&&!outIdentity.startsWith(rootIdentity+path.sep),'Private fixture output must be outside checkout');
assert(!fs.existsSync(out),'Output must be new');fs.mkdirSync(out,{recursive:true});
const u=new URL(process.env.DATABASE_URL??'');
assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'5549');
assert.match(u.pathname,/^\/bckl_order_resolution_test_sku_inventory_20261030_[a-z0-9_]+$/);
assert.equal(u.username,'bckl_local_app');
assert(!u.hash&&[...u.searchParams].every(([k,v])=>k==='schema'&&v==='public')&&u.searchParams.getAll('schema').length<=1);
for(const f of ['.env','BE/.env','FE/.env','FE/.env.local'])assert(!fs.existsSync(path.join(root,f)),'Do not load local profile');
assert(process.env.JWT_ACCESS_SECRET&&process.env.JWT_REFRESH_SECRET);
const web='http://127.0.0.1:5198';
Object.assign(process.env,{FRONTEND_URL:web,CHECKOUT_CREATE_INTENTS_PER_MINUTE:'60',ORDER_COMMAND_RATE_PER_MINUTE:'200',SEARCH_SYNC_ENABLED:'false',SEARCH_RECONCILIATION_ENABLED:'false',PRODUCT_IMAGE_REPAIR_ENABLED:'false',ORDER_AUTO_COMPLETE_ENABLED:'false',EMAIL_NOTIFICATION_WORKER_ENABLED:'false',AUTH_GOOGLE_ENABLED:'false',AUTH_EMAIL_ENABLED:'false',AUTH_PHONE_OTP_SANDBOX_ENABLED:'false'});
const req=createRequire(path.join(root,'BE/package.json')),rf=createRequire(path.join(root,'FE/package.json'));
req('reflect-metadata');const load=p=>import(pathToFileURL(path.join(root,'BE/dist',p)).href);
const {AppModule}=await load('app.module.js'),{configureApp}=await load('configure-app.js'),{PrismaService}=await load('prisma.service.js'),{Test}=req('@nestjs/testing');
const files=['BE/src/product/seller-variant-inventory.service.ts','BE/src/product/seller-variant-inventory.controller.ts','BE/src/product/dto/update-product-variant.dto.ts','FE/src/features/seller-listing/variantInventoryApi.ts','FE/src/features/seller-listing/VariantInventoryEditor.tsx','FE/src/features/seller-listing/ProductDetailsEditor.tsx','FE/src/pages/SellerDashboardPage.tsx','scripts/test-sku-inventory-browser.mjs','scripts/test-sku-inventory-browser.py'];
const hashes=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
const sourceBefore=hashes(),marker='seller-close-'+randomUUID().slice(0,8),password='Qa-'+randomUUID()+'!';
let app,vite;const orders=[],probes=[];
try{
 app=(await Test.createTestingModule({imports:[AppModule]}).compile()).createNestApplication({bodyParser:false});configureApp(app);await app.listen(0,'127.0.0.1');
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
 const store=await db.store.create({data:{sellerId:actors.SELLER.id,name:'Synthetic SKU browser',status:'ACTIVE'}});
 const category=await db.category.create({data:{slug:marker,name:'Synthetic SKU QA'}});
 const products=[];
 for(const name of ['normal','lost-response','stale']){
  const p=await db.product.create({data:{storeId:store.id,categoryId:category.id,name:'QA SKU '+name,sellerStatus:'ACTIVE',moderationStatus:'APPROVED',images:{create:{url:'/uploads/qa-only.jpg',isPrimary:true}},shippingProfile:{create:{packageWeightGrams:100}}}});
  const v=await db.productVariant.create({data:{productId:p.id,storeId:store.id,skuCode:marker+'-'+name,optionSignature:'default',price:'10000',stock:5}});products.push({name,id:p.id,variantId:v.id});
 }
 process.env.VITE_API_URL=api;process.env.VITE_SELLER_VARIANT_INVENTORY_ENABLED='true';
 const {createServer}=await import(pathToFileURL(rf.resolve('vite')).href);vite=await createServer({root:path.join(root,'FE'),envDir:false,server:{host:'127.0.0.1',port:5198,strictPort:true}});await vite.listen();
 const fixture=path.join(out,'fixture.private.json');fs.writeFileSync(fixture,JSON.stringify({web,api,actors,products}));
 const code=await new Promise((resolve,reject)=>{const c=spawn(values.python,[path.join(root,'scripts/test-sku-inventory-browser.py'),'--fixture',fixture,'--output',out],{cwd:root,env:process.env,windowsHide:true,stdio:'inherit'});c.on('error',reject);c.on('exit',resolve);});assert.equal(code,0,'Native SKU acceptance failed');
 const ledger=[];
 for(const p of products){const record=await db.product.findUniqueOrThrow({where:{id:p.id},include:{variants:true}}), movements=await db.stockMovement.findMany({where:{variantId:p.variantId}}),events=await db.searchOutbox.findMany({where:{productId:p.id}});
  assert.equal(record.moderationStatus,'APPROVED');assert.equal(record.sellerStatus,'ACTIVE');assert.equal(record.version,2);assert.equal(record.variants[0].stock,p.name==='normal'?0:p.name==='lost-response'?7:8);assert.equal(record.variants[0].price.toFixed(2),p.name==='stale'?'17000.00':'12000.00');
  assert.equal(movements.length,1);assert.equal(movements[0].type,'MANUAL_ADJUSTMENT');assert.equal(movements[0].quantityDelta,record.variants[0].stock-5);assert.equal(movements[0].balanceAfter,record.variants[0].stock);assert.equal(events.length,1);assert.equal(events[0].operation,'UPSERT');assert.equal(events[0].version,2);ledger.push({name:p.name,productId:p.id,stock:record.variants[0].stock,price:record.variants[0].price.toFixed(2),movements:movements.length,events:events.length});
 }
 assert.equal(await db.order.count(),0);assert.deepEqual(hashes(),sourceBefore);
 fs.writeFileSync(path.join(out,'ledger-report.json'),JSON.stringify({result:'PASS',scope:'NATIVE_CHROME_HTTP_PG_SKU_QA',role:role.name,database:u.pathname,migrations:applied.length,sourceHashes:sourceBefore,ledger,limits:['Synthetic separateQA, no demo writes/providers','SearchOutbox enqueue proved; no liveES/FAISS consumption claim','No Order in browserfixture; realCheckout races covered separateDML35e2e']},null,2));console.log(JSON.stringify({result:'PASS',out,products:products.length}));
}finally{await vite?.close();await app?.close();}
