// Current-source in-app notification acceptance. Synthetic actors/catalog; genuine business HTTP events.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { output: { type: 'string' }, python: { type: 'string' } } });
assert(values.output && values.python && path.isAbsolute(values.python), 'Explicit outside-checkout output and absolute Python executable required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.resolve(values.output);
const rootId = root.toLowerCase(), outId = out.toLowerCase();
assert(outId !== rootId && !outId.startsWith(rootId + path.sep), 'Private fixture must remain outside checkout');
assert(!fs.existsSync(out), 'Output must be new');
const target = new URL(process.env.DATABASE_URL ?? '');
assert.equal(target.protocol, 'postgresql:'); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '5549');
assert.match(target.pathname, /^\/bckl_order_resolution_test_notify_20261030_[0-9]{13}$/);
assert.equal(target.username, 'bckl_local_app');
assert(!target.hash && [...target.searchParams].every(([k,v]) => k === 'schema' && v === 'public') && target.searchParams.getAll('schema').length <= 1);
for (const f of ['.env', 'BE/.env', 'FE/.env', 'FE/.env.local']) assert(!fs.existsSync(path.join(root, f)), 'Refusing dotenv checkout');
assert(process.env.JWT_ACCESS_SECRET && process.env.JWT_REFRESH_SECRET);
const web = 'http://127.0.0.1:5199';
Object.assign(process.env, {
  FRONTEND_URL: web, NOTIFICATIONS_ENABLED: 'true', NOTIFICATIONS_WORKER_ENABLED: 'false',
  NOTIFICATION_EMAIL_ENABLED: 'false', NOTIFICATION_EMAIL_WORKER_ENABLED: 'false', EMAIL_NOTIFICATION_WORKER_ENABLED: 'false',
  AUTH_EMAIL_ENABLED: 'false', AUTH_GOOGLE_ENABLED: 'false', AUTH_PHONE_OTP_SANDBOX_ENABLED: 'false',
  SELLER_ONBOARDING_ENABLED: 'true', ACCOUNT_BUYER_ACCESS_ENABLED: 'true',
  SEARCH_SYNC_ENABLED: 'false', SEARCH_RECONCILIATION_ENABLED: 'false', SEARCH_ANALYTICS_ENABLED: 'false', SEARCH_ANALYTICS_RETENTION_ENABLED: 'false',
  PRODUCT_IMAGE_REPAIR_ENABLED: 'false', ORDER_AUTO_COMPLETE_ENABLED: 'false',
});
await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(5199, '127.0.0.1', () => probe.close(resolve)); });
fs.mkdirSync(out, { recursive: true });
const req = createRequire(path.join(root, 'BE/package.json')), rf = createRequire(path.join(root, 'FE/package.json'));
req('reflect-metadata'); const load = p => import(pathToFileURL(path.join(root, 'BE/dist', p)).href);
const { AppModule } = await load('app.module.js'), { configureApp } = await load('configure-app.js'), { PrismaService } = await load('prisma.service.js'), { Test } = req('@nestjs/testing');
const sourceFiles = [
  'BE/src/notification/notification.controller.ts', 'BE/src/notification/notification.service.ts', 'BE/src/notification/notification-projector.ts',
  'BE/src/notification/notification-sources.ts', 'BE/src/notification/notification-input.ts', 'BE/src/notification/notification-email-worker.ts', 'BE/src/configure-app.ts',
  'FE/src/features/notifications/notificationClient.ts', 'FE/src/features/notifications/NotificationsPage.tsx', 'FE/src/features/notifications/NotificationsPage.module.css',
  'FE/src/components/Header/Header.tsx', 'FE/src/routes/AppRouter.tsx',
  'scripts/test-notifications-final-browser.mjs', 'scripts/test-notifications-final-browser.py',
];
const hashes = () => Object.fromEntries(sourceFiles.map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const sourceBefore = hashes(), marker = 'notify-' + randomUUID().slice(0, 8), password = 'Synthetic-' + randomUUID() + '!';
let app, vite;
try {
  app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ bodyParser: false });
  configureApp(app); await app.listen(0, '127.0.0.1'); const api = await app.getUrl(), db = app.get(PrismaService);
  const [role] = await db.$queryRaw`SELECT current_user name,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super,(SELECT rolcreatedb FROM pg_roles WHERE rolname=current_user) createdb,(SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) createrole,has_schema_privilege(current_user,'public','CREATE') ddl`;
  assert.equal(role.name, 'bckl_local_app'); assert(!role.super && !role.createdb && !role.createrole && !role.ddl);
  const migrations = fs.readdirSync(path.join(root, 'BE/prisma/migrations'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  const applied = await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  assert.deepEqual(applied.map(m => m.migration_name), migrations); assert.equal(await db.order.count(), 0, 'Use a fresh notification QA database');
  const request = (endpoint, token, method = 'GET', body, key) => fetch(api + endpoint, { method, headers: { 'Content-Type': 'application/json', Origin: web, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const http = async (endpoint, token, method = 'GET', body, key) => { const r = await request(endpoint, token, method, body, key); assert(r.ok, 'Synthetic HTTP fixture ' + endpoint + ' returned ' + r.status); return r.json(); };
  const actors = {}, passwordHash = await req('bcryptjs').hash(password, 4);
  for (const [name, roleName] of [['BUYER','USER'], ['OTHER_BUYER','USER'], ['SELLER','SELLER'], ['OTHER_SELLER','SELLER'], ['ADMIN','ADMIN']]) {
    const actor = await db.user.create({ data: { email: marker + '-' + name.toLowerCase() + '@example.test', passwordHash, role: roleName } });
    const login = await http('/auth/login', null, 'POST', { email: actor.email, password });
    actors[name] = { id: actor.id, email: actor.email, password, token: login.accessToken };
  }
  const store = await db.store.create({ data: { sellerId: actors.SELLER.id, name: 'Synthetic notification Store', status: 'ACTIVE' } });
  await db.store.create({ data: { sellerId: actors.OTHER_SELLER.id, name: 'Synthetic foreign notification Store', status: 'ACTIVE' } });
  const category = await db.category.create({ data: { name: 'Notification QA leaf', slug: marker } });
  const product = await db.product.create({ data: { storeId: store.id, categoryId: category.id, name: 'Synthetic notification product', sellerStatus: 'ACTIVE', moderationStatus: 'APPROVED', images: { create: { url: '/uploads/notify-qa.jpg', isPrimary: true } }, shippingProfile: { create: { packageWeightGrams: 100 } } } });
  const variant = await db.productVariant.create({ data: { productId: product.id, storeId: store.id, skuCode: marker, optionSignature: 'default', price: '10000.00', stock: 5 } });
  await http('/me/addresses', actors.BUYER.token, 'POST', { recipientName: 'PRIVATE_SYNTHETIC_RECIPIENT', phone: '0901234567', province: 'QA', ward: 'QA', addressLine: 'PRIVATE_SYNTHETIC_ADDRESS', isDefault: true });
  const address = await db.userAddress.findFirstOrThrow({ where: { userId: actors.BUYER.id } });
  await http('/cart/items/' + variant.id, actors.BUYER.token, 'PUT', { quantity: 2 });
  const purchase = await http('/checkouts', actors.BUYER.token, 'POST', { addressId: address.id, paymentProvider: 'COD', items: [{ variantId: variant.id, quantity: 2, expectedUnitPrice: '10000.00' }] }, randomUUID());
  const orderId = purchase.orders[0].id;
  for (const command of ['confirm', 'start-packing']) await http(`/seller/orders/${orderId}/${command}`, actors.SELLER.token, 'POST', {}, randomUUID());
  const application = await http('/account/store-application', actors.OTHER_BUYER.token, 'POST', {
    commandId: randomUUID(), confirmed: true, reason: 'PRIVATE_SYNTHETIC_APPLICATION', name: 'Synthetic pending notification Store', description: '',
    contactName: 'Synthetic Owner', contactPhone: '+84901234567', pickupAddress: 'Synthetic pickup address 01', returnAddress: 'Synthetic return address 01',
  });
  const pendingStoreId = application.receipt.storeId;
  const initial = {}; for (const [name, actor] of Object.entries(actors)) initial[name] = await http('/account/notifications?limit=20', actor.token);
  assert.equal(initial.BUYER.items.length, 2); assert.equal(initial.SELLER.items.length, 1); assert.equal(initial.ADMIN.items.length, 1);
  assert.equal(initial.OTHER_BUYER.items.length, 0); assert.equal(initial.OTHER_SELLER.items.length, 0);
  for (const name of ['BUYER', 'SELLER', 'ADMIN', 'OTHER_BUYER', 'OTHER_SELLER']) {
    const p = initial[name]; assert.equal(p.unreadCount, p.items.length); assert.equal(p.syncPending, false);
    for (const n of p.items) {
      assert.deepEqual(Object.keys(n).sort(), ['id','title','text','link','eventAt','createdAt','readAt'].sort());
      assert.equal(n.readAt, null); assert(!/PRIVATE_|recipientId|sourceId|password|0901234567/.test(JSON.stringify(n)));
    }
  }
  assert(initial.BUYER.items.every(n => n.link === '/account/orders/' + orderId));
  assert(initial.SELLER.items.every(n => n.link === '/seller/orders/' + orderId));
  assert.equal(initial.ADMIN.items[0].link, '/admin/store-applications?storeId=' + pendingStoreId);
  const projection = await db.notification.findMany({ orderBy: { id: 'asc' } });
  const probes = [{ name: 'actual-checkout-preparation-and-Store-application-correct-recipients', result: 'PASS' }];
  for (const name of ['OTHER_BUYER', 'OTHER_SELLER', 'SELLER', 'ADMIN']) {
    const id = initial.BUYER.items[0].id;
    for (const [endpoint, body] of [[`/account/notifications/${id}/read`, { confirmed: true }], ['/account/notifications/read-all', { confirmed: true, throughId: id }]]) {
      const r = await request(endpoint, actors[name].token, 'POST', body); assert.equal(r.status, 404, name + ' foreign notification');
      assert.deepEqual(await db.notification.findMany({ orderBy: { id: 'asc' } }), projection, 'Foreign read cannot change unread/read state');
    }
    const list = await http('/account/notifications?limit=20', actors[name].token); assert.equal(list.unreadCount, initial[name].unreadCount);
    probes.push({ name: name + '-foreign-read-and-read-all-isolated', result: 'PASS' });
  }
  assert.equal((await request('/account/notifications?recipientId=' + actors.BUYER.id, actors.OTHER_BUYER.token)).status, 400);
  assert.equal((await request('/account/notifications', null)).status, 401);
  probes.push({ name: 'recipient-query-override-and-anonymous-denied', result: 'PASS' });
  const coreTables = ['orders','order_items','payments','stock_movements','order_status_history','product_variants','products','search_outbox','checkouts','stores','store_status_history'];
  const businessHashes = async () => Object.fromEntries(await Promise.all(coreTables.map(async table => { const [row] = await db.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text data FROM ${table} t`); return [table, createHash('sha256').update(row.data).digest('hex')]; })));
  const before = await businessHashes(); assert.equal(await db.notificationEmailJob.count(), 0);
  process.env.VITE_API_URL = api; process.env.VITE_NOTIFICATIONS_ENABLED = 'true'; process.env.VITE_ACCOUNT_BUYER_ACCESS_ENABLED = 'true'; process.env.VITE_SELLER_ONBOARDING_ENABLED = 'true';
  const { createServer } = await import(pathToFileURL(rf.resolve('vite')).href);
  vite = await createServer({ root: path.join(root, 'FE'), envDir: false, server: { host: '127.0.0.1', port: 5199, strictPort: true } }); await vite.listen();
  const fixture = path.join(out, 'fixture.private.json'); fs.writeFileSync(fixture, JSON.stringify({ web, api, actors, initial, orderId, pendingStoreId }));
  const code = await new Promise((resolve, reject) => { const child = spawn(values.python, [path.join(root, 'scripts/test-notifications-final-browser.py'), '--fixture', fixture, '--output', out], { cwd: root, env: process.env, windowsHide: true, stdio: 'inherit' }); child.on('error', reject); child.on('exit', resolve); });
  assert.equal(code, 0, 'Native notification Chrome acceptance failed');
  const buyerNotices = await db.notification.findMany({ where: { recipientId: actors.BUYER.id }, orderBy: { id: 'asc' } });
  assert.equal(buyerNotices.length, 2); assert(buyerNotices.every(n => n.readAt instanceof Date));
  const first = buyerNotices[0], acknowledged = await http(`/account/notifications/${first.id}/read`, actors.BUYER.token, 'POST', { confirmed: true });
  assert.equal(acknowledged.readAt, first.readAt.toISOString());
  assert.equal((await http('/account/notifications?limit=20', actors.BUYER.token)).unreadCount, 0);
  assert.equal((await http('/account/notifications?limit=20', actors.SELLER.token)).unreadCount, 1);
  assert.equal((await http('/account/notifications?limit=20', actors.ADMIN.token)).unreadCount, 1);
  assert.equal((await http('/account/notifications?limit=20', actors.OTHER_BUYER.token)).unreadCount, 0);
  assert.equal(await db.notification.count(), 4); assert.equal(await db.notificationEmailJob.count(), 0);
  assert.deepEqual(await businessHashes(), before, 'Notification operations changed committed business state');
  assert.deepEqual(hashes(), sourceBefore, 'Source changed during acceptance');
  fs.writeFileSync(path.join(out, 'ledger-report.json'), JSON.stringify({ result: 'PASS', scope: 'CURRENT_NATIVE_CHROME_HTTP_PG_IN_APP_NOTIFICATIONS', database: target.pathname,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), migrations, sourceHashes: sourceBefore, probes,
    orderId, pendingStoreId, financialCoreUnchanged: true, businessHashes: before, notificationRows: 4, emailJobs: 0,
    limits: ['Synthetic actors/catalog; actual COD Checkout, Seller commands and Store application HTTP create sources; native UI handles inbox/read state', 'No email, provider, payment/courier production or background worker; on-demand GET projection enabled', 'Held response release may be aborted by session/navigation fence; no claim old payload was consumed after logout', 'Bounded fixture acceptance, not workload, all source types or full pentest'] }, null, 2));
  console.log(JSON.stringify({ result: 'PASS', httpGroups: probes.length, out }));
} finally { await vite?.close(); await app?.close(); }
