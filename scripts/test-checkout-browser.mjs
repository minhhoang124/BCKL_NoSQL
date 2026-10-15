// Real Chromium -> real Nest HTTP -> isolated PostgreSQL; not demo/production.
// Requires BE build and provisioned QA migrations. No application source is changed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  'playwright-module': { type: 'string' },
  channel: { type: 'string', default: 'chrome' },
  output: { type: 'string', default: 'artifacts/checkout-browser' },
  'evidence-output': { type: 'string' },
} });
const db = new URL(process.env.DATABASE_URL ?? '');
assert.equal(db.hostname, '127.0.0.1');
assert.equal(db.port, '5549');
assert.equal(db.pathname, '/bckl_checkout_web_20261012');
assert([...db.searchParams].every(([k, v]) => k === 'schema' && v === 'public'));
assert(!db.hash);
assert(process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET, 'Explicit QA secrets required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireBE = createRequire(path.join(root, 'BE/package.json'));
const requireFE = createRequire(path.join(root, 'FE/package.json'));
requireBE('reflect-metadata');
const { Test } = requireBE('@nestjs/testing');
const loadBE = name => import(pathToFileURL(path.join(root, 'BE/dist', name)).href);
const { AppModule } = await loadBE('app.module.js');
const { configureApp } = await loadBE('configure-app.js');
const { PrismaService } = await loadBE('prisma.service.js');
const { createServer } = await import(pathToFileURL(requireFE.resolve('vite')).href);
const { chromium } = values['playwright-module']
  ? await import(pathToFileURL(path.resolve(values['playwright-module'])).href)
  : await import('playwright');
await mkdir(values.output, { recursive: true });
if (values['evidence-output']) await mkdir(values['evidence-output'], { recursive: true });
const frontend = 'http://127.0.0.1:5186';
process.env.FRONTEND_URL = frontend;
process.env.SEARCH_SYNC_ENABLED = 'false';
process.env.SEARCH_RECONCILIATION_ENABLED = 'false';
process.env.PRODUCT_IMAGE_REPAIR_ENABLED = 'false';
let app, vite, browser;
const results = [];
const marker = `browserqa-${randomUUID().slice(0, 18)}`;
const password = `Qa-only-${randomUUID()}!`;
try {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app);
  await app.listen(0, '127.0.0.1');
  const api = await app.getUrl();
  const prisma = app.get(PrismaService);
  process.env.VITE_API_URL = api;
  vite = await createServer({ root: path.join(root, 'FE'), server: { host: '127.0.0.1', port: 5186, strictPort: true } });
  await vite.listen();
  browser = await chromium.launch({ headless: true, channel: values.channel });
  const seller = await prisma.user.create({ data: { email: `${marker}-seller@example.test`, passwordHash: 'no-login-qa', role: 'SELLER' } });
  const store = await prisma.store.create({ data: { sellerId: seller.id, name: 'QA — Cửa hàng kiểm thử', status: 'ACTIVE' } });
  const category = await prisma.category.create({ data: { name: 'QA browser leaf', slug: marker } });
  async function http(endpoint, token, method = 'GET', body) {
    const response = await fetch(api + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = response.status === 204 ? null : await response.json(); assert(response.ok, JSON.stringify(data)); return data;
  }
  const cases = [
    ['desktop-light', 1440, 1080, 'light', 'success'],
    ['desktop-dark', 1440, 1080, 'dark', 'lost-response'],
    ['mobile-light', 390, 844, 'light', 'price'],
    ['mobile-dark', 390, 844, 'dark', 'stock'],
  ];
  for (const [name, width, height, colorScheme, scenario] of cases) {
    const email = `${marker}-${name}@example.test`;
    const session = await http('/auth/register', null, 'POST', { email, password, accountType: 'USER' });
    const product = await prisma.product.create({ data: { storeId: store.id, categoryId: category.id, name: 'QA — Tai nghe kiểm thử trình duyệt', sellerStatus: 'ACTIVE', moderationStatus: 'APPROVED', images: { create: { url: '/uploads/qa-browser-only.jpg', isPrimary: true } }, shippingProfile: { create: { packageWeightGrams: 100 } } } });
    const variant = await prisma.productVariant.create({ data: { productId: product.id, storeId: store.id, skuCode: `${marker}-${name}`, optionSignature: 'default', price: '10000.00', stock: 5 } });
    const untouched = await prisma.productVariant.create({ data: { productId: product.id, storeId: store.id, skuCode: `${marker}-${name}-other`, optionSignature: 'other', price: '15000.00', stock: 5 } });
    await http(`/cart/items/${variant.id}`, session.accessToken, 'PUT', { quantity: 2 });
    await http(`/cart/items/${untouched.id}`, session.accessToken, 'PUT', { quantity: 1 });
    const context = await browser.newContext({ viewport: { width, height }, colorScheme });
    const page = await context.newPage();
    const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
    const shot = async step => {
      const filename = `${name}-${step}.png`;
      await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await page.screenshot({ path: path.join(values.output, filename), fullPage: true });
      if (values['evidence-output'] && ['mobile-dark-01-checkout.png', 'mobile-light-03-rejected.png', 'desktop-dark-03-pending.png', 'mobile-dark-04-receipt.png'].includes(filename)) {
        // Only synthetic QA Checkout content; omit header/email/session surfaces.
        await page.locator('main h1').locator('..').screenshot({ path: path.join(values['evidence-output'], filename), style: 'header { visibility: hidden !important; }' });
      }
      return filename;
    };
    // Real login and refresh cookie, no injected AuthContext/access token.
    await page.goto(frontend + '/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.waitForURL(frontend + '/');
    assert((await context.cookies()).length > 0, 'Real session cookie required');
    await page.goto(frontend + '/account/addresses');
    await page.getByRole('button', { name: '+ Thêm địa chỉ mới' }).click();
    for (const [label, value] of [['Họ và tên người nhận', 'Người nhận QA'], ['Số điện thoại', '0901234567'], ['Tỉnh / thành phố', 'Thành phố QA'], ['Phường / xã', 'Phường QA'], ['Địa chỉ cụ thể', '10 Đường kiểm thử QA']]) await page.getByLabel(new RegExp(label)).fill(value);
    await page.getByRole('button', { name: 'Lưu địa chỉ', exact: true }).click();
    await page.getByText('Đã thêm địa chỉ.', { exact: true }).waitFor();
    await page.goto(frontend + '/cart');
    const selected = page.getByLabel(`Chọn biến thể ${variant.id}`, { exact: true });
    await selected.check();
    await page.getByLabel(`Chọn biến thể ${untouched.id}`, { exact: true }).uncheck();
    await page.getByRole('link', { name: 'Tiếp tục thanh toán' }).click();
    await page.getByRole('heading', { name: 'Xác nhận mua hàng' }).waitFor();
    const preview = page.getByRole('button', { name: 'Kiểm tra giá và kho' });
    await preview.waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Kiểm tra giá và kho')?.disabled);
    const screens = [await shot('01-checkout')];
    const measurements = await page.getByRole('heading', { name: 'Xác nhận mua hàng' }).evaluate(h => {
      const p = h.parentElement, hs = getComputedStyle(h), ps = getComputedStyle(p);
      const select = getComputedStyle(p.querySelector('select'));
      return { heading: hs.color, surface: ps.backgroundColor, text: ps.color, selectText: select.color, selectBackground: select.backgroundColor,
        pageWidth: p.scrollWidth, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth };
    });
    assert.equal(measurements.heading, 'rgb(32, 36, 43)');
    assert.equal(measurements.surface, 'rgb(255, 255, 255)');
    assert.equal(measurements.selectText, 'rgb(32, 36, 43)');
    assert.equal(measurements.selectBackground, 'rgb(255, 255, 255)');
    assert(measurements.documentWidth <= width, `${name} horizontal overflow ${JSON.stringify(measurements)}`);
    await page.keyboard.press('Tab'); // Enter keyboard modality before checking :focus-visible.
    await preview.focus();
    assert.equal(await preview.evaluate(e => getComputedStyle(e).outlineStyle), 'solid');
    await preview.press('Enter');
    const place = page.getByRole('button', { name: 'Đặt hàng COD', exact: true });
    await place.waitFor();
    screens.push(await shot('02-preview'));
    if (scenario === 'price' || scenario === 'stock') {
      await prisma.productVariant.update({ where: { id: variant.id }, data: scenario === 'price' ? { price: '12000.00' } : { stock: 1 } });
      await place.click(); await page.getByRole('alert').first().waitFor();
      screens.push(await shot('03-rejected'));
      assert.equal(await prisma.order.count({ where: { buyerId: session.user.id } }), 0);
      assert.equal(await prisma.stockMovement.count({ where: { variantId: variant.id } }), 0);
      assert.equal(await prisma.searchOutbox.count({ where: { productId: product.id } }), 0);
      assert.equal(await prisma.cartItem.count({ where: { variantId: variant.id } }), 1);
      await prisma.productVariant.update({ where: { id: variant.id }, data: { price: '10000.00', stock: 5 } });
      await page.getByRole('button', { name: 'Tải lại giỏ và giá' }).click();
      await preview.click(); await place.waitFor();
    }
    const posts = [];
    if (scenario === 'lost-response') {
      let lost = false;
      await page.route(api + '/checkouts', async route => {
        const request = route.request();
        if (request.method() !== 'POST') return route.continue();
        posts.push({ key: request.headers()['idempotency-key'], body: request.postData() });
        if (lost) return route.continue();
        lost = true; const response = await route.fetch();
        assert.equal(response.status(), 201); await response.body(); await route.abort('failed');
      });
    }
    await place.click();
    if (scenario === 'lost-response') {
      const retry = page.getByRole('button', { name: 'Gửi lại cùng yêu cầu' });
      await retry.waitFor();
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Gửi lại cùng yêu cầu')?.disabled);
      screens.push(await shot('03-pending'));
      await page.reload(); await retry.waitFor(); await retry.click();
    }
    await page.getByRole('heading', { name: 'Đã ghi nhận đặt hàng COD' }).waitFor();
    screens.push(await shot('04-receipt'));
    const orders = await prisma.order.findMany({ where: { buyerId: session.user.id }, include: { items: true, payment: true } });
    assert.equal(orders.length, 1); assert.equal(orders[0].total.toFixed(2), '20000.00');
    assert.equal(orders[0].status, 'PENDING_CONFIRMATION'); assert.equal(orders[0].payment.status, 'UNPAID');
    assert.equal(orders[0].items.length, 1); assert.equal(orders[0].addressLineSnapshot, '10 Đường kiểm thử QA');
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock, 3);
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: untouched.id } })).stock, 5);
    assert.equal(await prisma.stockMovement.count({ where: { variantId: variant.id } }), 1);
    assert.equal(await prisma.searchOutbox.count({ where: { productId: product.id } }), 1);
    assert.equal(await prisma.cartItem.count({ where: { variantId: variant.id } }), 0);
    assert.equal(await prisma.cartItem.count({ where: { variantId: untouched.id } }), 1);
    if (scenario === 'lost-response') { assert.equal(posts.length, 2); assert.deepEqual(posts[0], posts[1]); }
    if (name === 'mobile-dark') {
      await http(`/cart/items/${untouched.id}`, session.accessToken, 'DELETE');
      await page.goto(frontend + '/checkout');
      await page.getByText('Giỏ chưa có mặt hàng mua được.', { exact: true }).waitFor();
      assert(await preview.isDisabled());
      screens.push(await shot('05-empty'));
      let release;
      const held = new Promise(resolve => { release = resolve; });
      await page.route(api + '/cart', async route => { await held; await route.continue(); });
      await page.goto(frontend + '/checkout');
      await page.getByRole('status').getByText('Đang tải địa chỉ và giỏ hàng…', { exact: true }).waitFor();
      screens.push(await shot('06-loading'));
      release(); await page.getByText('Giỏ chưa có mặt hàng mua được.', { exact: true }).waitFor();
      await page.unroute(api + '/cart');
      await page.route(api + '/cart', route => route.abort('failed'));
      await page.goto(frontend + '/checkout');
      await page.getByRole('button', { name: 'Tải lại', exact: true }).waitFor();
      assert.equal(await page.getByText(/Chưa có địa chỉ nhận hàng/).count(), 0);
      assert.equal(await preview.count(), 0);
      screens.push(await shot('07-network-error'));
      await page.unroute(api + '/cart');
      await page.getByRole('button', { name: 'Tải lại', exact: true }).click();
      await page.getByText('Giỏ chưa có mặt hàng mua được.', { exact: true }).waitFor();
    }
    assert.deepEqual(pageErrors, []);
    results.push({ name, scenario, result: 'PASS', measurements, screens, orderId: orders[0].id, pageErrors });
    console.log(`${name}: PASS`);
    await context.close();
  }
  await writeFile(path.join(values.output, 'results.json'), JSON.stringify({ head: process.env.QA_HEAD, evidence: 'REAL_BROWSER_HTTP_POSTGRES', marker, results }, null, 2));
  const labels = { '01-checkout': 'Chọn địa chỉ và đúng dòng giỏ; chưa giữ kho.', '02-preview': 'Preview giá/kho từ API thật, tổng 20.000 đ.', '03-rejected': 'Đổi giá/thiếu kho: từ chối; DB không tạo đơn, movement hoặc outbox.', '03-pending': 'Mất response sau commit thật: giữ mã và body, reload rồi replay không tạo trùng.', '04-receipt': 'Biên nhận COD thật trong DB QA, không phải trạng thái giao hàng.', '05-empty': 'Giỏ rỗng: nút preview bị khóa.', '06-loading': 'Cố ý giữ GET cart để chụp trạng thái đang tải.', '07-network-error': 'Cố ý lỗi GET cart: có nút tải lại, retry tải được dữ liệu thật.' };
  let step = 0;
  await writeFile(path.join(values.output, 'report.html'), `<!doctype html><html lang="vi"><meta charset="utf-8"><title>QA #54</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:16px;color:#20242b}img{max-width:100%;border:1px solid #ddd}article{margin:32px 0}</style><h1>PR #54 — Browser QA</h1><p>Head ${process.env.QA_HEAD}. Chrome thật → Nest HTTP → PostgreSQL QA. 4/4 scenarios PASS. Không kiểm Search dispatch hoặc toàn vòng đời Order. Ảnh/dữ liệu chỉ thuộc QA.</p>${results.flatMap(r => r.screens.map(file => `<article><h2>${++step}. ${file}</h2><p>PASS — ${labels[file.replace(r.name + '-', '').replace('.png', '')]}</p><img src="${file}" alt="${file}"></article>`)).join('')}<h2>UX đã sửa và giới hạn</h2><p>Địa chỉ đã có tóm tắt đầy đủ ngoài native select. Lỗi giá/kho có nút tải lại trước preview mới. GET lỗi không báo thiếu địa chỉ và khóa dữ liệu cũ. Pending vẫn giữ key/body để replay. Header global dark mode còn ô search tối/chữ placeholder khó đọc, ngoài Checkout module. Chưa kiểm screen reader, Safari/Firefox, thiết bị thật, nhiều Store đồng thời hoặc Search worker.</p></html>`);
  console.log('ALL 4 BROWSER SCENARIOS PASSED');
} finally {
  await browser?.close(); await vite?.close(); await app?.close();
}
