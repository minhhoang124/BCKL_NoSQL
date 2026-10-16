// @vitest-environment jsdom
// Opt-in: compiled NestJS + real loopback HTTP + isolated PostgreSQL.
// React is exercised in jsdom; this is NOT a browser/visual QA result.
import '@testing-library/jest-dom/vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../../contexts/useAuth';

const enabled = process.env.CHECKOUT_LIVE_QA === 'true';
describe.skipIf(!enabled)('Address → Cart → Checkout: real HTTP/PostgreSQL', () => {
  let app, prisma, base, AppRouter, client;
  const marker = `web-checkout-${crypto.randomUUID()}`;
  const nativeFetch = globalThis.fetch;
  let serial = 0;
  let category, store, sellerSession;
  const users = [];
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/bckl_checkout_web_20261012' || url.port !== '5549') throw new Error('Exact dedicated QA database required');
    // Do not load repository .env or let cron mutate fixtures in this harness.
    process.env.SEARCH_SYNC_ENABLED = 'false';
    process.env.SEARCH_RECONCILIATION_ENABLED = 'false';
    process.env.PRODUCT_IMAGE_REPAIR_ENABLED = 'false';
    const requireBE = createRequire(path.resolve(process.cwd(), '../BE/package.json'));
    requireBE('reflect-metadata');
    const { Test } = requireBE('@nestjs/testing');
    const load = name => import(/* @vite-ignore */ pathToFileURL(path.resolve(process.cwd(), '../BE/dist', name)).href);
    const { AppModule } = await load('app.module.js');
    const { configureApp } = await load('configure-app.js');
    const { PrismaService } = await load('prisma.service.js');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); configureApp(app);
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
    prisma = app.get(PrismaService);
    vi.stubEnv('VITE_API_URL', base);
    client = await import('../../services/apiClient');
    ({ AppRouter } = await import('../../routes/AppRouter'));
    const sellerPassword = 'Qa-only-Read-Seller123!';
    const seller = await prisma.user.create({ data: { email: `${marker}-seller@example.test`, passwordHash: await requireBE('bcryptjs').hash(sellerPassword, 10), role: 'SELLER' } });
    users.push(seller.id);
    store = await prisma.store.create({ data: { sellerId: seller.id, name: 'QA Store', status: 'ACTIVE' } });
    category = await prisma.category.create({ data: { name: 'QA leaf', slug: marker } });
    sellerSession = await http('/auth/login', null, 'POST', { email: seller.email, password: sellerPassword });
  }, 30000);
  async function http(path, token, method = 'GET', body) {
    const response = await nativeFetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    expect(response.ok, JSON.stringify(data)).toBe(true); return data;
  }
  async function fixture() {
    const session = await http('/auth/register', null, 'POST', { email: `${marker}-${serial++}@example.test`, password: 'Qa-only-Password123!', accountType: 'USER' });
    users.push(session.user.id); client.setAccessToken(session.accessToken, session.user.id);
    const product = await prisma.product.create({ data: { storeId: store.id, categoryId: category.id, name: `QA headphones ${serial}`, sellerStatus: 'ACTIVE', moderationStatus: 'APPROVED', images: { create: { url: '/uploads/qa-only.jpg', isPrimary: true } }, shippingProfile: { create: { packageWeightGrams: 100 } } } });
    const variant = await prisma.productVariant.create({ data: { productId: product.id, storeId: store.id, skuCode: `${marker}-${serial++}`, optionSignature: 'default', price: '10000.00', stock: 5 } });
    return { session, product, variant };
  }
  function show(f, route) {
    return render(<AuthContext.Provider value={{ user: f.session.user, loading: false, login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }}><MemoryRouter initialEntries={[route]}><AppRouter /></MemoryRouter></AuthContext.Provider>);
  }
  async function prepare(f) {
    await http('/me/addresses', f.session.accessToken, 'POST', { recipientName: 'QA recipient', phone: '0901234567', province: 'QA province', ward: 'QA ward', addressLine: 'QA address', isDefault: true });
    await http(`/cart/items/${f.variant.id}`, f.session.accessToken, 'PUT', { quantity: 2 });
    show(f, `/checkout?variantId=${f.variant.id}`);
    const preview = await screen.findByRole('button', { name: 'Kiểm tra giá và kho' });
    await waitFor(() => expect(preview).toBeEnabled()); fireEvent.click(preview);
    return screen.findByRole('button', { name: 'Đặt hàng COD' });
  }
  async function assertCommitted(f) {
    const orders = await prisma.order.findMany({ where: { buyerId: f.session.user.id }, include: { items: true, payment: true } });
    expect(orders).toHaveLength(1); expect(orders[0].status).toBe('PENDING_CONFIRMATION');
    expect(orders[0].payment.provider).toBe('COD'); expect(orders[0].payment.status).toBe('UNPAID');
    expect(orders[0].total.toFixed(2)).toBe('20000.00');
    expect(orders[0].items[0].quantity).toBe(2);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: f.variant.id } })).stock).toBe(3);
    expect(await prisma.stockMovement.count({ where: { variantId: f.variant.id } })).toBe(1);
    expect(await prisma.searchOutbox.count({ where: { productId: f.product.id } })).toBe(1);
    expect(await prisma.cartItem.count({ where: { cart: { userId: f.session.user.id }, variantId: f.variant.id } })).toBe(0);
    return orders[0];
  }
  it('creates address through real UI, selects Cart line and commits COD once', async () => {
    const f = await fixture(); show(f, '/account/addresses');
    const add = await screen.findByRole('button', { name: '+ Thêm địa chỉ mới' });
    await waitFor(() => expect(add).toBeEnabled()); fireEvent.click(add);
    for (const [label, value] of [['Họ và tên người nhận', 'QA recipient'], ['Số điện thoại', '0901234567'], ['Tỉnh / thành phố', 'QA province'], ['Phường / xã', 'QA ward'], ['Địa chỉ cụ thể', 'QA snapshot address']]) fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu địa chỉ' }));
    await waitFor(async () => expect(await prisma.userAddress.count({ where: { userId: f.session.user.id } })).toBe(1));
    await http(`/cart/items/${f.variant.id}`, f.session.accessToken, 'PUT', { quantity: 2 });
    const unselected = await prisma.productVariant.create({ data: { productId: f.product.id, storeId: store.id, skuCode: `${marker}-unselected`, optionSignature: 'unselected', price: '15000.00', stock: 5 } });
    await http(`/cart/items/${unselected.id}`, f.session.accessToken, 'PUT', { quantity: 1 });
    fireEvent.click(screen.getByRole('link', { name: 'Giỏ hàng' }));
    const checkbox = await screen.findByLabelText(`Chọn biến thể ${f.variant.id}`);
    await waitFor(() => expect(checkbox).toBeEnabled()); if (!checkbox.checked) fireEvent.click(checkbox);
    const other = screen.getByLabelText(`Chọn biến thể ${unselected.id}`);
    if (other.checked) fireEvent.click(other);
    fireEvent.click(screen.getByRole('link', { name: 'Tiếp tục thanh toán' }));
    const preview = await screen.findByRole('button', { name: 'Kiểm tra giá và kho' });
    await waitFor(() => expect(preview).toBeEnabled()); fireEvent.click(preview);
    fireEvent.click(await screen.findByRole('button', { name: 'Đặt hàng COD' }));
    await screen.findByText('Đã ghi nhận đặt hàng COD');
    const order = await assertCommitted(f);
    expect(order.addressLineSnapshot).toBe('QA snapshot address');
    expect(order.items).toHaveLength(1);
    expect(await prisma.cartItem.count({ where: { variantId: unselected.id, cart: { userId: f.session.user.id } } })).toBe(1);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: unselected.id } })).stock).toBe(5);
    fireEvent.click(screen.getByRole('link', { name: `Theo dõi đơn ${order.orderNumber}` }));
    expect(await screen.findByRole('heading', { name: order.orderNumber })).toBeInTheDocument();
    expect(screen.getByText('QA snapshot address, QA ward, QA province')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hủy đơn' })).toBeDisabled();
    // Read through the routed Seller UI with a real Seller JWT, including suspended Store.
    cleanup();
    await prisma.store.update({ where: { id: store.id }, data: { status: 'SUSPENDED' } });
    try {
      client.setAccessToken(sellerSession.accessToken, sellerSession.user.id);
      show({ session: sellerSession }, '/seller/orders');
      fireEvent.click(await screen.findByRole('button', { name: `Xem chi tiết ${order.orderNumber}` }));
      expect(await screen.findByRole('heading', { name: order.orderNumber })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Xác nhận đơn' })).toBeDisabled();
      await assertCommitted(f);
      expect(await prisma.orderCommand.count({ where: { orderId: order.id } })).toBe(0);
    } finally {
      await prisma.store.update({ where: { id: store.id }, data: { status: 'ACTIVE' } });
    }
  }, 20000);
  it.each(['buyer', 'seller'])('real Order detail rejects another %s through the routed UI', async scope => {
    const f = await fixture(); const place = await prepare(f);
    fireEvent.click(place); await screen.findByText('Đã ghi nhận đặt hàng COD');
    const order = await assertCommitted(f);
    cleanup();
    const email = `${marker}-outsider-${serial++}@example.test`;
    let outsider = await http('/auth/register', null, 'POST', { email, password: 'Qa-only-Password123!', accountType: 'USER' });
    if (scope === 'seller') {
      await prisma.user.update({ where: { id: outsider.user.id }, data: { role: 'SELLER' } });
      outsider = await http('/auth/login', null, 'POST', { email, password: 'Qa-only-Password123!' });
    }
    client.setAccessToken(outsider.accessToken, outsider.user.id);
    show({ session: outsider }, `${scope === 'buyer' ? '/account' : '/seller'}/orders/${order.id}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tìm thấy đơn hàng hoặc bạn không có quyền truy cập');
    expect(screen.queryByRole('heading', { name: order.orderNumber })).not.toBeInTheDocument();
    await assertCommitted(f);
    expect(await prisma.orderCommand.count({ where: { orderId: order.id } })).toBe(0);
  }, 20000);
  it('real commit followed by lost response replays same key/body without duplicate inventory/outbox', async () => {
    const f = await fixture(); const place = await prepare(f);
    let lost = false; const requests = [];
    vi.stubGlobal('fetch', async (url, options) => {
      const response = await nativeFetch(url, options);
      if (url === base + '/checkouts') {
        requests.push({ key: new Headers(options.headers).get('Idempotency-Key'), body: options.body });
        if (!lost) { lost = true; expect(response.status).toBe(201); await response.text(); throw new TypeError('simulated response loss after real commit'); }
      }
      return response;
    });
    fireEvent.click(place);
    const retry = await screen.findByRole('button', { name: 'Gửi lại cùng yêu cầu' });
    await waitFor(() => expect(retry).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(retry);
    await screen.findByText('Đã ghi nhận đặt hàng COD', {}, { timeout: 5000 });
    expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
    await assertCommitted(f);
  }, 20000);
  it.each(['price', 'stock'])('rejects changed %s after preview with no partial checkout', async field => {
    const f = await fixture(); const place = await prepare(f);
    await prisma.productVariant.update({ where: { id: f.variant.id }, data: field === 'price' ? { price: '12000.00' } : { stock: 1 } });
    fireEvent.click(place);
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(await prisma.order.count({ where: { buyerId: f.session.user.id } })).toBe(0);
    expect(await prisma.checkout.count({ where: { buyerId: f.session.user.id } })).toBe(0);
    expect(await prisma.stockMovement.count({ where: { variantId: f.variant.id } })).toBe(0);
    expect(await prisma.searchOutbox.count({ where: { productId: f.product.id } })).toBe(0);
    expect(await prisma.cartItem.count({ where: { cart: { userId: f.session.user.id } } })).toBe(1);
    expect(sessionStorage.getItem(`bckl-order-intent-v1:${f.session.user.id}:checkout`)).toBeNull();
  }, 20000);
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); client?.setAccessToken(null); });
  // Dedicated QA DB is retained for inspection. No destructive cleanup against demo.
  afterAll(async () => { vi.unstubAllEnvs(); await app?.close(); }, 15000);
});
