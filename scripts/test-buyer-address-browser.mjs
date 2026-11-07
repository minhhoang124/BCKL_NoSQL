// Browser integration with explicit MOCK API fixtures; no database is used.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:5178' },
  'playwright-module': { type: 'string' },
  channel: { type: 'string' },
  output: { type: 'string', default: 'artifacts/address-ui-browser' },
} });
const { chromium } = values['playwright-module']
  ? await import(pathToFileURL(path.resolve(values['playwright-module'])).href)
  : await import('playwright');
await mkdir(values.output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(values.channel ? { channel: values.channel } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, colorScheme: 'light' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const fixture = { id: 101, recipientName: 'Người mua mẫu', phone: '0901234567', province: 'Thành phố mẫu', district: null,
  ward: 'Phường mẫu', addressLine: '10 Đường mẫu', postalCode: null, deliveryNote: null, isDefault: true,
  createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' };
let addresses = [{ ...fixture }, { ...fixture, id: 102, recipientName: 'Người nhận khác', addressLine: '20 Đường mẫu', isDefault: false }];
let creates = 0;
let failCreate = false;
const methods = [];
await page.route('http://localhost:3001/**', async (route) => {
  const req = route.request(); const endpoint = new URL(req.url()).pathname; const method = req.method();
  const headers = { 'Access-Control-Allow-Origin': values.url, 'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' };
  const reply = (status, data) => route.fulfill({ status, headers, ...(status === 204 ? {} : { json: data }) });
  if (method === 'OPTIONS') return reply(204);
  if (endpoint === '/auth/refresh') return reply(200, { accessToken: 'MOCK_BROWSER_TEST_TOKEN', user: {
    id: 1, email: 'buyer@example.test', fullName: 'Người mua mẫu', role: 'USER', isActive: true,
  } });
  if (!endpoint.startsWith('/me/addresses')) return reply(404, { message: 'Not in mock fixture' });
  methods.push(`${method} ${endpoint}`);
  if (method === 'GET') return reply(200, { items: [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)) });
  const id = Number(endpoint.split('/')[3]);
  const body = method === 'DELETE' ? {} : req.postDataJSON();
  if (method === 'POST') {
    if (failCreate) return reply(409, { statusCode: 409, code: 'ADDRESS_LIMIT_REACHED', message: 'Đã đạt giới hạn địa chỉ.' });
    creates++;
    if (body.isDefault) addresses.forEach((address) => { address.isDefault = false; });
    const added = { ...fixture, ...body, id: 200 + creates, isDefault: addresses.length === 0 || body.isDefault === true };
    addresses.push(added); return reply(201, added);
  }
  const current = addresses.find((address) => address.id === id);
  if (!current) return reply(404, { code: 'ADDRESS_NOT_FOUND', message: 'Không tìm thấy địa chỉ.' });
  if (method === 'PUT') { addresses.forEach((address) => { address.isDefault = address.id === id; }); return reply(200, current); }
  if (method === 'PATCH') { Object.assign(current, body); return reply(200, current); }
  if (method === 'DELETE') {
    addresses = addresses.filter((address) => address.id !== id);
    if (current.isDefault && addresses.length) addresses[0].isDefault = true;
    return reply(204);
  }
  return reply(405, {});
});

try {
  await page.goto(`${values.url}/account/addresses`);
  await page.getByRole('article', { name: 'Địa chỉ của Người mua mẫu' }).waitFor();
  await page.screenshot({ path: path.join(values.output, 'desktop-mock.png'), fullPage: true });
  await page.getByRole('button', { name: '+ Thêm địa chỉ mới' }).click();
  await page.getByLabel('Họ và tên người nhận *').fill('Người nhận mới');
  await page.getByLabel('Số điện thoại *').fill('0909876543');
  await page.getByLabel('Tỉnh / thành phố *').fill('Tỉnh mẫu');
  await page.getByLabel('Phường / xã *').fill('Xã mẫu');
  await page.getByLabel('Địa chỉ cụ thể *').fill('30 Đường mẫu');
  await page.getByRole('button', { name: 'Lưu địa chỉ' }).click();
  await page.getByText('Đã thêm địa chỉ.', { exact: true }).waitFor();
  await page.getByRole('article', { name: 'Địa chỉ của Người nhận mới' }).waitFor();
  assert.equal(creates, 1);
  const card = page.getByRole('article', { name: 'Địa chỉ của Người nhận mới' });
  await card.getByRole('button', { name: 'Chỉnh sửa' }).click();
  await page.getByLabel('Ghi chú giao hàng (tùy chọn)').fill('Gọi trước khi giao');
  await page.getByRole('button', { name: 'Lưu địa chỉ' }).click();
  await page.getByText('Ghi chú: Gọi trước khi giao', { exact: true }).waitFor();
  await card.getByRole('button', { name: 'Đặt làm mặc định' }).click();
  await card.getByText('Mặc định', { exact: true }).waitFor();
  await card.getByRole('button', { name: 'Xóa', exact: true }).click();
  assert.equal(addresses.length, 3, 'Delete must wait for confirmation');
  await page.getByRole('button', { name: 'Xác nhận xóa' }).click();
  await page.getByText('Đã xóa địa chỉ.', { exact: true }).waitFor();
  assert.equal(addresses.length, 2);
  await page.getByRole('button', { name: '+ Thêm địa chỉ mới' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Họ và tên người nhận *').fill('Kiểm tra lỗi');
  await page.getByLabel('Số điện thoại *').fill('0909876543');
  await page.getByLabel('Tỉnh / thành phố *').fill('Tỉnh mẫu');
  await page.getByLabel('Phường / xã *').fill('Xã mẫu');
  await page.getByLabel('Địa chỉ cụ thể *').fill('30 Đường mẫu');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(values.output, 'mobile-form-mock.png'), fullPage: true });
  const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(width.content <= width.viewport, `Mobile overflow: ${JSON.stringify(width)}`);
  failCreate = true;
  await page.getByRole('button', { name: 'Lưu địa chỉ' }).click();
  await page.getByRole('alert').getByText('Đã đạt giới hạn địa chỉ.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Họ và tên người nhận *').inputValue(), 'Kiểm tra lỗi');
  assert.ok(await page.getByRole('button', { name: 'Lưu địa chỉ' }).isDisabled());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(values.output, 'mobile-error-mock.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', evidence: 'MOCK_API_BROWSER_ONLY', methods, creates, mobileWidth: width, pageErrors: errors, screenshots: values.output }, null, 2));
} finally {
  await context.close(); await browser.close();
}
