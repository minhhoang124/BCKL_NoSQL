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
assert.match(u.pathname,/^\/bckl_order_resolution_test_seller_close_20261030_[a-z0-9_]+$/);
assert.equal(u.username,'bckl_local_app');
assert(!u.hash&&[...u.searchParams].every(([k,v])=>k==='schema'&&v==='public')&&u.searchParams.getAll('schema').length<=1);
for(const f of ['.env','BE/.env','FE/.env','FE/.env.local'])assert(!fs.existsSync(path.join(root,f)),'Do not load local profile');
assert(process.env.JWT_ACCESS_SECRET&&process.env.JWT_REFRESH_SECRET);
const web='http://127.0.0.1:5198';
Object.assign(process.env,{FRONTEND_URL:web,CHECKOUT_CREATE_INTENTS_PER_MINUTE:'60',ORDER_COMMAND_RATE_PER_MINUTE:'200',SEARCH_SYNC_ENABLED:'false',SEARCH_RECONCILIATION_ENABLED:'false',PRODUCT_IMAGE_REPAIR_ENABLED:'false',ORDER_AUTO_COMPLETE_ENABLED:'false',EMAIL_NOTIFICATION_WORKER_ENABLED:'false',AUTH_GOOGLE_ENABLED:'false',AUTH_EMAIL_ENABLED:'false',AUTH_PHONE_OTP_SANDBOX_ENABLED:'false'});
const req=createRequire(path.join(root,'BE/package.json')),rf=createRequire(path.join(root,'FE/package.json'));
req('reflect-metadata');const load=p=>import(pathToFileURL(path.join(root,'BE/dist',p)).href);
const {AppModule}=await load('app.module.js'),{configureApp}=await load('configure-app.js'),{PrismaService}=await load('prisma.service.js'),{Test}=req('@nestjs/testing');
const files=['FE/src/features/order-recovery/SellerClosePage.tsx','FE/src/features/order-recovery/sellerCloseClient.ts','FE/src/features/order-recovery/SellerOrderWorkspace.tsx','FE/src/features/order-recovery/sellerOrderWorkflow.ts','FE/src/routes/AppRouter.tsx','BE/src/order/order-cancellation.service.ts','BE/src/order/order-returned.service.ts','BE/src/order/seller-close-resolution-request.ts','BE/src/order/seller-close-resolution.service.ts','BE/src/order/seller-close-resolution.controller.ts','BE/src/order/order-command-fence.ts','BE/prisma/migrations/20261030100000_seller_close_command_resolution/migration.sql','scripts/test-seller-close-browser.mjs','scripts/test-seller-close-browser.py'];
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
 const stores={};for(const name of ['SELLER','FOREIGN'])stores[name]=await db.store.create({data:{sellerId:actors[name].id,name:'Synthetic '+name,status:'ACTIVE'}});
 const category=await db.category.create({data:{slug:marker,name:'Synthetic Seller close QA'}});
 await http('/me/addresses',actors.USER.token,'POST',{recipientName:'QA synthetic',phone:'0901234567',province:'QA',district:'QA',ward:'QA',addressLine:'Synthetic fixture only',postalCode:null,deliveryNote:null,isDefault:true});
 const address=await db.userAddress.findFirstOrThrow({where:{userId:actors.USER.id}});
 const specs=[['pending','PENDING_CONFIRMATION'],['confirmed','CONFIRMED'],['restock','DELIVERY_FAILED'],['damaged','DELIVERY_FAILED'],['lost-response','PENDING_CONFIRMATION'],['foreign','PENDING_CONFIRMATION'],['shipping','SHIPPING'],['paid-negative','PENDING_CONFIRMATION'],['buyer-race','PENDING_CONFIRMATION'],['prep-race','PENDING_CONFIRMATION'],['returned-race','DELIVERY_FAILED'],['completed','COMPLETED'],['resolve-unexecuted','PENDING_CONFIRMATION'],['resolve-race','PENDING_CONFIRMATION'],['resolve-browser','PENDING_CONFIRMATION']];
 specs.push(['resolve-committed','DELIVERY_FAILED']);
 for(const[name,target]of specs){
  const store=stores[name==='foreign'?'FOREIGN':'SELLER'];
  const product=await db.product.create({data:{storeId:store.id,categoryId:category.id,name:'QA '+name,sellerStatus:'ACTIVE',moderationStatus:'APPROVED',images:{create:{url:'/uploads/qa-only.jpg',isPrimary:true}},shippingProfile:{create:{packageWeightGrams:100}}}});
  const variant=await db.productVariant.create({data:{productId:product.id,storeId:store.id,skuCode:marker+'-'+name,optionSignature:'default',price:'10000.00',stock:5}});
  await http('/cart/items/'+variant.id,actors.USER.token,'PUT',{quantity:2});
  const receipt=await http('/checkouts',actors.USER.token,'POST',{addressId:address.id,paymentProvider:'COD',items:[{variantId:variant.id,quantity:2,expectedUnitPrice:'10000.00'}]},randomUUID());
  const id=receipt.orders[0].id,tracking='QA-'+name+'-'+id,order={name,id,variantId:variant.id,productId:product.id,tracking};
  if(target!=='PENDING_CONFIRMATION')await http(`/seller/orders/${id}/confirm`,actors.SELLER.token,'POST',{},randomUUID());
  if(['SHIPPING','DELIVERY_FAILED','COMPLETED'].includes(target)){
   for(const command of ['start-packing','ready-to-ship'])await http(`/seller/orders/${id}/${command}`,actors.SELLER.token,'POST',{},randomUUID());
   await http(`/admin/orders/${id}/ship`,actors.ADMIN.token,'POST',{trackingReference:tracking},randomUUID());
   if(target==='DELIVERY_FAILED')await http(`/admin/orders/${id}/delivery-failed`,actors.ADMIN.token,'POST',{trackingReference:tracking,deliveryAttempt:1,reasonCode:'CUSTOMER_REFUSED',reasonText:'Synthetic delivery failure'},randomUUID());
   if(target==='COMPLETED'){
    await http(`/admin/orders/${id}/mark-delivered`,actors.ADMIN.token,'POST',{trackingReference:tracking,deliveryAttempt:1},randomUUID());
    await http(`/orders/${id}/complete`,actors.USER.token,'POST',{},randomUUID());
   }
  }
  if(name==='paid-negative')await db.payment.update({where:{orderId:id},data:{provider:'VNPAY',status:'PAID',paidAt:new Date()}}); // Synthetic state guard fixture, NOT a live VNPay transaction.
  orders.push(order);
 }
 const snapshot=async id=>{
  const o=await db.order.findUniqueOrThrow({where:{id},include:{payment:true,items:{orderBy:{id:'asc'}}}});
  const movement=await db.stockMovement.findMany({where:{orderItemId:o.items[0].id},orderBy:{id:'asc'}});
  return{status:o.status,total:o.total.toFixed(2),subtotal:o.subtotal.toFixed(2),payment:{provider:o.payment.provider,status:o.payment.status,amount:o.payment.amount.toFixed(2),paidAt:o.payment.paidAt?.toISOString()??null},items:o.items.map(i=>({id:i.id,variantId:i.variantId,quantity:i.quantity,unitPrice:i.unitPrice.toFixed(2),lineTotal:i.lineTotal.toFixed(2)})),stock:(await db.productVariant.findUniqueOrThrow({where:{id:o.items[0].variantId}})).stock,movements:movement.map(m=>({type:m.type,delta:m.quantityDelta})),commands:await db.orderCommand.count({where:{orderId:id}}),histories:await db.orderStatusHistory.count({where:{orderId:id}})};
 };
 const before=Object.fromEntries(await Promise.all(orders.map(async o=>[o.name,await snapshot(o.id)])));
 const cancel={reasonCode:'OTHER',reasonText:'Synthetic negative probe'};
 const pending=orders.find(o=>o.name==='pending');
 for(const[name,token,expected]of [['anonymous',null,401],['buyer-role',actors.USER.token,403],['admin-role',actors.ADMIN.token,403],['foreign-seller',actors.FOREIGN.token,404]]){
  const r=await request(`/seller/orders/${pending.id}/cancel`,token,'POST',cancel,randomUUID());assert.equal(r.status,expected,name);assert.deepEqual(await snapshot(pending.id),before.pending);probes.push({name,status:r.status,result:'PASS'});
 }
 for(const name of ['shipping','paid-negative','completed']){
  const o=orders.find(o=>o.name===name),r=await request(`/seller/orders/${o.id}/cancel`,actors.SELLER.token,'POST',cancel,randomUUID());assert.equal(r.status,409,name);assert.deepEqual(await snapshot(o.id),before[name]);probes.push({name,status:r.status,result:'PASS'});
 }
 const returnedOrder=orders.find(o=>o.name==='restock'),lost=await request(`/seller/orders/${returnedOrder.id}/confirm-returned`,actors.SELLER.token,'POST',{reasonCode:'LOST',reasonText:'Synthetic forbidden LOST',restockable:false,receiptReference:null},randomUUID());assert.equal(lost.status,400);assert.deepEqual(await snapshot(returnedOrder.id),before.restock);probes.push({name:'seller-lost-forbidden',status:lost.status,result:'PASS'});
 process.env.VITE_API_URL=api;
 const{createServer}=await import(pathToFileURL(rf.resolve('vite')).href);vite=await createServer({root:path.join(root,'FE'),envDir:false,server:{host:'127.0.0.1',port:5198,strictPort:true}});await vite.listen();
 const resolutionBody={reasonCode:'OTHER',reasonText:'Synthetic original reason for resolver'};
 const closeMetadata=(order,key=randomUUID())=>({schemaVersion:1,actorId:actors.SELLER.id,orderId:order.id,command:'cancel',idempotencyKey:key,requestHash:createHash('sha256').update(JSON.stringify({actorScope:'USER:'+actors.SELLER.id,body:resolutionBody,command:'cancel',orderId:order.id}),'utf8').digest('hex')});
 const browserResolution=closeMetadata(orders.find(o=>o.name==='resolve-browser'));
 const fixture=path.join(out,'fixture.private.json');fs.writeFileSync(fixture,JSON.stringify({api,web,actors,orders,browserResolution}));
 const code=await new Promise((resolve,reject)=>{const c=spawn(values.python,[path.join(root,'scripts/test-seller-close-browser.py'),'--fixture',fixture,'--output',out],{cwd:root,env:process.env,windowsHide:true,stdio:'inherit'});c.on('error',reject);c.on('exit',resolve);});assert.equal(code,0,'Native Chrome Seller acceptance failed');
 const race=orders.find(o=>o.name==='buyer-race'),sellerBody={reasonCode:'OTHER',reasonText:'Synthetic Seller race'},buyerBody={reasonCode:'CHANGED_MIND',reasonText:'Synthetic Buyer race'},sellerKey=randomUUID(),buyerKey=randomUUID();
 const raceResults=await Promise.all([request(`/seller/orders/${race.id}/cancel`,actors.SELLER.token,'POST',sellerBody,sellerKey),request(`/orders/${race.id}/cancel`,actors.USER.token,'POST',buyerBody,buyerKey)]);
 assert.deepEqual(raceResults.map(r=>r.status).sort(),[200,409]);const winner=raceResults[0].status===200?0:1;
 const replay=await http(winner===0?`/seller/orders/${race.id}/cancel`:`/orders/${race.id}/cancel`,actors[winner===0?'SELLER':'USER'].token,'POST',winner===0?sellerBody:buyerBody,winner===0?sellerKey:buyerKey);assert.equal(replay.replayed,true);
 const mismatch=await request(winner===0?`/seller/orders/${race.id}/cancel`:`/orders/${race.id}/cancel`,actors[winner===0?'SELLER':'USER'].token,'POST',{...(winner===0?sellerBody:buyerBody),reasonText:'Different body'},winner===0?sellerKey:buyerKey);assert.equal(mismatch.status,409);
 probes.push({name:'buyer-seller-cancel-race',statuses:raceResults.map(r=>r.status),replay:true,differentBodyStatus:409,result:'PASS'});
 const prepRace=orders.find(o=>o.name==='prep-race'),prepKey=randomUUID();
 const prepResponses=await Promise.all([request(`/seller/orders/${prepRace.id}/cancel`,actors.SELLER.token,'POST',sellerBody,prepKey),request(`/seller/orders/${prepRace.id}/confirm`,actors.SELLER.token,'POST',{},randomUUID())]);
 assert.equal(prepResponses[0].status,200,'Cancel remains legal after a concurrent confirmation');assert([200,409].includes(prepResponses[1].status));
 assert.equal((await http(`/seller/orders/${prepRace.id}/cancel`,actors.SELLER.token,'POST',sellerBody,prepKey)).replayed,true);
 const extraPrepCommand=prepResponses[1].status===200?1:0;
 probes.push({name:'seller-cancel-confirm-race',statuses:prepResponses.map(r=>r.status),replay:true,result:'PASS'});
 const returnedRace=orders.find(o=>o.name==='returned-race'),returnedBody={reasonCode:'RETURN_RECEIVED',reasonText:'Synthetic Seller/Admin return race',receiptReference:'QA-RACE-'+returnedRace.id,restockable:true},returnedKeys=[randomUUID(),randomUUID()];
 const returnResponses=await Promise.all([request(`/seller/orders/${returnedRace.id}/confirm-returned`,actors.SELLER.token,'POST',returnedBody,returnedKeys[0]),request(`/admin/orders/${returnedRace.id}/confirm-returned`,actors.ADMIN.token,'POST',returnedBody,returnedKeys[1])]);
 assert.deepEqual(returnResponses.map(r=>r.status).sort(),[200,409]);const returnWinner=returnResponses[0].status===200?0:1;
 assert.equal((await http(`/${returnWinner===0?'seller':'admin'}/orders/${returnedRace.id}/confirm-returned`,actors[returnWinner===0?'SELLER':'ADMIN'].token,'POST',returnedBody,returnedKeys[returnWinner])).replayed,true);
 probes.push({name:'seller-admin-return-race',statuses:returnResponses.map(r=>r.status),replay:true,result:'PASS'});
 const resolutionRequest=p=>({command:p.command,hashVersion:1,requestHash:p.requestHash});
 const expectClosed=async(p,baseline)=>{
  const endpoint=`/seller/orders/${p.orderId}/resolve-close-command`,body=resolutionRequest(p);
  const closed=await http(endpoint,actors.SELLER.token,'POST',body,p.idempotencyKey);assert.equal(closed.outcome,'CLOSED_WITHOUT_EXECUTION');assert.equal(closed.requestHash,p.requestHash);assert.equal(closed.actorId,p.actorId);
  const repeated=await http(endpoint,actors.SELLER.token,'POST',body,p.idempotencyKey);assert.deepEqual(repeated,closed);
  const badHash=await request(endpoint,actors.SELLER.token,'POST',{...body,requestHash:(p.requestHash[0]==='a'?'b':'a')+p.requestHash.slice(1)},p.idempotencyKey);assert.equal(badHash.status,409);
  const delayed=await request(`/seller/orders/${p.orderId}/cancel`,actors.SELLER.token,'POST',resolutionBody,p.idempotencyKey);assert.equal(delayed.status,409);assert.equal((await delayed.json()).code,'ORDER_COMMAND_CLOSED');
  assert.deepEqual(await snapshot(p.orderId),baseline,'Closing a never-sent key cannot cancel or restore stock');
  assert.equal(await db.orderCommand.count({where:{actorScope:'USER:'+p.actorId,idempotencyKey:p.idempotencyKey}}),0);
  assert.equal(await db.orderCommandResolution.count({where:{actorScope:'USER:'+p.actorId,idempotencyKey:p.idempotencyKey}}),1);
  return closed;
 };
 const unexecuted=orders.find(o=>o.name==='resolve-unexecuted'),unexecutedMetadata=closeMetadata(unexecuted);
 for(const[name,token,status]of [['resolver-foreign-seller',actors.FOREIGN.token,404],['resolver-buyer',actors.USER.token,403],['resolver-anonymous',null,401]]){
  const r=await request(`/seller/orders/${unexecuted.id}/resolve-close-command`,token,'POST',resolutionRequest(unexecutedMetadata),unexecutedMetadata.idempotencyKey);assert.equal(r.status,status);assert.deepEqual(await snapshot(unexecuted.id),before['resolve-unexecuted']);probes.push({name,status:r.status,result:'PASS'});
 }
 await expectClosed(unexecutedMetadata,before['resolve-unexecuted']);probes.push({name:'resolver-close-unexecuted-delayed-write-fenced',result:'PASS'});
 await expectClosed(browserResolution,before['resolve-browser']);probes.push({name:'resolver-browser-CLOSED-proof-and-delayed-fence',result:'PASS'});
 const originalOrder=orders.find(o=>o.name==='lost-response'),originalCommand=await db.orderCommand.findFirstOrThrow({where:{orderId:originalOrder.id,actorId:actors.SELLER.id,command:'cancel'}}),committedBefore=await snapshot(originalOrder.id);
 const committedMetadata={command:'cancel',hashVersion:1,requestHash:originalCommand.requestHash};
 const committed=await http(`/seller/orders/${originalOrder.id}/resolve-close-command`,actors.SELLER.token,'POST',committedMetadata,originalCommand.idempotencyKey);assert.equal(committed.outcome,'COMMITTED');assert.equal(committed.receipt.commandId,originalCommand.id);assert.equal(committed.receipt.replayed,true);assert.deepEqual(await snapshot(originalOrder.id),committedBefore);
 const committedBadHash=await request(`/seller/orders/${originalOrder.id}/resolve-close-command`,actors.SELLER.token,'POST',{...committedMetadata,requestHash:'f'.repeat(64)},originalCommand.idempotencyKey);assert.equal(committedBadHash.status,409);assert.deepEqual(await snapshot(originalOrder.id),committedBefore);probes.push({name:'resolver-COMMITTED-original-receipt-no-new-write',result:'PASS'});
 const resolutionRace=orders.find(o=>o.name==='resolve-race'),resolutionRaceMetadata=closeMetadata(resolutionRace);
 const resolutionRaceResponses=await Promise.all([request(`/seller/orders/${resolutionRace.id}/resolve-close-command`,actors.SELLER.token,'POST',resolutionRequest(resolutionRaceMetadata),resolutionRaceMetadata.idempotencyKey),request(`/seller/orders/${resolutionRace.id}/cancel`,actors.SELLER.token,'POST',resolutionBody,resolutionRaceMetadata.idempotencyKey)]);
 assert.equal(resolutionRaceResponses[0].status,200);const raceResolution=await resolutionRaceResponses[0].json(),resolutionExecuted=raceResolution.outcome==='COMMITTED';
 assert(['COMMITTED','CLOSED_WITHOUT_EXECUTION'].includes(raceResolution.outcome));assert.equal(resolutionRaceResponses[1].status,resolutionExecuted?200:409);
 if(!resolutionExecuted)assert.equal((await resolutionRaceResponses[1].json()).code,'ORDER_COMMAND_CLOSED');
 const committedCount=await db.orderCommand.count({where:{actorScope:'USER:'+actors.SELLER.id,idempotencyKey:resolutionRaceMetadata.idempotencyKey}}),closedCount=await db.orderCommandResolution.count({where:{actorScope:'USER:'+actors.SELLER.id,idempotencyKey:resolutionRaceMetadata.idempotencyKey}});assert.equal(committedCount+closedCount,1);assert.equal(committedCount,resolutionExecuted?1:0);
 const raceResolutionAgain=await http(`/seller/orders/${resolutionRace.id}/resolve-close-command`,actors.SELLER.token,'POST',resolutionRequest(resolutionRaceMetadata),resolutionRaceMetadata.idempotencyKey);assert.deepEqual(raceResolutionAgain,raceResolution);
 if(!resolutionExecuted)assert.deepEqual(await snapshot(resolutionRace.id),before['resolve-race']);probes.push({name:'resolver-v-execute-race',outcome:raceResolution.outcome,statuses:resolutionRaceResponses.map(r=>r.status),committedCount,closedCount,result:'PASS'});
 const ledger=[];
 for(const o of orders){
  const state=await snapshot(o.id),unchanged=['foreign','shipping','paid-negative','completed','resolve-unexecuted','resolve-browser',...(!resolutionExecuted?['resolve-race']:[])].includes(o.name),restock=['pending','confirmed','restock','lost-response','buyer-race','prep-race','returned-race',...(resolutionExecuted?['resolve-race']:[])].includes(o.name);
  if(unchanged)assert.deepEqual(state,before[o.name]);else{
   assert.equal(state.status,'CANCELLED');assert.equal(state.payment.status,'CANCELLED');assert.equal(state.payment.provider,'COD');assert.equal(state.payment.paidAt,null);
   assert.equal(state.stock,restock?5:3);assert.deepEqual(state.movements,restock?[{type:'CHECKOUT_DECREMENT',delta:-2},{type:'CANCELLATION_RESTORE',delta:2}]:[{type:'CHECKOUT_DECREMENT',delta:-2}]);
   const delta=1+(o.name==='prep-race'?extraPrepCommand:0);assert.equal(state.commands,before[o.name].commands+delta);assert.equal(state.histories,before[o.name].histories+delta);
  }
  assert.equal(state.total,'20000.00');assert.equal(state.payment.amount,'20000.00');assert.deepEqual(state.items,before[o.name].items);ledger.push({name:o.name,orderId:o.id,...state});
 }
 assert.deepEqual(hashes(),sourceBefore,'Source changed during browser acceptance; invalidate run');
 fs.writeFileSync(path.join(out,'ledger-report.json'),JSON.stringify({result:'PASS',scope:'REAL_CHROME_HTTP_PG_SELLER_CLOSE_SYNTHETIC_QA',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),database:u.pathname,migrations:migrationNames,sourceHashes:sourceBefore,probes,ledger,limits:['Synthetic catalog/actors only, actual Checkout/preparation/Admin HTTP; Seller closing actual browser UI','paid-negative is manually seeded payment state guard, not live VNPay acceptance','No external provider, real courier, bank/refund or production workload acceptance','QA checkout60/command200 quota for fixture setup; no production quota claim','Tab-scoped metadata journal; explicit same-body replay or explicit server COMMITTED/CLOSED resolution; no automatic POST on reload']},null,2));
 console.log(JSON.stringify({result:'PASS',orders:orders.length,httpProbes:probes.length,out}));
}finally{await vite?.close();await app?.close();}
