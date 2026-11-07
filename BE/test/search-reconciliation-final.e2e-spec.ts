import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { SearchReconciliationService, sameReconciliationJson } from '../src/search/search-reconciliation.service.js';
import { buildUpsertPayload } from '../src/search/search-outbox.service.js';
import { listingInclude } from '../src/product/product-public-policy.js';
import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';
import { isFinalDayQaTarget } from './helpers/final-day-qa-target.js';

// Actual PostgreSQL JSONB and Serializable CAS; no index/network/provider calls.
// Deliberate source drift is fixture setup, not evidence of the Seller edit API.
describe('Search reconciliation JSONB stability — isolated PostgreSQL', () => {
  let app: INestApplication, db: PrismaService, reconciliation: SearchReconciliationService;
  beforeAll(async () => {
    assertRuntimeQaTarget(process.env.DATABASE_URL, process.env.GITHUB_ACTIONS);
    const target = new URL(process.env.DATABASE_URL!);
    const ci = process.env.GITHUB_ACTIONS === 'true' &&
      ['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/klcn_ecommerce';
    if (!isFinalDayQaTarget(target) && !ci) throw new Error('Explicit final-day or canonical isolated CI database required');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ bodyParser: false });
    configureApp(app); await app.init(); db = app.get(PrismaService); reconciliation = app.get(SearchReconciliationService);
  });
  afterAll(async () => { await app?.close(); });

  async function fixture() {
    const mark = 'reconcile-final-' + randomUUID();
    const seller = await db.user.create({ data: { email: mark + '@example.test', passwordHash: 'Synthetic-no-login', role: 'SELLER' } });
    const store = await db.store.create({ data: { sellerId: seller.id, name: 'Synthetic reconciliation Store', status: 'ACTIVE' } });
    const category = await db.category.create({ data: { name: 'Synthetic attribute category', slug: mark } });
    // Long name first, short name second: JSONB roundtrips reorder keys by storage
    // rules, unlike the insertion order used to build the JavaScript attributes.
    const long = await db.categoryAttributeDefinition.create({ data: { categoryId: category.id, name: 'VeryLongAttributeName', slug: 'long', dataType: 'TEXT' } });
    const short = await db.categoryAttributeDefinition.create({ data: { categoryId: category.id, name: 'a', slug: 'short', dataType: 'TEXT' } });
    const boolean = await db.categoryAttributeDefinition.create({ data: { categoryId: category.id, name: 'Waterproof', slug: 'waterproof', dataType: 'BOOLEAN' } });
    const product = await db.product.create({ data: {
      storeId: store.id, categoryId: category.id, name: 'Synthetic multi-attribute reconciliation',
      sellerStatus: 'ACTIVE', moderationStatus: 'APPROVED', description: 'Stable description',
      shippingProfile: { create: { packageWeightGrams: 100 } },
      images: { create: [{ url: 'https://example.invalid/long-first.jpg', isPrimary: true, sortOrder: 0 }, { url: 'https://example.invalid/second.jpg', isPrimary: false, sortOrder: 1 }] },
    } });
    const variant = await db.productVariant.create({ data: { productId: product.id, storeId: store.id, skuCode: mark, optionSignature: 'default', price: '10000.00', stock: 3 } });
    await db.productAttributeValue.create({ data: { productId: product.id, attributeDefinitionId: long.id, textValue: 'Cotton' } });
    await db.productAttributeValue.create({ data: { productId: product.id, attributeDefinitionId: short.id, textValue: 'Blue' } });
    await db.productAttributeValue.create({ data: { productId: product.id, attributeDefinitionId: boolean.id, booleanValue: false } });
    return { product, variant, category, store };
  }
  const events = (id: number) => db.searchOutbox.findMany({ where: { productId: id }, orderBy: { version: 'asc' } });
  async function productVersion(id: number) { return (await db.product.findUniqueOrThrow({ where: { id } })).version; }

  it('compares a real JSONB object roundtrip without attribute key-order churn', async () => {
    const attributes = { VeryLongAttributeName: ['Cotton'], a: ['Blue'], Waterproof: ['false'] };
    const encoded = JSON.stringify(attributes);
    const [stored] = await db.$queryRaw<{ value: Record<string, unknown> }[]>`SELECT ${encoded}::jsonb AS value`;
    expect(JSON.stringify(stored.value)).not.toBe(encoded);
    expect(sameReconciliationJson(attributes, stored.value)).toBe(true);
    expect(Object.keys(stored.value).sort()).toEqual(Object.keys(attributes).sort());
  });

  it('creates once for a multi-attribute public Product then repeatedly skips the JSONB-persisted payload', async () => {
    const f = await fixture();
    expect(await reconciliation.reconcileProduct(f.product.id)).toBe('CREATED');
    const baseline = (await events(f.product.id))[0];
    expect(baseline).toMatchObject({ operation: 'UPSERT', version: f.product.version + 1 });
    expect(baseline.payload).toMatchObject({ attributes: { VeryLongAttributeName: ['Cotton'], a: ['Blue'], Waterproof: ['false'] }, minPrice: '10000', inStock: true });
    const source = await db.product.findUniqueOrThrow({ where: { id: f.product.id }, include: listingInclude });
    const categories = await db.category.findMany({ select: { id: true, parentId: true, isActive: true } });
    const payload = buildUpsertPayload(source, categories) as Record<string, unknown>;
    expect(sameReconciliationJson(payload.attributes, (baseline.payload as Record<string, unknown>).attributes)).toBe(true);
    for (let i = 0; i < 3; i++) expect(await reconciliation.reconcileProduct(f.product.id)).toBe('SKIPPED');
    expect(await productVersion(f.product.id)).toBe(f.product.version + 1);
    expect(await events(f.product.id)).toEqual([baseline]);
    expect(await db.stockMovement.count({ where: { variantId: f.variant.id } })).toBe(0);
  });

  it('emits one fresh version for genuine price drift, skips afterward and leaves the original immutable event untouched', async () => {
    const f = await fixture(); await reconciliation.reconcileProduct(f.product.id);
    const original = (await events(f.product.id))[0];
    await db.searchOutbox.update({ where: { id: original.id }, data: { status: 'SUCCEEDED', attemptCount: 2, processedAt: new Date(), nextAttemptAt: null } });
    const preserved = (await events(f.product.id))[0];
    await db.productVariant.update({ where: { id: f.variant.id }, data: { price: '17000.00' } });
    expect(await productVersion(f.product.id)).toBe(f.product.version + 1);
    expect(await reconciliation.reconcileProduct(f.product.id)).toBe('CREATED');
    const changed = await events(f.product.id);
    expect(changed).toHaveLength(2); expect(changed[0]).toEqual(preserved);
    expect(changed[1]).toMatchObject({ operation: 'UPSERT', version: preserved.version + 1, status: 'PENDING', attemptCount: 0 });
    expect(changed[1].payload).toMatchObject({ minPrice: '17000', maxPrice: '17000' });
    expect(await reconciliation.reconcileProduct(f.product.id)).toBe('SKIPPED');
    expect(await events(f.product.id)).toEqual(changed);
    expect(await productVersion(f.product.id)).toBe(preserved.version + 1);
  });

  it('does not drop a newly introduced attribute key while comparing the scoped attributes object', async () => {
    const f = await fixture(); await reconciliation.reconcileProduct(f.product.id);
    const original = (await events(f.product.id))[0];
    const extra = await db.categoryAttributeDefinition.create({ data: { categoryId: f.category.id, name: 'AdditionalAttribute', slug: 'additional', dataType: 'TEXT' } });
    await db.productAttributeValue.create({ data: { productId: f.product.id, attributeDefinitionId: extra.id, textValue: '0' } });
    expect(await reconciliation.reconcileProduct(f.product.id)).toBe('CREATED');
    const changed = await events(f.product.id); expect(changed).toHaveLength(2); expect(changed[0]).toEqual(original);
    expect(changed[1].payload).toMatchObject({ attributes: { AdditionalAttribute: ['0'], Waterproof: ['false'], a: ['Blue'], VeryLongAttributeName: ['Cotton'] } });
    expect(await reconciliation.reconcileProduct(f.product.id)).toBe('SKIPPED');
    expect(await events(f.product.id)).toEqual(changed);
  });

  it('preserves meaningful image array order and produces one event when the primary image changes', async () => {
    const f = await fixture(); await reconciliation.reconcileProduct(f.product.id);
    const original = (await events(f.product.id))[0];
    const images = await db.productImage.findMany({ where: { productId: f.product.id }, orderBy: { sortOrder: 'asc' } });
    await db.$transaction(async tx => {
      await tx.productImage.update({ where: { id: images[0].id }, data: { isPrimary: false } });
      await tx.productImage.update({ where: { id: images[1].id }, data: { isPrimary: true } });
    });
    expect(await reconciliation.reconcileProduct(f.product.id)).toBe('CREATED');
    const changed = await events(f.product.id); expect(changed).toHaveLength(2); expect(changed[0]).toEqual(original);
    expect(changed[1].payload).toMatchObject({ imageUrls: [images[1].url, images[0].url] });
    expect(await reconciliation.reconcileProduct(f.product.id)).toBe('SKIPPED');
    expect(await events(f.product.id)).toEqual(changed);
  });

  it.each(['initial', 'price-drift'] as const)('two simultaneous reconcilers create exactly one version/event for %s', async mode => {
    const f = await fixture();
    let original: Awaited<ReturnType<typeof events>> = [];
    if (mode === 'price-drift') {
      expect(await reconciliation.reconcileProduct(f.product.id)).toBe('CREATED');
      original = await events(f.product.id);
      await db.productVariant.update({ where: { id: f.variant.id }, data: { price: '19000.00' } });
    }
    const version = await productVersion(f.product.id);
    const results = await Promise.all([reconciliation.reconcileProduct(f.product.id), reconciliation.reconcileProduct(f.product.id)]);
    expect(results.sort()).toEqual(['CREATED', 'SKIPPED']);
    expect(await productVersion(f.product.id)).toBe(version + 1);
    const all = await events(f.product.id); expect(all).toHaveLength(original.length + 1);
    if (original.length) expect(all[0]).toEqual(original[0]);
    expect(all.at(-1)?.version).toBe(version + 1);
    expect(await reconciliation.reconcileProduct(f.product.id)).toBe('SKIPPED');
    expect(await events(f.product.id)).toEqual(all);
  });
});
