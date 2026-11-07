import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { SearchOutboxService } from '../src/search/search-outbox.service.js';
import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';
import { isFinalDayQaTarget } from './helpers/final-day-qa-target.js';

// Real HTTP/PostgreSQL, synthetic fixtures retained for evidence. No dotenv,
// truncate, deletion, provider call or manual manipulation of historical orders.
describe('Seller SKU price/inventory edit — real HTTP/PostgreSQL', () => {
  let app: INestApplication, db: PrismaService, storeId: number, categoryId: number;
  const tokens: Record<string, string> = {};
  const actorIds: Record<string, number> = {};
  const marker = 'sku-edit-' + randomUUID();
  const password = 'Synthetic-SKU-' + randomUUID() + '!';

  beforeAll(async () => {
    assertRuntimeQaTarget(process.env.DATABASE_URL, process.env.GITHUB_ACTIONS);
    const target = new URL(process.env.DATABASE_URL!);
    const canonicalCi = process.env.GITHUB_ACTIONS === 'true' &&
      ['localhost', '127.0.0.1'].includes(target.hostname) &&
      target.port === '5432' && target.pathname === '/klcn_ecommerce';
    if (!isFinalDayQaTarget(target) && !canonicalCi)
      throw new Error('Seller SKU acceptance requires the explicit final-day QA target or canonical isolated CI');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile())
      .createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    const passwordHash = await hash(password, 4);
    for (const [name, role] of Object.entries({ seller: 'SELLER', other: 'SELLER', buyer: 'USER', admin: 'ADMIN' } satisfies Record<string, Role>)) {
      const actor = await db.user.create({ data: { email: marker + '-' + name + '@example.test', passwordHash, role } });
      actorIds[name] = actor.id;
      const login = await request(app.getHttpServer()).post('/auth/login')
        .send({ email: actor.email, password }).expect(200);
      tokens[name] = login.body.accessToken as string;
    }
    storeId = (await db.store.create({ data: { sellerId: actorIds.seller, name: 'Synthetic SKU editor Store', status: 'ACTIVE' } })).id;
    await db.store.create({ data: { sellerId: actorIds.other, name: 'Foreign SKU Store', status: 'ACTIVE' } });
    categoryId = (await db.category.create({ data: { name: 'SKU edit QA leaf', slug: marker } })).id;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  async function fixture(options: { stock?: number; ownerStoreId?: number; sellerStatus?: 'ACTIVE' | 'DRAFT' | 'HIDDEN'; moderationStatus?: 'APPROVED' | 'NOT_SUBMITTED' | 'PENDING' | 'FROZEN' } = {}) {
    const ownerStoreId = options.ownerStoreId ?? storeId;
    const product = await db.product.create({ data: {
      storeId: ownerStoreId, categoryId, name: 'Synthetic editable SKU', description: 'Original description preserved',
      sellerStatus: options.sellerStatus ?? 'ACTIVE', moderationStatus: options.moderationStatus ?? 'APPROVED',
      images: { create: { url: '/uploads/sku-editor-qa.jpg', isPrimary: true } },
      shippingProfile: { create: { packageWeightGrams: 100 } },
    } });
    const variant = await db.productVariant.create({ data: {
      productId: product.id, storeId: ownerStoreId, skuCode: marker + '-' + randomUUID(), sellerSku: 'SELLER-' + randomUUID(),
      optionSignature: 'default', price: '10000.00', stock: options.stock ?? 5,
    } });
    return { product, variant };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function body(f: Fixture, overrides: Record<string, unknown> = {}) {
    return { expectedProductVersion: f.product.version, expectedPrice: f.variant.price.toFixed(2),
      expectedStock: f.variant.stock, price: '12000.00', stock: f.variant.stock,
      reason: '  Synthetic physical stock/price review  ', ...overrides };
  }
  function edit(f: Fixture, input: unknown = body(f), token: string | null = tokens.seller, path = `/seller/products/${f.product.id}/variants/${f.variant.id}`) {
    const call = request(app.getHttpServer()).patch(path);
    if (token) call.set('Authorization', 'Bearer ' + token);
    return call.send(input as object);
  }
  async function state(f: Fixture) {
    return {
      product: await db.product.findUniqueOrThrow({ where: { id: f.product.id }, include: { variants: { orderBy: { id: 'asc' } } } }),
      movements: await db.stockMovement.findMany({ where: { variantId: f.variant.id }, orderBy: { id: 'asc' } }),
      outbox: await db.searchOutbox.findMany({ where: { productId: f.product.id }, orderBy: { id: 'asc' } }),
    };
  }
  async function checkoutInput(f: Fixture) {
    const address = await db.userAddress.create({ data: { userId: actorIds.buyer, recipientName: 'Synthetic SKU Buyer', phone: '0901234567', province: 'QA', ward: 'QA', addressLine: 'Synthetic address snapshot', isDefault: false } });
    await request(app.getHttpServer()).put(`/cart/items/${f.variant.id}`)
      .set('Authorization', 'Bearer ' + tokens.buyer).send({ quantity: 2 }).expect(200);
    const key = randomUUID();
    const input = { addressId: address.id, paymentProvider: 'COD', items: [{ variantId: f.variant.id, quantity: 2, expectedUnitPrice: '10000.00' }] };
    return { key, input };
  }
  async function checkout(f: Fixture) {
    const { key, input } = await checkoutInput(f);
    const result = await request(app.getHttpServer()).post('/checkouts')
      .set('Authorization', 'Bearer ' + tokens.buyer).set('Idempotency-Key', key).send(input).expect(201);
    return { key, input, result: result.body as { orders: { id: number }[] } };
  }

  it('changes price immediately while preserving approval, listing state and SKU identity; emits one UPSERT without a stock movement', async () => {
    const f = await fixture(), before = await state(f);
    const response = await edit(f).expect(200);
    expect(response.body).toEqual({ productId: f.product.id, variantId: f.variant.id, version: f.product.version + 1, price: '12000.00', stock: 5 });
    const after = await state(f);
    expect(after.product).toMatchObject({ version: f.product.version + 1, moderationStatus: 'APPROVED', sellerStatus: 'ACTIVE', name: before.product.name, description: before.product.description });
    expect(after.product.variants[0]).toMatchObject({ id: f.variant.id, skuCode: f.variant.skuCode, sellerSku: f.variant.sellerSku, optionSignature: f.variant.optionSignature, isActive: true, stock: 5 });
    expect(after.product.variants[0].price.toFixed(2)).toBe('12000.00');
    expect(after.movements).toEqual(before.movements);
    expect(after.outbox).toHaveLength(1);
    expect(after.outbox[0]).toMatchObject({ operation: 'UPSERT', version: f.product.version + 1, status: 'PENDING' });
    expect(after.outbox[0].payload).toMatchObject({ productId: f.product.id, version: f.product.version + 1, minPrice: '12000', maxPrice: '12000', inStock: true });
    await request(app.getHttpServer()).get(`/products/${f.product.id}`).expect(200);
  });

  it('sets stock to zero, records exact negative adjustment once and keeps the approved listing with inStock false', async () => {
    const f = await fixture();
    await edit(f, body(f, { price: '10000', stock: 0 })).expect(200);
    const after = await state(f);
    expect(after.product.variants[0].stock).toBe(0);
    expect(after.product).toMatchObject({ sellerStatus: 'ACTIVE', moderationStatus: 'APPROVED', version: f.product.version + 1 });
    expect(after.movements).toHaveLength(1);
    expect(after.movements[0]).toMatchObject({ type: 'MANUAL_ADJUSTMENT', orderItemId: null, quantityDelta: -5, balanceAfter: 0, reason: 'Synthetic physical stock/price review', idempotencyKey: `SKU_EDIT:${f.product.id}:${f.product.version}:${f.variant.id}` });
    expect(after.outbox).toHaveLength(1);
    expect(after.outbox[0]).toMatchObject({ operation: 'UPSERT', version: f.product.version + 1 });
    expect(after.outbox[0].payload).toMatchObject({ inStock: false, minPrice: '10000' });
    const stale = await edit(f, body(f, { price: '10000', stock: 0 })).expect(409);
    expect(stale.body.code).toBe('PRODUCT_VARIANT_CHANGED');
    expect(await state(f)).toEqual(after);
  });

  it('increases stock with an exact positive MANUAL_ADJUSTMENT balance and normalizes whole-VND price', async () => {
    const f = await fixture({ stock: 0 });
    const response = await edit(f, body(f, { price: '12000', stock: 7 })).expect(200);
    expect(response.body).toMatchObject({ price: '12000.00', stock: 7 });
    const after = await state(f);
    expect(after.movements).toHaveLength(1);
    expect(after.movements[0]).toMatchObject({ quantityDelta: 7, balanceAfter: 7, type: 'MANUAL_ADJUSTMENT' });
    expect(after.outbox[0].payload).toMatchObject({ inStock: true });
  });

  it('uses DELETE policy for a non-public draft without promoting content to approved or active', async () => {
    const f = await fixture({ sellerStatus: 'DRAFT', moderationStatus: 'NOT_SUBMITTED' });
    await edit(f).expect(200);
    const after = await state(f);
    expect(after.product).toMatchObject({ sellerStatus: 'DRAFT', moderationStatus: 'NOT_SUBMITTED', version: f.product.version + 1 });
    expect(after.outbox).toHaveLength(1);
    expect(after.outbox[0]).toMatchObject({ operation: 'DELETE', version: f.product.version + 1 });
  });

  it('refuses anonymous and non-Seller roles, and conceals foreign or cross-product variants without writing', async () => {
    const f = await fixture(), other = await fixture(), before = await state(f);
    for (const [token, status] of [[null, 401], [tokens.buyer, 403], [tokens.admin, 403], [tokens.other, 404]] as const)
      await edit(f, body(f), token).expect(status);
    await edit(f, body(f), tokens.seller, `/seller/products/${f.product.id}/variants/${other.variant.id}`).expect(404);
    await edit(f, body(f), tokens.seller, `/seller/products/${f.product.id}/variants/2147483647`).expect(404);
    expect(await state(f)).toEqual(before);
  });

  it.each(['PENDING', 'FROZEN'] as const)('blocks %s moderation atomically', async moderationStatus => {
    const f = await fixture({ moderationStatus }), before = await state(f);
    await edit(f).expect(409);
    expect(await state(f)).toEqual(before);
  });

  it('blocks a suspended Store with no product/version/stock/outbox changes', async () => {
    const f = await fixture(), before = await state(f);
    await db.store.update({ where: { id: storeId }, data: { status: 'SUSPENDED' } });
    try { await edit(f).expect(403); expect(await state(f)).toEqual(before); }
    finally { await db.store.update({ where: { id: storeId }, data: { status: 'ACTIVE' } }); }
  });

  it('rejects a stale credentialVersion after revocation without changing the owned SKU', async () => {
    const actor = await db.user.create({ data: { email: 'sku-revoked-' + randomUUID() + '@example.test', passwordHash: await hash(password, 4), role: 'SELLER' } });
    const owner = await db.store.create({ data: { sellerId: actor.id, name: 'Revoked Seller SKU fixture', status: 'ACTIVE' } });
    const f = await fixture({ ownerStoreId: owner.id });
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: actor.email, password }).expect(200);
    const before = await state(f);
    await db.user.update({ where: { id: actor.id }, data: { credentialVersion: { increment: 1 } } });
    await edit(f, body(f), login.body.accessToken as string).expect(401);
    expect(await state(f)).toEqual(before);
  });

  it('changes only the requested SKU and accepts the documented maximum whole-VND price', async () => {
    const f = await fixture();
    const sibling = await db.productVariant.create({ data: { productId: f.product.id, storeId, skuCode: marker + '-sibling-' + randomUUID(), optionSignature: 'second-fixture-combination', price: '9000.00', stock: 11 } });
    const response = await edit(f, body(f, { price: '999999999999.00', stock: 6 })).expect(200);
    expect(response.body).toMatchObject({ price: '999999999999.00', stock: 6, version: f.product.version + 1 });
    expect(await db.productVariant.findUniqueOrThrow({ where: { id: sibling.id } })).toEqual(sibling);
    expect(await db.stockMovement.count({ where: { variantId: sibling.id } })).toBe(0);
    const after = await state(f);
    expect(after.movements).toHaveLength(1);
    expect(after.movements[0]).toMatchObject({ quantityDelta: 1, balanceAfter: 6 });
    expect(after.outbox).toHaveLength(1);
  });

  it.each([
    { price: '0' }, { price: '1.01' }, { price: '1e4' }, { price: '1000000000000' },
    { price: 12000 }, { stock: -1 }, { stock: 1.5 }, { stock: 2147483648 },
    { expectedStock: '5' }, { expectedProductVersion: 0 }, { expectedProductVersion: 2147483647 },
    { expectedPrice: '1.01' }, { reason: '   ' }, { reason: 'x'.repeat(501) }, { actorId: 123 },
  ])('rejects invalid DTO %j without any write', async invalid => {
    const f = await fixture(), before = await state(f);
    await edit(f, body(f, invalid)).expect(400);
    expect(await state(f)).toEqual(before);
  });

  it('rejects a no-op and query override without incrementing version or creating an outbox/ledger row', async () => {
    const f = await fixture(), before = await state(f);
    await edit(f, body(f, { price: '10000' })).expect(400);
    await edit(f, body(f), tokens.seller, `/seller/products/${f.product.id}/variants/${f.variant.id}?force=true`).expect(400);
    expect(await state(f)).toEqual(before);
  });

  it.each([{ expectedProductVersion: 2147483000 }, { expectedPrice: '9000' }, { expectedStock: 4 }])('compares every stale expected field %j before mutation', async stale => {
    const f = await fixture(), before = await state(f);
    const response = await edit(f, body(f, stale)).expect(409);
    expect(response.body.code).toBe('PRODUCT_VARIANT_CHANGED');
    expect(await state(f)).toEqual(before);
  });

  it('rejects independently stale stock after real Checkout even when the caller refreshes Product.version', async () => {
    const f = await fixture();
    await checkout(f);
    const before = await state(f);
    expect(before.product.version).toBe(f.product.version + 1);
    expect(before.product.variants[0].stock).toBe(3);
    const response = await edit(f, body(f, { expectedProductVersion: before.product.version, stock: 8 })).expect(409);
    expect(response.body.code).toBe('PRODUCT_VARIANT_CHANGED');
    expect(await state(f)).toEqual(before);
  });

  it('preserves Checkout receipt and historical OrderItem snapshots when current SKU price/stock later changes', async () => {
    const f = await fixture(), purchase = await checkout(f), orderId = purchase.result.orders[0].id;
    const beforeOrder = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { orderBy: { id: 'asc' } }, payment: true } });
    const currentProduct = await db.product.findUniqueOrThrow({ where: { id: f.product.id } });
    expect(currentProduct.version).toBe(f.product.version + 1);
    await edit(f, body(f, { expectedProductVersion: currentProduct.version, expectedStock: 3, price: '18000', stock: 9 })).expect(200);
    const afterOrder = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { orderBy: { id: 'asc' } }, payment: true } });
    expect(afterOrder).toEqual(beforeOrder);
    expect(afterOrder.total.toFixed(2)).toBe('20000.00');
    expect(afterOrder.items[0]).toMatchObject({ quantity: 2 });
    expect(afterOrder.items[0].unitPrice.toFixed(2)).toBe('10000.00');
    const replay = await request(app.getHttpServer()).post('/checkouts')
      .set('Authorization', 'Bearer ' + tokens.buyer).set('Idempotency-Key', purchase.key).send(purchase.input).expect(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.orders).toEqual(purchase.result.orders);
    const movements = await db.stockMovement.findMany({ where: { variantId: f.variant.id }, orderBy: { id: 'asc' } });
    expect(movements).toHaveLength(2);
    expect(movements[0]).toMatchObject({ type: 'CHECKOUT_DECREMENT', quantityDelta: -2, balanceAfter: 3 });
    expect(movements[1]).toMatchObject({ type: 'MANUAL_ADJUSTMENT', quantityDelta: 6, balanceAfter: 9, orderItemId: null });
  });

  it('allows exactly one of two concurrent edits sharing the same Product/price/stock CAS', async () => {
    const f = await fixture();
    const changes = [body(f, { price: '13000', stock: 7 }), body(f, { price: '17000', stock: 2 })];
    const responses = await Promise.all(changes.map(input => edit(f, input)));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = responses.findIndex(r => r.status === 200), loser = responses.find(r => r.status === 409)!;
    expect(loser.body.code).toBe('PRODUCT_VARIANT_CHANGED');
    const after = await state(f);
    expect(after.product.version).toBe(f.product.version + 1);
    expect(after.product.variants[0].stock).toBe(changes[winner].stock);
    expect(after.product.variants[0].price.toFixed(2)).toBe(winner === 0 ? '13000.00' : '17000.00');
    expect(after.movements).toHaveLength(1);
    expect(after.movements[0]).toMatchObject({ quantityDelta: changes[winner].stock - 5, balanceAfter: changes[winner].stock, idempotencyKey: `SKU_EDIT:${f.product.id}:${f.product.version}:${f.variant.id}` });
    expect(after.outbox).toHaveLength(1);
    const replay = await edit(f, changes[winner]).expect(409);
    expect(replay.body.code).toBe('PRODUCT_VARIANT_CHANGED');
    expect(await state(f)).toEqual(after);
    expect(JSON.stringify(loser.body)).not.toMatch(/prisma|postgresql|P2002|constraint|password/i);
  });

  it.each(['price', 'stock'] as const)('serializes overlapping Checkout and %s edits without losing a purchase or an adjustment', async kind => {
    const f = await fixture(), purchase = await checkoutInput(f);
    const editBody = body(f, { price: kind === 'price' ? '12000' : '10000', stock: 7 });
    const [editResponse, purchaseResponse] = await Promise.all([
      edit(f, editBody),
      request(app.getHttpServer()).post('/checkouts').set('Authorization', 'Bearer ' + tokens.buyer)
        .set('Idempotency-Key', purchase.key).send(purchase.input),
    ]);
    const edited = editResponse.status === 200, purchased = purchaseResponse.status === 201;
    expect([200, 409]).toContain(editResponse.status);
    expect([201, 409]).toContain(purchaseResponse.status);
    expect(edited || purchased).toBe(true);
    if (kind === 'price') expect(edited && purchased).toBe(false);
    else expect(purchased).toBe(true);
    if (!edited) expect(editResponse.body.code).toBe('PRODUCT_VARIANT_CHANGED');
    const after = await state(f);
    expect(after.product.version).toBe(f.product.version + Number(edited) + Number(purchased));
    expect(after.product.variants[0].stock).toBe(5 + (edited ? 2 : 0) - (purchased ? 2 : 0));
    expect(after.product.variants[0].price.toFixed(2)).toBe(kind === 'price' && edited ? '12000.00' : '10000.00');
    expect(after.movements).toHaveLength(Number(edited) + Number(purchased));
    expect(after.movements.filter(m => m.type === 'MANUAL_ADJUSTMENT')).toHaveLength(Number(edited));
    expect(after.movements.filter(m => m.type === 'CHECKOUT_DECREMENT')).toHaveLength(Number(purchased));
    if (edited) expect(after.movements.find(m => m.type === 'MANUAL_ADJUSTMENT'))
      .toMatchObject({ quantityDelta: 2, balanceAfter: 7, idempotencyKey: `SKU_EDIT:${f.product.id}:${f.product.version}:${f.variant.id}` });
    if (purchased) {
      const item = await db.orderItem.findFirstOrThrow({ where: { variantId: f.variant.id } });
      expect(item.quantity).toBe(2);
      expect(item.unitPrice.toFixed(2)).toBe('10000.00');
      expect(item.lineTotal.toFixed(2)).toBe('20000.00');
      expect(await db.order.count({ where: { items: { some: { variantId: f.variant.id } } } })).toBe(1);
      const replay = await request(app.getHttpServer()).post('/checkouts').set('Authorization', 'Bearer ' + tokens.buyer)
        .set('Idempotency-Key', purchase.key).send(purchase.input).expect(200);
      expect(replay.body.replayed).toBe(true);
      expect(replay.body.orders).toEqual(purchaseResponse.body.orders);
      expect(await state(f)).toEqual(after);
    } else expect(await db.order.count({ where: { items: { some: { variantId: f.variant.id } } } })).toBe(0);
    expect(after.outbox).toHaveLength(Number(edited) + Number(purchased));
  });

  it('rolls back Product CAS, Variant and MANUAL_ADJUSTMENT when outbox enqueue fails', async () => {
    const f = await fixture(), before = await state(f);
    const enqueue = vi.spyOn(app.get(SearchOutboxService), 'writeOutboxEvent')
      .mockRejectedValueOnce(new Error('Synthetic outbox fault for rollback proof'));
    const response = await edit(f, body(f, { stock: 9 })).expect(500);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(await state(f)).toEqual(before);
    expect(JSON.stringify(response.body)).not.toMatch(/Synthetic outbox fault|postgresql|prisma|password/i);
    enqueue.mockRestore();
    await edit(f, body(f, { stock: 9 })).expect(200);
    const after = await state(f);
    expect(after.product.version).toBe(f.product.version + 1);
    expect(after.movements).toHaveLength(1);
    expect(after.movements[0]).toMatchObject({ quantityDelta: 4, balanceAfter: 9 });
    expect(after.outbox).toHaveLength(1);
  });
});
