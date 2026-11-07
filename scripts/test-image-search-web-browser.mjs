// Chrome UI proof with explicit HTTP fixtures. NOT Backend/AI/DB integration.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { output: { type: 'string' }, 'playwright-module': { type: 'string' } } });
assert(values.output && values['playwright-module']);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rf = createRequire(path.join(root, 'FE/package.json'));
const { createServer } = await import(pathToFileURL(rf.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(rf.resolve('@vitejs/plugin-react')).href);
const playwright = await import(pathToFileURL(path.resolve(values['playwright-module'])).href);
const { chromium } = playwright.default ?? playwright;
const output = path.resolve(values.output);
await mkdir(output, { recursive: true });
const api = 'http://127.0.0.1:59998'; // Intercepted, never an actual backend.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=', 'base64');
const results = [];
let server, browser;
try {
  server = await createServer({
    root: path.join(root, 'FE'), configFile: false, envDir: false,
    plugins: [react()], define: {
      'import.meta.env.VITE_IMAGE_SEARCH_ENABLED': JSON.stringify('true'),
      'import.meta.env.VITE_API_URL': JSON.stringify(api),
    }, server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const [name, width, height, colorScheme] of [
    ['desktop-light', 1440, 1000, 'light'], ['desktop-dark', 1440, 1000, 'dark'],
    ['mobile-light', 390, 844, 'light'], ['mobile-dark', 390, 844, 'dark'],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let posts = 0, scenario = 'empty';
    await page.route(`${api}/**`, async route => {
      const request = route.request();
      const headers = { 'access-control-allow-origin': origin.replace(/\/$/, ''), 'access-control-allow-credentials': 'true' };
      if (request.url().endsWith('/search/image')) {
        ++posts;
        assert.equal(request.method(), 'POST');
        assert.equal(request.headers().authorization, undefined);
        assert.equal(request.headers().cookie, undefined);
        if (scenario === 'waiting') return route.abort();
        if (scenario === 'network') return route.abort('failed');
        if (scenario === 'malformed') return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '{"items":[],"responseTimeMs":"bad"}' });
        return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '{"items":[],"responseTimeMs":3}' });
      }
      return route.fulfill({ status: 401, headers, contentType: 'application/json', body: '{}' });
    });
    await page.goto(new URL('/search/image', origin).href);
    await page.getByRole('heading', { name: 'Tìm sản phẩm bằng ảnh' }).waitFor();
    const file = page.locator('#image-query');
    const send = page.getByRole('button', { name: 'Tìm bằng ảnh', exact: true });
    assert(await send.isDisabled());
    await file.setInputFiles({ name: 'private-query.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    assert.equal(posts, 0);
    await page.screenshot({ path: path.join(output, `${name}-preview.png`), fullPage: true });
    // Same tick invokes the event twice; the synchronous latch permits one POST.
    await send.evaluate(button => { button.click(); button.click(); });
    await page.getByRole('heading', { name: '0 sản phẩm tìm thấy' }).waitFor();
    assert.equal(posts, 1);
    await page.screenshot({ path: path.join(output, `${name}-empty.png`), fullPage: true });
    scenario = 'malformed';
    await send.click();
    await page.getByRole('alert').filter({ hasText: 'Dữ liệu tìm ảnh không hợp lệ' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '0 sản phẩm tìm thấy' }).count(), 0);
    scenario = 'network';
    await send.click();
    await page.getByRole('alert').filter({ hasText: 'Kiểm tra kết nối' }).waitFor();
    await page.screenshot({ path: path.join(output, `${name}-network-error.png`), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: 'Bỏ ảnh' }).click();
    assert(await send.isDisabled());
    assert.deepEqual(errors, []);
    results.push({ name, result: 'PASS', requests: posts, scope: 'Chrome + mocked HTTP; NO Backend/AI/DB' });
    console.log(`${name}: PASS`);
    await context.close();
  }
} catch (error) {
  results.push({ result: 'FAIL', message: error.message });
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ scope: 'UI ONLY / HTTP FIXTURES', results }, null, 2));
}
