// Opt-in isolated Chrome -> Nest HTTP -> PostgreSQL. No successful response fixtures.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { 'playwright-module': { type: 'string' }, output: { type: 'string' } } });
assert(values.output && values['playwright-module']);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new URL(process.env.DATABASE_URL ?? '');
assert.equal(db.hostname, '127.0.0.1'); assert.equal(db.port, '5549');
assert.match(db.pathname, /^\/bckl_order_resolution_test_[a-z0-9_]{1,40}$/);
assert(!db.search && !db.hash);
for (const f of ['.env', 'BE/.env', 'FE/.env', 'FE/.env.local']) {
  try { await access(path.join(root, f)); throw new Error(`Refuse local dotenv override ${f}`); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
assert(process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
Object.assign(process.env, { FRONTEND_URL: 'http://127.0.0.1:5193', SEARCH_SYNC_ENABLED: 'false',
  SEARCH_RECONCILIATION_ENABLED: 'false', PRODUCT_IMAGE_REPAIR_ENABLED: 'false', ORDER_AUTO_COMPLETE_ENABLED: 'false',
  VITE_SELLER_ORDER_COMMANDS_ENABLED: 'true' });
const reqBE = createRequire(path.join(root,'BE/package.json'));
const reqFE = createRequire(path.join(root,'FE/package.json'));
reqBE('reflect-metadata');
const { Test } = reqBE('@nestjs/testing');
const load = name => import(pathToFileURL(path.join(root,'BE/dist',name)).href);
const { AppModule } = await load('app.module.js');
const { configureApp } = await load('configure-app.js');
const { PrismaService } = await load('prisma.service.js');
const { chromium } = await import(pathToFileURL(path.resolve(values['playwright-module'])).href);
const { createServer } = await import(pathToFileURL(reqFE.resolve('vite')).href);
const frontend = 'http://127.0.0.1:5193';
const marker = `seller-web-${randomUUID().slice(0,15)}`, password = `Qa-${randomUUID()}!`;
const output = path.resolve(values.output); await mkdir(output,{recursive:true});
const results=[], screenshots=[];
let app, vite, browser, p, api;
async function http(endpoint, token, method='GET', body, key) {
  const r=await fetch(api+endpoint,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await r.json(); assert(r.ok,`${endpoint} HTTP${r.status}`); return data;
}
async function login(page,email) {
  await page.goto(frontend+'/login'); await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await page.getByRole('button',{name:'Đăng xuất',exact:true}).waitFor();
}
async function logout(page) {
  await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();
  await page.getByRole('link',{name:'Đăng nhập',exact:true}).waitFor();
}
async function enabled(page,label) {
  await page.waitForFunction(name=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===name && !b.disabled),label);
  return page.getByRole('button',{name:label,exact:true});
}
async function choose(page,label) {
  await (await enabled(page,label)).click();
  assert(await page.getByRole('button',{name:'Xác nhận thao tác',exact:true}).isDisabled());
  await page.getByRole('checkbox').check();
}
async function submitTwice(page) {
  await page.getByRole('button',{name:'Xác nhận thao tác',exact:true}).evaluate(b=>{b.click();b.click();});
}
async function resolve(page) {
  await page.getByRole('heading',{name:'Đối chiếu yêu cầu đang chờ',exact:true}).waitFor();
  const b=page.getByRole('button',{name:'Đối chiếu / dừng yêu cầu cũ',exact:true});
  assert(await b.isDisabled()); await page.getByRole('checkbox').check(); await b.click();
}
async function screenshot(page,name) {
  // Full-page captures of sticky headers while scrolled can paint the header
  // midway down the stitched image. Start at the top for reproducible evidence.
  await page.evaluate(()=>{window.scrollTo(0,0);return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  await page.screenshot({path:path.join(output,name+'.png'),fullPage:true}); screenshots.push(name+'.png');
}
try {
  const module=await Test.createTestingModule({imports:[AppModule]}).compile();
  app=module.createNestApplication();configureApp(app);await app.listen(0,'127.0.0.1');api=await app.getUrl();p=app.get(PrismaService);
  process.env.VITE_API_URL=api;
  vite=await createServer({root:path.join(root,'FE'),server:{host:'127.0.0.1',port:5193,strictPort:true}});await vite.listen();
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const passwordHash=await reqBE('bcryptjs').hash(password,10);
  const seller=await p.user.create({data:{email:`${marker}-seller@example.test`,passwordHash,role:'SELLER'}});
  const other=await p.user.create({data:{email:`${marker}-other@example.test`,passwordHash,role:'SELLER'}});
  const store=await p.store.create({data:{sellerId:seller.id,name:'QA Seller Workflow',status:'SUSPENDED'}});
  await p.store.create({data:{sellerId:other.id,name:'QA Other Store',status:'ACTIVE'}});
  // Checkout needs ACTIVE; old-order command eligibility is later tested SUSPENDED.
  await p.store.update({where:{id:store.id},data:{status:'ACTIVE'}});
  const category=await p.category.create({data:{name:'QA Leaf',slug:marker}});
  const product=await p.product.create({data:{storeId:store.id,categoryId:category.id,name:'QA Seller Product',sellerStatus:'ACTIVE',moderationStatus:'APPROVED',
    images:{create:{url:'/uploads/qa-browser-only.jpg',isPrimary:true}},shippingProfile:{create:{packageWeightGrams:100}}}});
  const variant=await p.productVariant.create({data:{productId:product.id,storeId:store.id,skuCode:marker,optionSignature:'default',price:'10000.00',stock:100}});
  const buyer=await http('/auth/register',null,'POST',{email:`${marker}-buyer@example.test`,password,accountType:'USER'});
  const address=await http('/me/addresses',buyer.accessToken,'POST',{recipientName:'QA Buyer',phone:'0901234567',province:'QA',ward:'QA',addressLine:'QA fixture',isDefault:true});
  const buyer2=await http('/auth/register',null,'POST',{email:`${marker}-buyer2@example.test`,password,accountType:'USER'});
  const address2=await http('/me/addresses',buyer2.accessToken,'POST',{recipientName:'QA Buyer2',phone:'0901234567',province:'QA',ward:'QA',addressLine:'QA fixture',isDefault:true});
  const orders=[];
  for(let i=0;i<6;i++) {
    const actor=i%2?buyer2:buyer, destination=i%2?address2:address;
    await http(`/cart/items/${variant.id}`,actor.accessToken,'PUT',{quantity:1});
    const r=await http('/checkouts',actor.accessToken,'POST',{addressId:destination.id,paymentProvider:'COD',items:[{variantId:variant.id,quantity:1,expectedUnitPrice:'10000.00'}]},randomUUID());
    orders.push(r.orders[0]);
  }
  await p.store.update({where:{id:store.id},data:{status:'SUSPENDED'}});
  const baseline=JSON.stringify({variant:await p.productVariant.findUnique({where:{id:variant.id}}),product:await p.product.findUnique({where:{id:product.id}}),
    stock:await p.stockMovement.count({where:{variantId:variant.id}}),outbox:await p.searchOutbox.count({where:{productId:product.id}})});
  for(const [index,name,width,height,colorScheme] of [[0,'desktop-light',1440,1000,'light'],[1,'mobile-dark',390,844,'dark']]) {
    const c=await browser.newContext({viewport:{width,height},colorScheme});const page=await c.newPage();page.setDefaultTimeout(15000);
    await login(page,seller.email);await page.goto(frontend+`/seller/orders/${orders[index].id}`);
    for(const label of ['Xác nhận đơn','Bắt đầu đóng gói','Sẵn sàng bàn giao']) { await choose(page,label);await submitTwice(page);await page.getByText('Đã ghi nhận lệnh và tải lại đơn. Mỗi bước tiếp theo cần xác nhận riêng.',{exact:true}).waitFor(); }
    const id=orders[index].id;
    assert.equal((await p.order.findUniqueOrThrow({where:{id}})).status,'READY_TO_SHIP');
    assert.equal(await p.orderCommand.count({where:{orderId:id}}),3);assert.equal(await p.orderStatusHistory.count({where:{orderId:id}}),4);
    assert.equal(await p.orderCommandResolution.count({where:{orderId:id}}),0);
    assert(await page.getByRole('button',{name:'Làm mới chi tiết đơn',exact:true}).isEnabled());
    const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert(bounds.scroll<=bounds.width,`Horizontal overflow ${name}`);
    await screenshot(page,name);results.push({name,result:'PASS',commands:3,histories:4,bounds});await c.close();
  }
  const c=await browser.newContext({viewport:{width:1280,height:900}});const page=await c.newPage();page.setDefaultTimeout(15000);await login(page,seller.email);
  const pending=()=>page.evaluate(actorId=>JSON.parse(sessionStorage.getItem(`bckl-order-command-journal-v1:${actorId}`)),seller.id);
  // Real server commit, then discard the response; refresh retains the same journal key.
  const lost=orders[2].id;
  await page.route(api+`/seller/orders/${lost}/confirm`,async route=>{const r=await route.fetch();assert.equal(r.status(),200);await route.abort('failed');});
  await page.goto(frontend+`/seller/orders/${lost}`);await choose(page,'Xác nhận đơn');await submitTwice(page);
  await page.getByRole('heading',{name:'Đối chiếu yêu cầu đang chờ',exact:true}).waitFor();const original=await pending();
  assert(original);await page.reload();await page.getByRole('heading',{name:'Đối chiếu yêu cầu đang chờ',exact:true}).waitFor();assert.equal((await pending()).idempotencyKey,original.idempotencyKey);
  await resolve(page);await page.getByText('Đã ghi nhận lệnh và tải lại đơn. Mỗi bước tiếp theo cần xác nhận riêng.',{exact:true}).waitFor();
  assert.equal(await pending(),null);assert.equal(await p.orderCommand.count({where:{orderId:lost}}),1);assert.equal(await p.orderCommandResolution.count({where:{orderId:lost}}),0);
  await screenshot(page,'lost-response-committed');results.push({name:'lost-response-reload-COMMITTED',result:'PASS',commands:1});
  // Drop before server receives execution: resolution must close without business mutation.
  const closed=orders[3].id;
  await page.route(api+`/seller/orders/${closed}/confirm`,route=>route.abort('failed'));
  await page.goto(frontend+`/seller/orders/${closed}`);await choose(page,'Xác nhận đơn');await submitTwice(page);
  await page.getByRole('heading',{name:'Đối chiếu yêu cầu đang chờ',exact:true}).waitFor();
  await resolve(page);await page.getByText('Đã đóng mã yêu cầu chưa thực hiện và tải lại đơn. Đóng mã không phải hủy đơn.',{exact:true}).waitFor();
  assert.equal((await p.order.findUniqueOrThrow({where:{id:closed}})).status,'PENDING_CONFIRMATION');assert.equal(await p.orderCommand.count({where:{orderId:closed}}),0);
  assert.equal(await p.orderCommandResolution.count({where:{orderId:closed}}),1);
  await page.unroute(api+`/seller/orders/${closed}/confirm`);await choose(page,'Xác nhận đơn');await submitTwice(page);await enabled(page,'Bắt đầu đóng gói');
  assert.equal(await p.orderCommand.count({where:{orderId:closed}}),1);results.push({name:'CLOSED-then-fresh-intent',result:'PASS',fences:1,commands:1});
  // Acknowledgement known but refresh fails: only GET retry is offered.
  const readFail=orders[4].id;await page.goto(frontend+`/seller/orders/${readFail}`);await choose(page,'Xác nhận đơn');
  await page.route(api+`/seller/orders/${readFail}`,route=>route.abort('failed'));
  await submitTwice(page);await page.getByRole('alert').filter({hasText:'Đã ghi nhận lệnh.'}).waitFor();
  assert.equal(await pending(),null);assert.equal(await page.getByRole('button',{name:'Xác nhận thao tác',exact:true}).count(),0);
  await page.unroute(api+`/seller/orders/${readFail}`);await page.getByRole('button',{name:'Tải lại đơn',exact:true}).click();await enabled(page,'Bắt đầu đóng gói');
  assert.equal(await p.orderCommand.count({where:{orderId:readFail}}),1);results.push({name:'acknowledged-GET-failure-read-only-retry',result:'PASS',commands:1});
  // Hold a committed response, logout/login another Seller, then release old response.
  const switched=orders[5].id;let release, reached;
  const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{reached=r;});
  await page.route(api+`/seller/orders/${switched}/confirm`,async route=>{const r=await route.fetch();assert.equal(r.status(),200);reached();await gate;try{await route.fulfill({response:r});}catch{/* old client detached */}});
  await page.goto(frontend+`/seller/orders/${switched}`);await choose(page,'Xác nhận đơn');await submitTwice(page);await started;
  await logout(page);await login(page,other.email);await page.goto(frontend+`/seller/orders/${switched}`);release();await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('QA Seller Product',{exact:true}).count(),0);assert(await pending());
  await logout(page);await login(page,seller.email);await page.goto(frontend+`/seller/orders/${switched}`);await resolve(page);await enabled(page,'Bắt đầu đóng gói');
  assert.equal(await pending(),null);assert.equal(await p.orderCommand.count({where:{orderId:switched}}),1);results.push({name:'account-switch-held-committed-response',result:'PASS',commands:1});
  await c.close();
  const after=JSON.stringify({variant:await p.productVariant.findUnique({where:{id:variant.id}}),product:await p.product.findUnique({where:{id:product.id}}),
    stock:await p.stockMovement.count({where:{variantId:variant.id}}),outbox:await p.searchOutbox.count({where:{productId:product.id}})});
  assert.equal(after,baseline,'Seller preparation/resolution unexpectedly mutated Product/Variant/stock/outbox');
  console.log(`SELLER WEB QA ${results.length}/6 PASS — real Chrome/Nest/PostgreSQL`);
} catch(error) {results.push({name:'run',result:'FAIL',message:error.message});throw error;}
finally {
  await writeFile(path.join(output,'results.json'),JSON.stringify({marker,layer:'REAL_CHROME_HTTP_POSTGRES',results,screenshots,
    limitations:['Chrome only; mobile is emulation','QA flag enabled; default off','No Buyer cancel/complete or full fulfilment acceptance','Fixtures retained in disposable DB; no credentials written']},null,2));
  await browser?.close();await vite?.close();await app?.close();
}
