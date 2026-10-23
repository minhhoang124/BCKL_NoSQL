// Opt-in Chrome -> actual Nest -> isolated PostgreSQL. No HTTP success mocks.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { output: { type: 'string' }, 'playwright-module': { type: 'string' } } });
assert(values.output && values['playwright-module']);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new URL(process.env.DATABASE_URL ?? '');
assert.equal(db.protocol, 'postgresql:'); assert.equal(db.hostname, '127.0.0.1'); assert.equal(db.port, '5549');
assert.equal(db.pathname, '/bckl_order_resolution_test_attributes_20261019_v938'); assert.equal(db.hash, '');
assert([...db.searchParams].every(([key,value]) => key === 'schema' && value === 'public'));
for (const file of ['.env','BE/.env','FE/.env']) await assert.rejects(access(path.join(root,file)));
for (const flag of ['SEARCH_SYNC_ENABLED','SEARCH_RECONCILIATION_ENABLED','PRODUCT_IMAGE_REPAIR_ENABLED','ORDER_AUTO_COMPLETE_ENABLED']) assert.equal(process.env[flag],'false');
const output = path.resolve(values.output); await assert.rejects(access(output)); await mkdir(output,{ recursive: true });
const rb = createRequire(path.join(root,'BE/package.json')), rf = createRequire(path.join(root,'FE/package.json'));
rb('reflect-metadata');
Object.assign(process.env, { ACCOUNT_SETTINGS_WRITE_ENABLED: 'true', FRONTEND_URL: 'http://127.0.0.1:5180' });
const load = name => import(pathToFileURL(path.join(root,'BE/dist',name)).href);
const { AppModule } = await load('app.module.js'); const { configureApp } = await load('configure-app.js');
const { PrismaService } = await load('prisma.service.js'); const { Test } = rb('@nestjs/testing');
const { createServer } = await import(pathToFileURL(rf.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(rf.resolve('@vitejs/plugin-react')).href);
const pw = await import(pathToFileURL(path.resolve(values['playwright-module'])).href);
let app, vite, browser; const results = [];
const api = 'http://127.0.0.1:3381', web = 'http://127.0.0.1:5180';
const body = response => response.json();
try {
  app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication(); configureApp(app); await app.listen(3381,'127.0.0.1');
  const prisma = app.get(PrismaService);
  assert.equal((await prisma.$queryRaw`SELECT current_database() AS name`)[0].name,db.pathname.slice(1));
  const migrations = await prisma.$queryRaw`SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL`; assert.equal(migrations[0].count,19);
  vite = await createServer({ root: path.join(root,'FE'), configFile: false, envDir: false, plugins: [react()], define: {
    'import.meta.env.VITE_ACCOUNT_SETTINGS_ENABLED': JSON.stringify('true'), 'import.meta.env.VITE_API_URL': JSON.stringify(api),
  }, server: { host: '127.0.0.1', port: 5180, strictPort: true } }); await vite.listen();
  browser = await (pw.default ?? pw).chromium.launch({ channel: 'chrome', headless: true });
  for (const [name,width,height,colorScheme] of [['desktop-light',1440,1000,'light'],['desktop-dark',1440,1000,'dark'],['mobile-light',390,844,'light'],['mobile-dark',390,844,'dark']]) {
    const email = `settings-browser-${randomBytes(8).toString('hex')}@example.test`, password = randomBytes(16).toString('hex'), next = randomBytes(16).toString('hex');
    const registered = await fetch(api+'/auth/register',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,fullName:'Original Browser Name'}) }); assert.equal(registered.status,201); const initial = await body(registered);
    const context = await browser.newContext({ viewport:{width,height}, colorScheme }); const page = await context.newPage(); page.setDefaultTimeout(20000);
    const errors=[]; let profilePosts=0,passwordPosts=0,loginPosts=0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if(req.method()==='PATCH'&&req.url()===api+'/auth/profile')profilePosts++; if(req.method()==='POST'&&req.url()===api+'/auth/password')passwordPosts++; if(req.method()==='POST'&&req.url()===api+'/auth/login')loginPosts++; });
    await page.goto(web+'/login'); await page.getByLabel('Email',{exact:true}).fill(email); await page.getByLabel('Mật khẩu',{exact:true}).fill(password); await page.getByRole('button',{name:'Đăng nhập',exact:true}).evaluate(button=>{button.click();button.click();});
    await page.waitForURL(web+'/'); await page.goto(web+'/account'); await page.getByRole('heading',{name:'Hồ sơ và bảo mật'}).waitFor();
    assert.equal(profilePosts,0);assert.equal(passwordPosts,0);assert.equal(loginPosts,1);
    await page.getByLabel('Tên hiển thị',{exact:true}).fill('Updated Browser Name');
    const saved = page.waitForResponse(r=>r.url()===api+'/auth/profile'&&r.request().method()==='PATCH');
    await page.getByRole('button',{name:'Lưu hồ sơ',exact:true}).evaluate(button=>{button.click();button.click();}); assert.equal((await saved).status(),200);
    await page.getByRole('status').filter({hasText:'Đã lưu tên hiển thị'}).waitFor();assert.equal(profilePosts,1);
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:initial.user.id}})).fullName,'Updated Browser Name');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,name+'-profile.png'),fullPage:true});
    await page.getByLabel('Mật khẩu hiện tại',{exact:true}).fill(password);await page.getByLabel('Mật khẩu mới',{exact:true}).fill(next);await page.getByLabel('Xác nhận mật khẩu mới',{exact:true}).fill(next);
    const lost = name === 'mobile-dark';
    if (lost) await page.route(api+'/auth/password',async route=>{
      const committed = await route.fetch(); assert.equal(committed.status(),200);
      // Fault injection AFTER actual HTTP success; never fabricate a success body.
      await route.abort('failed');
    });
    const changed=lost ? null : page.waitForResponse(r=>r.url()===api+'/auth/password'&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Đổi mật khẩu và đăng nhập lại',exact:true}).evaluate(button=>{button.click();button.click();});if(changed)assert.equal((await changed).status(),200);
    await page.getByRole(lost?'alert':'status').filter({hasText:lost?'Chưa rõ kết quả đổi mật khẩu':'Đã đổi mật khẩu'}).waitFor();assert.equal(passwordPosts,1);
    assert.equal((await fetch(api+'/auth/me',{headers:{Authorization:`Bearer ${initial.accessToken}`}})).status,401);
    assert.equal((await fetch(api+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})})).status,401);
    const record=await prisma.user.findUniqueOrThrow({where:{id:initial.user.id}});assert.equal(record.credentialVersion,2);
    assert.equal(await prisma.accountSecurityEvent.count({where:{userId:record.id,toVersion:2}}),1);
    assert.equal(await prisma.refreshToken.count({where:{userId:record.id,revokedAt:null}}),0);
    await page.screenshot({path:path.join(output,name+'-reauth.png'),fullPage:true});assert.deepEqual(errors,[]);
    // Reload with the old cookie cannot repeat the write or resurrect the session.
    if(lost){await page.reload({waitUntil:'networkidle'});await page.getByRole('heading',{name:'Đăng nhập',exact:true}).waitFor();assert.equal(passwordPosts,1);}
    // New password really logs in; never retain either password or token in artifacts.
    await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Mật khẩu',{exact:true}).fill(next);await page.getByRole('button',{name:'Đăng nhập',exact:true}).evaluate(button=>{button.click();button.click();});await page.waitForURL(web+'/');assert.equal(loginPosts,2);
    await page.goto(web+'/account');await page.getByRole('heading',{name:'Thông tin tài khoản',exact:true}).waitFor();await page.getByRole('heading',{name:'Updated Browser Name',exact:true}).waitFor();
    results.push({name,result:'PASS',loginRequests:loginPosts,profileRequests:profilePosts,passwordRequests:passwordPosts,credentialVersion:record.credentialVersion,lostResponseAfterRealCommit:lost});await context.close();
  }
  console.log(JSON.stringify({result:'PASS',groups:results.length,output}));
} catch(error) {
  results.push({result:'FAIL',message:String(error?.message).replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[DATABASE_URL]')});process.exitCode=1;
} finally {
  const browserVersion=browser?.version();await browser?.close();await vite?.close();await app?.close();
  await writeFile(path.join(output,'results.json'),JSON.stringify({sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim().length>0,driverSha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),scope:'REAL Chrome -> Nest -> PostgreSQL QA; no HTTP success mocks; synthetic accounts; no production',browserVersion,database:db.pathname.slice(1),results},null,2));
}
