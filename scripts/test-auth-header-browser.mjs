// Real Chrome UI -> Nest Auth -> isolated retained PostgreSQL QA.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { 'playwright-module': { type: 'string' }, output: { type: 'string' } } });
assert(values.output && values['playwright-module']);
const db = new URL(process.env.DATABASE_URL ?? '');
assert.equal(db.hostname, '127.0.0.1'); assert.equal(db.port, '5549'); assert(['/bckl_checkout_web_20261012', '/bckl_pr59_combined_20261020'].includes(db.pathname));
assert([...db.searchParams].every(([k,v]) => k === 'schema' && v === 'public')); assert(!db.hash);
assert(process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rb = createRequire(path.join(root, 'BE/package.json')), rf = createRequire(path.join(root, 'FE/package.json'));
rb('reflect-metadata'); const { Test } = rb('@nestjs/testing');
const { chromium } = await import(pathToFileURL(path.resolve(values['playwright-module'])).href);
const load = name => import(pathToFileURL(path.join(root, 'BE/dist', name)).href);
const { AppModule } = await load('app.module.js'), { configureApp } = await load('configure-app.js');
const { createServer } = await import(pathToFileURL(rf.resolve('vite')).href);
const origin = 'http://127.0.0.1:5188';
Object.assign(process.env, { FRONTEND_URL: origin, SEARCH_SYNC_ENABLED: 'false', SEARCH_RECONCILIATION_ENABLED: 'false', PRODUCT_IMAGE_REPAIR_ENABLED: 'false', ORDER_AUTO_COMPLETE_ENABLED: 'false' });
const output = path.resolve(values.output); await mkdir(output, { recursive: true });
const results = [], screens = [], marker = `themeqa-${randomUUID().slice(0, 12)}`;
const password = `Qa-${randomUUID()}!`;
let app, vite, browser;
try {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = module.createNestApplication(); configureApp(app);
  await app.listen(0, '127.0.0.1'); process.env.VITE_API_URL = await app.getUrl();
  vite = await createServer({ root: path.join(root, 'FE'), server: { host: '127.0.0.1', port: 5188, strictPort: true } }); await vite.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const [name, width, height, colorScheme] of [['desktop-light',1440,1080,'light'],['desktop-dark',1440,1080,'dark'],['mobile-light',390,844,'light'],['mobile-dark',390,844,'dark']]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme }); const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors=[]; page.on('pageerror', e => errors.push(e.message));
    const email = `${marker}-${name}@example.test`;
    async function shot(step) { const file=`${name}-${step}.png`; if (step === '04-header-authenticated') await page.locator('header').screenshot({path:path.join(output,file)}); else await page.screenshot({path:path.join(output,file),fullPage:true}); screens.push(file); }
    await page.goto(origin + '/login');
    const title = page.getByRole('heading',{name:'Đăng nhập',exact:true}); await title.waitFor();
    const colors = await title.evaluate(h => ({ title:getComputedStyle(h).color, card:getComputedStyle(h.parentElement).backgroundColor, text:getComputedStyle(h.parentElement).color, scheme:getComputedStyle(h.parentElement).colorScheme, input:getComputedStyle(document.querySelector('input[name=email]')).backgroundColor, inputText:getComputedStyle(document.querySelector('input[name=email]')).color, placeholder:getComputedStyle(document.querySelector('header input'),'::placeholder').color, searchBg:getComputedStyle(document.querySelector('header input')).backgroundColor, pageWidth:document.documentElement.scrollWidth,viewport:innerWidth }));
    assert.equal(colors.title,'rgb(32, 36, 43)'); assert.equal(colors.card,'rgb(255, 255, 255)'); assert.equal(colors.scheme,'light'); assert.equal(colors.input,'rgb(255, 255, 255)'); assert.equal(colors.inputText,'rgb(32, 36, 43)'); assert.equal(colors.placeholder,'rgb(89, 97, 112)'); assert.equal(colors.searchBg,'rgb(255, 255, 255)'); assert(colors.pageWidth<=width);
    await page.evaluate(() => document.fonts.ready);
    assert(await page.locator('img[src="/images/auth-shopping-v1.webp"]').evaluate(image => image.complete && image.naturalWidth > 0));
    assert(await title.evaluate(h => getComputedStyle(h).fontFamily.includes('Inter')));
    assert.equal(await page.getByRole('button',{name:'Đăng nhập',exact:true}).evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(214, 59, 11)');
    await shot('01-login');
    await page.keyboard.press('Tab'); await page.getByLabel('Email',{exact:true}).focus(); assert.equal(await page.getByLabel('Email',{exact:true}).evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
    await page.getByLabel('Email',{exact:true}).fill(email); await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Đăng nhập',exact:true}).click(); await page.getByRole('alert').waitFor(); await shot('02-login-error');
    await page.getByRole('link',{name:'Đăng ký ngay',exact:true}).click();
    await page.getByRole('heading',{name:'Đăng ký',exact:true}).waitFor();
    await page.getByLabel('Họ và tên',{exact:true}).fill('QA Theme'); await page.getByLabel('Email',{exact:true}).fill(email); await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
    const accountType=page.getByRole('combobox'); assert.equal(await accountType.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
    assert.equal(await accountType.evaluate(e=>getComputedStyle(e).color),'rgb(32, 36, 43)'); await shot('03-register');
    await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click(); await page.waitForURL(origin+'/');
    await page.getByRole('link',{name:'Tài khoản (QA Theme)',exact:true}).waitFor(); assert((await context.cookies()).length>0);
    await shot('04-header-authenticated');
    await page.getByRole('button',{name:'Đăng xuất',exact:true}).click(); await page.getByRole('link',{name:'Đăng nhập',exact:true}).waitFor();
    await page.goto(origin+'/login'); await page.getByLabel('Email',{exact:true}).fill(email); await page.getByLabel('Mật khẩu',{exact:true}).fill(password); await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await page.waitForURL(url=>url.pathname!=='/login'); await page.getByRole('link',{name:'Tài khoản (QA Theme)',exact:true}).waitFor();
    assert.deepEqual(errors,[]); results.push({name,result:'PASS',colors,pageErrors:errors}); console.log(name+': PASS'); await context.close();
  }
  console.log('ALL 4 AUTH HEADER BROWSER SCENARIOS PASSED');
} catch(e) { results.push({name:'run',result:'FAIL',message:e.message}); throw e; }
finally {
  await writeFile(path.join(output,'results.json'),JSON.stringify({head:process.env.QA_HEAD,marker,layer:'REAL_CHROME_HTTP_POSTGRES',results,screens},null,2));
  await writeFile(path.join(output,'report.html'),`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Header/Auth QA</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto}img{max-width:100%}</style><h1>Header/Auth theme QA</h1><p>Chrome thật, API/PostgreSQL QA riêng; ${results.filter(r=>r.result==='PASS').length}/4 PASS. Ảnh chứa fixture tổng hợp; không token/credential.</p>${screens.map((s,i)=>`<article><h2>${i+1}. ${s}</h2><img src="${s}" alt="${s}"></article>`).join('')}</html>`);
  await browser?.close(); await vite?.close(); await app?.close();
}
