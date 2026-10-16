// Opt-in real Chrome + Nest HTTP + retained isolated PostgreSQL QA.
// No business response mocks except explicitly injected read/network faults.
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
assert.equal(db.hostname, '127.0.0.1'); assert.equal(db.port, '5549');
assert.equal(db.pathname, '/bckl_checkout_web_20261012');
assert([...db.searchParams].every(([k, v]) => k === 'schema' && v === 'public')); assert(!db.hash);
assert(process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireBE = createRequire(path.join(root, 'BE/package.json'));
const requireFE = createRequire(path.join(root, 'FE/package.json'));
requireBE('reflect-metadata');
const { Test } = requireBE('@nestjs/testing');
const { chromium } = await import(pathToFileURL(path.resolve(values['playwright-module'])).href);
const load = name => import(pathToFileURL(path.join(root, 'BE/dist', name)).href);
const { AppModule } = await load('app.module.js');
const { configureApp } = await load('configure-app.js');
const { PrismaService } = await load('prisma.service.js');
const { createServer } = await import(pathToFileURL(requireFE.resolve('vite')).href);
const output = path.resolve(values.output); await mkdir(output, { recursive: true });
const frontend = 'http://127.0.0.1:5187';
Object.assign(process.env, { FRONTEND_URL: frontend, SEARCH_SYNC_ENABLED: 'false', SEARCH_RECONCILIATION_ENABLED: 'false', PRODUCT_IMAGE_REPAIR_ENABLED: 'false', ORDER_AUTO_COMPLETE_ENABLED: 'false', CHECKOUT_CREATE_INTENTS_PER_MINUTE: '100' });
const marker = `orderweb-${randomUUID().slice(0, 18)}`;
const password = `Qa-${randomUUID()}!`;
const results = [], screenshots = [];
let app, vite, browser, api, prisma;
async function http(endpoint, token, method = 'GET', body, extraHeaders = {}) {
  const response = await fetch(api + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = response.status === 204 ? null : await response.json();
  assert(response.ok, `${endpoint} ${response.status}: ${JSON.stringify(data)}`); return data;
}
async function shot(page, name) {
  await page.locator('main').waitFor();
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  screenshots.push(`${name}.png`);
}
async function login(page, email) {
  await page.goto(frontend + '/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  // Login can legitimately restore a protected route captured during logout.
  await page.waitForURL(url => url.pathname !== '/login');
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).waitFor();
}
async function logout(page) {
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await page.getByRole('link', { name: 'Đăng nhập', exact: true }).waitFor();
}
try {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1'); api = await app.getUrl();
  prisma = app.get(PrismaService); process.env.VITE_API_URL = api;
  vite = await createServer({ root: path.join(root, 'FE'), server: { host: '127.0.0.1', port: 5187, strictPort: true } }); await vite.listen();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const seller = await prisma.user.create({ data: { email: `${marker}-seller@example.test`, passwordHash: await requireBE('bcryptjs').hash(password, 10), role: 'SELLER' } });
  const store = await prisma.store.create({ data: { sellerId: seller.id, name: 'QA Order Store', status: 'ACTIVE' } });
  const category = await prisma.category.create({ data: { name: 'QA Order leaf', slug: marker } });
  const product = await prisma.product.create({ data: { storeId: store.id, categoryId: category.id, name: 'QA Product snapshot', sellerStatus: 'ACTIVE', moderationStatus: 'APPROVED', images: { create: { url: '/uploads/qa-browser-only.jpg', isPrimary: true } }, shippingProfile: { create: { packageWeightGrams: 100 } } } });
  const variant = await prisma.productVariant.create({ data: { productId: product.id, storeId: store.id, skuCode: marker, optionSignature: 'default', price: '10000.00', stock: 100 } });
  async function buyer(label, count) {
    const email = `${marker}-${label}@example.test`;
    const session = await http('/auth/register', null, 'POST', { email, password, accountType: 'USER' });
    const address = await http('/me/addresses', session.accessToken, 'POST', { recipientName: `QA Buyer ${label}`, phone: '0901234567', province: 'QA Province', ward: 'QA Ward', addressLine: `QA Address ${label}`, isDefault: true });
    const orders = [];
    for (let i = 0; i < count; i++) {
      await http(`/cart/items/${variant.id}`, session.accessToken, 'PUT', { quantity: 1 });
      const receipt = await http('/checkouts', session.accessToken, 'POST', { addressId: address.id, paymentProvider: 'COD', items: [{ variantId: variant.id, quantity: 1, expectedUnitPrice: '10000.00' }] }, { 'Idempotency-Key': randomUUID() });
      orders.push(receipt.orders[0]);
    }
    return { email, session, orders };
  }
  const a = await buyer('A', 21), b = await buyer('B', 1);
  const order = a.orders.at(-1), other = b.orders[0];
  // Baseline after fixture creation. Read UI must not mutate any business record.
  async function baseline() {
    const ids = [...a.orders, ...b.orders].map(o => o.id);
    const [orders, histories, commands, movements, events, current] = await Promise.all([
      prisma.order.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, status: true, updatedAt: true, total: true } }),
      prisma.orderStatusHistory.count({ where: { orderId: { in: ids } } }),
      prisma.orderCommand.count({ where: { orderId: { in: ids } } }),
      prisma.stockMovement.count({ where: { variantId: variant.id } }),
      prisma.searchOutbox.count({ where: { productId: product.id } }),
      prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id }, select: { stock: true } }),
    ]); return JSON.stringify({ orders, histories, commands, movements, events, current });
  }
  const before = await baseline();
  for (const [name, width, height, colorScheme] of [['desktop-light', 1440, 1080, 'light'], ['desktop-dark', 1440, 1080, 'dark'], ['mobile-light', 390, 844, 'light'], ['mobile-dark', 390, 844, 'dark']]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const pageErrors = [], writes = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => { if (request.url().startsWith(api) && /\/(seller\/)?orders(?:\/|\?|$)/.test(new URL(request.url()).pathname) && request.method() !== 'GET') writes.push(request.method()); });
    await login(page, a.email); assert((await context.cookies()).length > 0);
    await page.goto(frontend + '/account'); await page.getByRole('link', { name: 'Đơn mua của tôi' }).click();
    await page.getByRole('button', { name: 'Trang tiếp theo', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Xem chi tiết / }).count(), 20);
    await shot(page, `${name}-01-buyer-list`);
    await page.getByRole('button', { name: 'Trang tiếp theo', exact: true }).click();
    await page.waitForURL(/afterId=/);
    await page.getByRole('button', { name: `Xem chi tiết ${a.orders[0].orderNumber}` }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Xem chi tiết / }).count(), 1);
    await shot(page, `${name}-02-next-page`);
    await page.getByRole('combobox', { name: /Trạng thái đơn/ }).selectOption('COMPLETED');
    await page.getByText('Chưa có đơn trong bộ lọc này.', { exact: true }).waitFor(); assert(!page.url().includes('afterId'));
    await shot(page, `${name}-03-empty-filter`);
    await page.getByRole('combobox', { name: /Trạng thái đơn/ }).selectOption('');
    await page.getByRole('button', { name: `Xem chi tiết ${order.orderNumber}` }).click();
    await page.getByRole('heading', { name: order.orderNumber, exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Hủy đơn', exact: true }).isDisabled());
    await shot(page, `${name}-04-buyer-detail`);
    const dimensions = await page.locator('section[aria-label="Chi tiết đơn hàng"]').evaluate(element => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, panelWidth: element.scrollWidth, panelClientWidth: element.clientWidth, heading: getComputedStyle(element.querySelector('h1')).color, surface: getComputedStyle(element.querySelector('section')).backgroundColor }));
    assert(dimensions.panelWidth <= dimensions.panelClientWidth, `Order panel horizontal overflow: ${JSON.stringify(dimensions)}`);
    await page.keyboard.press('Tab'); await page.getByRole('button', { name: 'Làm mới chi tiết đơn', exact: true }).focus();
    assert.equal(await page.getByRole('button', { name: 'Làm mới chi tiết đơn', exact: true }).evaluate(e => getComputedStyle(e).outlineStyle), 'solid');
    await logout(page); await login(page, seller.email);
    await prisma.store.update({ where: { id: store.id }, data: { status: 'SUSPENDED' } });
    try {
      await page.goto(frontend + '/seller/orders'); await page.getByRole('button', { name: `Xem chi tiết ${order.orderNumber}` }).click();
      await page.getByRole('heading', { name: order.orderNumber, exact: true }).waitFor();
      assert(await page.getByRole('button', { name: 'Xác nhận đơn', exact: true }).isDisabled());
      await shot(page, `${name}-05-seller-detail`);
    } finally { await prisma.store.update({ where: { id: store.id }, data: { status: 'ACTIVE' } }); }
    assert.deepEqual(writes, []); assert.deepEqual(pageErrors, []);
    results.push({ name, result: 'PASS', dimensions, pageErrors, businessWrites: writes.length });
    await context.close(); console.log(`${name}: PASS`);
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await context.newPage(); page.setDefaultTimeout(15000); await login(page, a.email);
  // Fault injection affects GET only; do not synthesize successful business data.
  await page.route(api + '/orders?*', route => route.abort('failed'));
  await page.goto(frontend + '/account/orders'); await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('Chưa có đơn trong bộ lọc này.', { exact: true }).count(), 0);
  await shot(page, 'fault-01-network-list');
  await page.unroute(api + '/orders?*'); await page.getByRole('button', { name: 'Tải lại đơn', exact: true }).click();
  await page.getByRole('button', { name: 'Trang tiếp theo', exact: true }).waitFor();
  await page.route(api + `/orders/${order.id}`, route => route.abort('failed'));
  await page.goto(frontend + `/account/orders/${order.id}`); await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('QA Buyer A', { exact: false }).count(), 0);
  await shot(page, 'fault-02-network-detail');
  await page.unroute(api + `/orders/${order.id}`); await page.getByRole('button', { name: 'Tải lại đơn', exact: true }).click();
  await page.getByRole('heading', { name: order.orderNumber, exact: true }).waitFor();
  await shot(page, 'fault-03-recovered');
  let release, captured;
  const hold = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { captured = resolve; });
  await page.route(api + `/orders/${order.id}`, async route => {
    const response = await route.fetch(); captured(); await hold;
    try { await route.fulfill({ response }); } catch { /* Old request can be aborted on unmount. */ }
  });
  await page.getByRole('button', { name: 'Làm mới chi tiết đơn', exact: true }).click(); await started;
  await page.getByText('Đang tải đơn hàng…', { exact: true }).waitFor(); await shot(page, 'session-01-held-read');
  await logout(page); await login(page, b.email);
  await page.goto(frontend + `/account/orders/${other.id}`); await page.getByRole('heading', { name: other.orderNumber, exact: true }).waitFor();
  release(); await page.unroute(api + `/orders/${order.id}`);
  assert.equal(await page.getByRole('heading', { name: order.orderNumber, exact: true }).count(), 0);
  assert.equal(await page.getByText('QA Buyer A', { exact: false }).count(), 0);
  await shot(page, 'session-02-buyer-b');
  await page.goto(frontend + `/account/orders/${order.id}`); await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('heading', { name: order.orderNumber, exact: true }).count(), 0);
  await shot(page, 'session-03-ownership-404');
  await logout(page); await page.goto(frontend + `/account/orders/${other.id}`); await page.getByRole('heading', { name: 'Đăng nhập', exact: true }).waitFor();
  await shot(page, 'session-04-guest-redirect');
  await context.close();
  results.push({ name: 'network-and-account-switch', result: 'PASS', description: 'Real login/logout/refresh cookies; held old GET, GET abort faults, recovery and ownership 404; no AuthContext injection' });
  assert.equal(await baseline(), before, 'Read-only browser flow mutated business baseline');
  console.log('ALL 5 ORDER BROWSER SCENARIOS PASSED');
} catch (error) {
  results.push({ name: 'run', result: 'FAIL', message: error.message }); throw error;
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ head: process.env.QA_HEAD, marker, layer: 'REAL_CHROME_HTTP_POSTGRES', bootstrap: 'Seller/store/catalog in QA DB; 22 orders through real Cart/Checkout APIs', fixtureIntentQuota: 100, results, screenshots }, null, 2));
  await writeFile(path.join(output, 'report.html'), `<!doctype html><html lang="vi"><meta charset="utf-8"><title>PR57 Browser QA</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:16px;color:#20242b}img{max-width:100%;border:1px solid #ddd}article{margin:32px 0}</style><h1>PR #57 — Order read browser QA</h1><p>Head ${process.env.QA_HEAD}. Chrome riêng → Nest HTTP → PostgreSQL QA5549. ${results.filter(r => r.result === 'PASS').length}/5 scenarios PASS. Không phải toàn luồng xử lý đơn.</p>${screenshots.map((file, i) => `<article><h2>${i + 1}. ${file}</h2><img src="${file}" alt="${file}"></article>`).join('')}<h2>Giới hạn</h2><p>Thiết bị di động là viewport giả lập; chưa screen reader, touch device, Safari/Firefox hoặc POST Order. Header dùng chung còn placeholder ô tìm kiếm khó đọc ở dark preference; không đổi trong PR này.</p></html>`);
  await browser?.close(); await vite?.close(); await app?.close();
}
