// Real Chrome / Nest / isolated PostgreSQL. Synthetic data retained; never dotenv/reset.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import path from 'node:path';
const {values}=parseArgs({options:{output:{type:'string'},'playwright-module':{type:'string'}}});
assert(values.output && values['playwright-module']);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), url=new URL(process.env.DATABASE_URL ?? '');
assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5549');
assert.equal(url.pathname,'/bckl_order_resolution_test_attributes_20261019_v957');assert.equal(url.username,'bckl_qa_app_20261021');
assert(!url.hash && [...url.searchParams].every(([k,v])=> k==='schema' && v==='public') && url.searchParams.getAll('schema').length<=1);
for(const f of ['.env','BE/.env','FE/.env','FE/.env.local']) try{await access(path.join(root,f));throw Error('Refusing dotenv checkout');}catch(e){if(e.code!=='ENOENT')throw e;}
for(const flag of ['SEARCH_SYNC_ENABLED','SEARCH_RECONCILIATION_ENABLED','PRODUCT_IMAGE_REPAIR_ENABLED','ORDER_AUTO_COMPLETE_ENABLED'])assert.equal(process.env[flag],'false');
process.env.NOTIFICATIONS_ENABLED='true';process.env.NOTIFICATIONS_WORKER_ENABLED='false';process.env.ACCOUNT_BUYER_ACCESS_ENABLED='true';
const output=path.resolve(values.output);await assert.rejects(access(output));await mkdir(output,{recursive:true});
const rb=createRequire(path.join(root,'BE/package.json')),rf=createRequire(path.join(root,'FE/package.json'));
rb('reflect-metadata');const {Test}=rb('@nestjs/testing'),{hash}=rb('bcryptjs');
const load=n=>import(pathToFileURL(path.join(root,'BE/dist',n)).href);
const {AppModule}=await load('app.module.js'),{configureApp}=await load('configure-app.js'),{PrismaService}=await load('prisma.service.js');
const {createServer}=await import(pathToFileURL(rf.resolve('vite')).href),{default:react}=await import(pathToFileURL(rf.resolve('@vitejs/plugin-react')).href),pw=await import(pathToFileURL(path.resolve(values['playwright-module'])).href);
const api='http://127.0.0.1:3390',web='http://127.0.0.1:5190';process.env.FRONTEND_URL=web;
const files=['FE/src/features/notifications/notificationClient.ts','FE/src/features/notifications/NotificationsPage.tsx','FE/src/features/notifications/NotificationsPage.module.css','FE/src/components/Header/Header.tsx','FE/src/routes/AppRouter.tsx','BE/src/notification/notification.service.ts','BE/src/notification/notification-projector.ts','BE/src/notification/notification-sources.ts','scripts/test-notifications-browser.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(path.join(root,f))).digest('hex')])));
const sourceHashes=await hashes(),results=[],contexts=[],pages={},pageErrors=[];
let app,vite,browser;
try{
  app=(await Test.createTestingModule({imports:[AppModule]}).compile()).createNestApplication();configureApp(app);await app.listen(3390,'127.0.0.1');const db=app.get(PrismaService);
  const [role]=await db.$queryRaw`SELECT current_database() AS name,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
  assert.equal(role.name,url.pathname.slice(1));assert(!role.rolsuper&&!role.rolcreatedb&&!role.rolcreaterole);
  const [m]=await db.$queryRaw`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL`;assert.equal(m.n,30);
  const password=randomBytes(20).toString('hex'),passwordHash=await hash(password,4),marker=randomUUID();
  async function actor(name,role){return db.user.create({data:{email:`notification-${name.toLowerCase()}-${marker}@example.invalid`,passwordHash,role,fullName:`Synthetic QA ${name}`}});}
  const buyer=await actor('Buyer','USER'),seller=await actor('Seller','SELLER'),admin=await actor('Admin','ADMIN'),other=await actor('Other','USER');
  const store=await db.store.create({data:{sellerId:seller.id,name:'Synthetic Notification Store',status:'ACTIVE'}});
  await db.storeStatusHistory.create({data:{storeId:store.id,fromStatus:'PENDING',toStatus:'ACTIVE',actorId:admin.id,reason:'PRIVATE_MODERATION_REASON'}});
  const category=await db.category.create({data:{name:'Notification '+marker,slug:'notification-'+marker}});
  const product=await db.product.create({data:{storeId:store.id,categoryId:category.id,name:'Synthetic Notification Product'}});
  const variant=await db.productVariant.create({data:{productId:product.id,storeId:store.id,skuCode:'notification-'+marker,optionSignature:'[]',price:'50000.00',stock:5}});
  const checkout=await db.checkout.create({data:{buyerId:buyer.id,idempotencyKey:marker,requestHash:'notification-synthetic'}});
  const order=await db.order.create({data:{checkoutId:checkout.id,buyerId:buyer.id,storeId:store.id,orderNumber:'notification-'+marker,status:'PENDING_CONFIRMATION',recipientNameSnapshot:'PRIVATE_BUYER',phoneSnapshot:'0000000000',provinceSnapshot:'QA',wardSnapshot:'QA',addressLineSnapshot:'PRIVATE_ADDRESS',subtotal:'50000.00',shippingFee:'10000.00',total:'60000.00',payment:{create:{provider:'COD',status:'UNPAID',amount:'60000.00'}},items:{create:{productId:product.id,variantId:variant.id,quantity:1,unitPrice:'50000.00',lineTotal:'50000.00',productNameSnapshot:'Synthetic Notification Item',skuSnapshot:variant.skuCode,optionSnapshot:[]}}}});
  const events=Array.from({length:23},()=>({orderId:order.id,fromStatus:'PENDING_CONFIRMATION',toStatus:'CONFIRMED',actorId:seller.id,actorType:null,reason:'PRIVATE_ORDER_REASON'}));
  await db.orderStatusHistory.createMany({data:events}); // Legal compatible legacy history fixtures, not claimed as modern command workflow.
  const pendingSeller=await actor('PendingSeller','USER');
  const pendingStore=await db.store.create({data:{sellerId:pendingSeller.id,name:'Synthetic Pending Notification Store',status:'PENDING'}});
  await db.storeStatusHistory.create({data:{storeId:pendingStore.id,fromStatus:null,toStatus:'PENDING',actorId:pendingSeller.id,reason:'PRIVATE_APPLICATION'}});
  const tables=['orders','order_items','payments','refund_records','revenue_adjustments','product_variants','stock_movements','search_outbox'];
  const financial=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>{const [r]=await db.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text data FROM ${table} t`);return [table,createHash('sha256').update(r.data).digest('hex')];})));
  const financialBefore=await financial();
  vite=await createServer({root:path.join(root,'FE'),configFile:false,envDir:false,plugins:[react()],define:{'import.meta.env.VITE_API_URL':JSON.stringify(api),'import.meta.env.VITE_NOTIFICATIONS_ENABLED':JSON.stringify('true'),'import.meta.env.VITE_ACCOUNT_BUYER_ACCESS_ENABLED':JSON.stringify('true')},server:{host:'127.0.0.1',port:5190,strictPort:true}});await vite.listen();
  browser=await(pw.default??pw).chromium.launch({channel:'chrome',headless:true});
  async function page(name){const ctx=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light'});contexts.push(ctx);await ctx.route('**/*',route=>[api,web].includes(new URL(route.request().url()).origin)?route.continue():route.abort());const p=await ctx.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>pageErrors.push({name,message:e.message}));pages[name]=p;return p;}
  async function login(p,user){await p.goto(web+'/login');await p.waitForFunction(async()=>{const m=await import('/src/services/apiClient.ts');return m.getAuthSessionVersion()>0;});await p.getByLabel('Email',{exact:true}).fill(user.email);await p.getByLabel('Mật khẩu',{exact:true}).fill(password);await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.waitForURL(u=>u.pathname!=='/login');await p.goto(web+'/account/notifications');await p.getByRole('heading',{name:'Thông báo',exact:true}).waitFor();await p.getByText('Đang cập nhật…',{exact:true}).waitFor({state:'hidden'});}
  const b=await page('BUYER'),s=await page('SELLER'),a=await page('ADMIN');
  await login(b,buyer);assert.equal(await b.locator('li').count(),20);await b.getByLabel('Thông báo, 23 chưa đọc',{exact:true}).waitFor();results.push('Buyer real event inbox + unread badge');
  const body=await b.locator('body').innerText();for(const secret of ['PRIVATE_BUYER','PRIVATE_ADDRESS','PRIVATE_ORDER_REASON'])assert(!body.includes(secret));
  await b.getByRole('button',{name:'Xem thông báo cũ hơn',exact:true}).click();await b.getByText('Đang cập nhật…',{exact:true}).waitFor({state:'hidden'});assert.equal(await b.locator('li').count(),23);results.push('Cursor pagination without duplicates');
  await b.screenshot({path:path.join(output,'buyer-desktop-light.png'),fullPage:true});
  await b.getByRole('button',{name:'Đánh dấu đã đọc',exact:true}).first().evaluate(el=>{el.click();el.click();});await b.getByText('Đã đánh dấu đã đọc.',{exact:true}).waitFor();await b.getByText('Đang cập nhật…',{exact:true}).waitFor({state:'hidden'});assert.equal(await db.notification.count({where:{recipientId:buyer.id,readAt:{not:null}}}),1);results.push('Same-tick mark one, canonical read state');
  let posts=0,drop=true;await b.route(api+'/account/notifications/read-all',async route=>{posts++;const response=await route.fetch();assert.equal(response.status(),200);if(drop){drop=false;await route.abort('failed');}else await route.fulfill({response});});
  await b.getByRole('button',{name:'Đánh dấu đến mốc đang hiển thị đã đọc',exact:true}).click();await b.getByRole('alert').waitFor();assert.equal(posts,1);
  await b.reload();await b.getByText('0 thông báo chưa đọc',{exact:true}).waitFor();assert.equal(posts,1);results.push('Lost read-all response after commit; reload GET-only');
  await b.getByLabel('Lọc thông báo',{exact:true}).selectOption('unread');await b.getByText('Không có thông báo trong bộ lọc này.',{exact:true}).waitFor();results.push('Unread filter empty state');
  await b.getByRole('button',{name:'Đăng xuất',exact:true}).click();await b.waitForURL(u=>u.pathname==='/');await login(b,other);await b.getByText('Không có thông báo trong bộ lọc này.',{exact:true}).waitFor();assert.equal(await b.locator('li').count(),0);results.push('Logout + other account cannot see previous inbox');
  await login(s,seller);await s.getByRole('heading',{name:'Hồ sơ cửa hàng có cập nhật',exact:true}).waitFor();assert(!(await s.locator('body').innerText()).includes('PRIVATE_MODERATION_REASON'));results.push('Seller store event and no moderation reason');
  await login(a,admin);assert((await a.locator('li').count())>=1);assert(!(await a.locator('body').innerText()).includes('PRIVATE_APPLICATION'));results.push('Admin current pending application event');
  for(const [name,p] of Object.entries(pages)){await p.setViewportSize({width:390,height:844});await p.screenshot({path:path.join(output,`${name.toLowerCase()}-mobile-light.png`),fullPage:true});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));}
  results.push('Desktop/mobile light screenshots, no horizontal overflow');
  assert.deepEqual(await financial(),financialBefore);assert.deepEqual(await hashes(),sourceHashes);assert.deepEqual(pageErrors,[]);
  await writeFile(path.join(output,'report.json'),JSON.stringify({result:'PASS',results,database:url.pathname.slice(1),migrations:30,financialCoreUnchanged:true,sourceHashes,limits:'Synthetic legacy Order history and Store fixtures, not full business E2E. Real Chrome/API/PG app-role. Controlled response abort after upstream200. Light only. No email or real payment, no dotenv/reset/demo. Fixtures retained.'},null,2));
  console.log(JSON.stringify({result:'PASS',groups:results.length,output,demoTouched:false}));
}catch(e){for(const [name,p]of Object.entries(pages)){await p.screenshot({path:path.join(output,`${name}-failure.png`),fullPage:true}).catch(()=>{});await writeFile(path.join(output,`${name}-failure.txt`),await p.locator('body').innerText()).catch(()=>{});}throw e;}
finally{await Promise.all(contexts.map(c=>c.close()));await browser?.close();await vite?.close();await app?.close();}
