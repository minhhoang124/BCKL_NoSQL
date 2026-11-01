// BUY-02 email-confirmed password change: real Chrome -> Vite FE -> Nest (BE/dist) -> fresh DML-only QA PostgreSQL.
// Mail delivery is replaced by an in-memory capture: no real email is sent or claimed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import path from 'node:path';

const { values } = parseArgs({ options: { output: { type: 'string' }, 'playwright-module': { type: 'string' } } });
assert(values.output && values['playwright-module']);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = new URL(process.env.DATABASE_URL ?? '');
assert.equal(url.protocol, 'postgresql:');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '5549');
assert.match(url.pathname, /^\/bckl_order_resolution_test_pwchange_[0-9]+$/);
assert.equal(url.username, 'bckl_local_app');
for (const f of ['.env', 'BE/.env', 'FE/.env', 'FE/.env.local'])
  try { await access(path.join(root, f)); throw Error('Refusing dotenv checkout'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
for (const flag of ['SEARCH_SYNC_ENABLED', 'SEARCH_RECONCILIATION_ENABLED', 'PRODUCT_IMAGE_REPAIR_ENABLED', 'ORDER_AUTO_COMPLETE_ENABLED'])
  assert.equal(process.env[flag], 'false');

const api = 'http://127.0.0.1:3393', web = 'http://127.0.0.1:5193';
Object.assign(process.env, {
  FRONTEND_URL: web,
  AUTH_EMAIL_ENABLED: 'true',
  AUTH_EMAIL_HMAC_SECRET: 'synthetic-password-change-browser-only-2026',
  AUTH_PASSWORD_CHANGE_MODE: 'EMAIL',
  ACCOUNT_SETTINGS_WRITE_ENABLED: 'true',
  NOTIFICATIONS_WORKER_ENABLED: 'false',
});

const output = path.resolve(values.output);
await mkdir(output, { recursive: true });
const rb = createRequire(path.join(root, 'BE/package.json')), rf = createRequire(path.join(root, 'FE/package.json'));
rb('reflect-metadata');
const { Test } = rb('@nestjs/testing'), { hash, compare } = rb('bcryptjs');
const load = (n) => import(pathToFileURL(path.join(root, 'BE/dist', n)).href);
const { AppModule } = await load('app.module.js'), { configureApp } = await load('configure-app.js'),
  { PrismaService } = await load('prisma.service.js'), { AuthEmailDelivery } = await load('auth/email-delivery.js');
const { createServer } = await import(pathToFileURL(rf.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(rf.resolve('@vitejs/plugin-react')).href);
const pw = await import(pathToFileURL(path.resolve(values['playwright-module'])).href);

const files = [
  'FE/src/pages/ChangePasswordPage.tsx', 'FE/src/features/account-settings/AccountSettings.tsx',
  'FE/src/features/account-settings/passwordChangeBinding.ts', 'FE/src/services/passwordChangeEmailApi.ts',
  'FE/src/routes/AppRouter.tsx', 'BE/src/auth/password-change-email.service.ts', 'BE/src/auth/password-change-email.controller.ts',
  'scripts/test-password-change-email-browser.mjs',
];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async (f) => [f, createHash('sha256').update(await readFile(path.join(root, f))).digest('hex')])));
const sourceHashes = await hashes();
const results = [], errors = [], mail = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), ...(detail ? { detail } : {}) }); };
let app, vite, browser;
try {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  builder.overrideProvider(AuthEmailDelivery).useValue({ configured: () => ({}), enqueue: (email, token, purpose, id) => mail.push({ email, token, purpose, id }) });
  app = (await builder.compile()).createNestApplication();
  configureApp(app);
  await app.listen(3393, '127.0.0.1');
  const db = app.get(PrismaService);
  const [m] = await db.$queryRaw`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
  assert.equal(m.n, 42);

  const password = 'Old-' + randomBytes(12).toString('hex'), nextPassword = 'New-' + randomBytes(12).toString('hex');
  const marker = randomUUID();
  const user = await db.user.create({ data: { email: `pwchange-${marker}@example.invalid`, passwordHash: await hash(password, 4), fullName: 'QA Đổi mật khẩu', emailVerifiedAt: new Date() } });

  vite = await createServer({
    root: path.join(root, 'FE'), configFile: false, envDir: false, plugins: [react()], logLevel: 'error',
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(api),
      'import.meta.env.VITE_AUTH_EMAIL_ENABLED': JSON.stringify('true'),
      'import.meta.env.VITE_ACCOUNT_SETTINGS_ENABLED': JSON.stringify('true'),
      'import.meta.env.VITE_AUTH_PASSWORD_CHANGE_MODE': JSON.stringify('EMAIL'),
    },
    server: { host: '127.0.0.1', port: 5193, strictPort: true },
  });
  await vite.listen();
  browser = await (pw.default ?? pw).chromium.launch({ channel: 'chrome', headless: true });
  const context = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.setDefaultTimeout(20000);
    p.on('pageerror', (e) => errors.push({ name, message: e.message }));
    return { ctx, p };
  };
  async function login(p, pass) {
    await p.goto(web + '/login');
    await p.getByLabel('Email', { exact: true }).fill(user.email);
    await p.getByLabel('Mật khẩu', { exact: true }).fill(pass);
    await p.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await p.waitForURL((u) => u.pathname !== '/login');
  }
  const shot = (p, n) => p.screenshot({ path: path.join(output, n + '.png'), fullPage: true });

  // 1. Browser A requests the email from the Account page.
  const A = await context('A');
  await login(A.p, password);
  await A.p.goto(web + '/account');
  const settings = A.p.getByRole('region', { name: 'Cài đặt tài khoản' });
  check('EMAIL mode hides direct new-password fields', (await settings.getByLabel('Mật khẩu mới').count()) === 0);
  await settings.getByLabel('Mật khẩu hiện tại').fill(password);
  await settings.getByLabel(/Gửi thư xác nhận/).check();
  await settings.getByRole('button', { name: 'Gửi email xác nhận' }).click();
  await settings.getByText('Đã tiếp nhận yêu cầu').waitFor();
  await shot(A.p, '01-request-accepted');
  const sent = mail.filter((x) => x.purpose === 'CHANGE_PASSWORD' && x.email === user.email);
  check('exactly one CHANGE_PASSWORD mail captured', sent.length === 1);
  const token = sent[0]?.token;
  const stored = await A.p.evaluate((id) => window.localStorage.getItem('bckl.passwordChangeBinding.' + id), user.id);
  check('binding stored in browser A, token not stored', Boolean(stored) && !stored.includes(token));

  // 2. Direct endpoint cannot bypass the email in EMAIL mode.
  const access1 = (await (await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: web }, body: JSON.stringify({ email: user.email, password }) })).json()).accessToken;
  const direct = await fetch(api + '/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: web, Authorization: 'Bearer ' + access1 }, body: JSON.stringify({ currentPassword: password, newPassword: nextPassword }) });
  check('POST /auth/password refused with 409 PASSWORD_CHANGE_EMAIL_REQUIRED', direct.status === 409 && (await direct.json()).code === 'PASSWORD_CHANGE_EMAIL_REQUIRED');

  // 3. Browser B (another browser, same account) cannot use the link.
  const B = await context('B');
  await login(B.p, password);
  await B.p.goto(`${web}/account/change-password#token=${token}`);
  await B.p.getByText('đúng trình duyệt đã gửi yêu cầu').waitFor();
  check('other browser gets the same-browser message', true);
  check('fragment removed from address bar (B)', new URL(B.p.url()).hash === '');
  await shot(B.p, '02-other-browser');
  const afterB = await db.authEmailToken.findFirst({ where: { userId: user.id, purpose: 'CHANGE_PASSWORD' }, orderBy: { createdAt: 'desc' } });
  check('opening in browser B did not consume the token', afterB && !afterB.usedAt && !afterB.revokedAt);

  // 4. Browser A, NEW TAB (as a mail client would open it): verify, then confirm.
  const tab = await A.ctx.newPage();
  tab.on('pageerror', (e) => errors.push({ name: 'A-tab', message: e.message }));
  tab.setDefaultTimeout(20000);
  await tab.goto(`${web}/account/change-password#token=${token}`);
  await tab.getByLabel('Mật khẩu mới', { exact: true }).waitFor();
  check('new tab of the same browser reaches the form', true);
  check('fragment removed from address bar (A tab)', new URL(tab.url()).hash === '');
  await shot(tab, '03-new-password-form');
  const before = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  await tab.getByLabel('Mật khẩu mới', { exact: true }).fill(nextPassword);
  await tab.getByLabel('Xác nhận mật khẩu mới').fill(nextPassword);
  await tab.getByRole('button', { name: /Đổi mật khẩu/ }).click();
  await tab.waitForURL((u) => u.pathname === '/login');
  await tab.getByText('Đã đổi mật khẩu').waitFor();
  await shot(tab, '04-login-after-change');

  // 5. Database ledger: one atomic change.
  const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  const used = await db.authEmailToken.findUniqueOrThrow({ where: { id: afterB.id } });
  check('credentialVersion +1', after.credentialVersion === before.credentialVersion + 1, { from: before.credentialVersion, to: after.credentialVersion });
  check('new password hash active, old rejected', (await compare(nextPassword, after.passwordHash)) && !(await compare(password, after.passwordHash)));
  check('token marked used', Boolean(used.usedAt));
  check('no live refresh tokens left', (await db.refreshToken.count({ where: { userId: user.id, revokedAt: null } })) === 0);
  check('one PASSWORD_CHANGED security event', (await db.accountSecurityEvent.count({ where: { userId: user.id, event: 'PASSWORD_CHANGED' } })) === 1);
  check('binding cleared in browser A', (await tab.evaluate((id) => window.localStorage.getItem('bckl.passwordChangeBinding.' + id), user.id)) === null);

  // 6. Old access token and old password stop working; link is single-use.
  const oldToken = await fetch(api + '/auth/me', { headers: { Authorization: 'Bearer ' + access1, Origin: web } });
  check('old access token rejected (401)', oldToken.status === 401);
  const oldLogin = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: web }, body: JSON.stringify({ email: user.email, password }) });
  check('old password login rejected', oldLogin.status === 401);
  await login(tab, nextPassword);
  check('new password login succeeds in Chrome', true);
  await tab.goto(`${web}/account/change-password#token=${token}`);
  await tab.getByRole('alert').filter({ hasText: /chỉ dùng một lần|đã được dùng/ }).waitFor();
  check('reused link no longer opens the form', (await tab.getByLabel('Mật khẩu mới', { exact: true }).count()) === 0);
  await shot(tab, '05-link-reused');
  check('no page errors', errors.length === 0, errors);
} catch (e) {
  results.push({ name: 'driver', ok: false, detail: String(e?.message ?? e).split('\n')[0] });
} finally {
  await browser?.close().catch(() => {});
  await vite?.close().catch(() => {});
  await app?.close().catch(() => {});
  const stable = JSON.stringify(await hashes()) === JSON.stringify(sourceHashes);
  const report = { createdAt: new Date().toISOString(), database: url.pathname.slice(1), mail: 'IN_MEMORY_CAPTURE_NO_REAL_EMAIL', stable, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, sourceHashes };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, stable, passed: report.passed, failed: report.failed }));
  process.exitCode = report.failed || !stable ? 1 : 0;
}
