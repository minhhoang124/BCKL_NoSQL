// Synthetic isolated-QA fixtures only. No dotenv, demo, reset or ledger cleanup.
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { hash } from 'bcryptjs';

export function qaUrl(value) {
  const url = new URL(value ?? '');
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '5549');
  assert.equal(
    url.pathname,
    '/bckl_order_resolution_test_attributes_20261019_v950',
  );
  assert.equal(url.username, 'bckl_qa_app_20261021');
  assert(
    !url.hash &&
      [...url.searchParams].every(([k, v]) => k === 'schema' && v === 'public'),
  );
  assert(url.searchParams.getAll('schema').length <= 1);
  return url;
}

async function main() {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  for (const filename of ['.env', 'BE/.env', 'FE/.env']) {
    try {
      await access(path.join(root, filename));
      throw Error('Refusing dotenv');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  const url = qaUrl(process.env.DATABASE_URL);
  const password =
    process.env.QA_AFTERSALES_PASSWORD ?? randomBytes(24).toString('base64url');
  assert(password.length >= 12 && password.length <= 100);
  const passwordHash = await hash(password, 10);
  const pool = new pg.Pool({ connectionString: url.toString() });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const marker = 'aftersales-qa-' + randomUUID();
  const output = path.join(
    process.env.QA_HANDOFF_OUTPUT_ROOT ??
      path.join(root, 'artifacts/aftersales-qa'),
    marker,
  );
  try {
    const [identity] =
      await db.$queryRaw`SELECT current_database() AS name,current_user AS actor,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
    assert.equal(identity.name, url.pathname.slice(1));
    assert.equal(identity.actor, url.username);
    assert(
      !identity.rolsuper && !identity.rolcreatedb && !identity.rolcreaterole,
    );
    const rows =
      await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert(
      rows.some(
        (r) =>
          r.migration_name ===
          '20261026080000_aftersales_receipt_history_binding',
      ),
    );
    const result = await db.$transaction(
      async (tx) => {
        const actors = {};
        for (const [name, role] of [
          ['buyer', 'USER'],
          ['seller', 'SELLER'],
          ['admin', 'ADMIN'],
        ]) {
          const user = await tx.user.create({
            data: {
              email: `${marker}-${name}@example.invalid`,
              role,
              passwordHash,
              fullName: `QA Aftersales ${name}`,
            },
          });
          actors[name] = { id: user.id, email: user.email, role };
        }
        const store = await tx.store.create({
          data: { sellerId: actors.seller.id, name: marker, status: 'ACTIVE' },
        });
        const category = await tx.category.create({
          data: { name: marker, slug: marker },
        });
        const product = await tx.product.create({
          data: {
            storeId: store.id,
            categoryId: category.id,
            name: 'Synthetic aftersales item',
          },
        });
        const variant = await tx.productVariant.create({
          data: {
            storeId: store.id,
            productId: product.id,
            skuCode: marker,
            optionSignature: '[]',
            price: '50000.00',
            stock: 5,
          },
        });
        const orders = [];
        for (const scenario of ['DELIVERED', 'COMPLETED', 'EXPIRED']) {
          const checkout = await tx.checkout.create({
            data: {
              buyerId: actors.buyer.id,
              idempotencyKey: `${marker}-${scenario}`,
              requestHash: 'synthetic-aftersales-qa-fixture',
            },
          });
          const deliveredAt = new Date(
            Date.now() - (scenario === 'EXPIRED' ? 31 : 1) * 86400000,
          );
          const order = await tx.order.create({
            data: {
              checkoutId: checkout.id,
              buyerId: actors.buyer.id,
              storeId: store.id,
              orderNumber: `${marker}-${scenario}`,
              status: scenario === 'COMPLETED' ? 'COMPLETED' : 'DELIVERED',
              deliveredAt,
              completedAt: scenario === 'COMPLETED' ? deliveredAt : null,
              recipientNameSnapshot: 'Synthetic QA recipient',
              phoneSnapshot: '0000000000',
              provinceSnapshot: 'QA',
              wardSnapshot: 'QA',
              addressLineSnapshot: 'Synthetic QA address',
              subtotal: '100000.00',
              shippingFee: '20000.00',
              total: '120000.00',
              payment: {
                create: {
                  provider: 'COD',
                  status: 'PAID',
                  amount: '120000.00',
                  paidAt: deliveredAt,
                },
              },
              items: {
                create: {
                  productId: product.id,
                  variantId: variant.id,
                  quantity: 2,
                  unitPrice: '50000.00',
                  lineTotal: '100000.00',
                  productNameSnapshot: 'Synthetic aftersales item',
                  skuSnapshot: marker,
                  optionSnapshot: [],
                },
              },
            },
            include: { items: true },
          });
          const item = order.items[0];
          await tx.stockMovement.create({
            data: {
              variantId: variant.id,
              orderItemId: item.id,
              type: 'CHECKOUT_DECREMENT',
              quantityDelta: -2,
              balanceAfter: 9 - orders.length * 2,
              idempotencyKey: `${marker}-${scenario}-decrement`,
            },
          });
          orders.push({ scenario, orderId: order.id, orderItemId: item.id });
        }
        return {
          actors,
          storeId: store.id,
          productId: product.id,
          variantId: variant.id,
          orders,
        };
      },
      { timeout: 15000 },
    );
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, 'private-credentials.json'),
      JSON.stringify(
        { syntheticQaOnly: true, password, actors: result.actors },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    const summary = {
      marker,
      database: identity.name,
      applicationRole: identity.actor,
      ...result,
      credentialsFile: path.join(output, 'private-credentials.json'),
    };
    await writeFile(
      path.join(output, 'summary.json'),
      JSON.stringify(summary, null, 2) + '\n',
      { flag: 'wx' },
    );
    console.log(
      JSON.stringify({ result: 'PASS', fixture: summary, demoTouched: false }),
    );
  } finally {
    await db.$disconnect();
    await pool.end().catch(() => {});
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    console.error(JSON.stringify({ result: 'FAIL', code: e.code ?? e.name }));
    process.exitCode = 1;
  });
}
