// Local manual-QA workspace only. Never use this script for demo/production.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const be = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privatePath = path.join(be, '.env.address-cart-handoff.json');
const uploadRoot = path.join(be, '.env.address-cart-handoff-uploads');
export function safePort(value) {
  assert(
    /^\d{4,5}$/.test(String(value)),
    'Port must be an integer from 1024 to 65535',
  );
  const port = Number(value);
  assert(
    port >= 1024 && port <= 65535,
    'Port must be an integer from 1024 to 65535',
  );
  return port;
}
export function safeOrigin(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  safePort(url.port);
  assert.equal(url.origin, value, 'Only a bare loopback origin allowed');
  return value;
}
export function safeDatabase(value) {
  const url = new URL(value ?? '');
  assert(['postgres:', 'postgresql:'].includes(url.protocol));
  assert(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    'Only loopback database allowed',
  );
  assert(
    /^\/bckl_hien_address_cart_\d{8}(?:_[a-z0-9]+)?$/.test(url.pathname),
    'Dedicated handoff database required',
  );
  // pg connection-string options can override host/database. Never permit them.
  assert(
    !url.hash &&
      [...url.searchParams].every(
        ([key, val]) => key === 'schema' && val === 'public',
      ),
    'Connection overrides are not allowed',
  );
  return url.pathname.slice(1);
}
async function configuration(create = false) {
  try {
    const config = JSON.parse(await readFile(privatePath, 'utf8'));
    safeDatabase(config.databaseUrl);
    safeOrigin(config.apiUrl);
    safeOrigin(config.frontendUrl);
    assert.notEqual(
      config.apiUrl,
      config.frontendUrl,
      'API and Frontend need different ports',
    );
    assert(
      /^handoff-[a-f0-9-]{36}$/.test(config.marker) &&
        Array.isArray(config.accounts) &&
        config.accounts.length === 4,
    );
    assert(
      typeof config.jwtAccessSecret === 'string' &&
        config.jwtAccessSecret.length >= 64,
    );
    assert(
      typeof config.jwtRefreshSecret === 'string' &&
        config.jwtRefreshSecret.length >= 64,
    );
    return config;
  } catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
    safeDatabase(process.env.DATABASE_URL);
    const apiUrl = `http://127.0.0.1:${safePort(process.env.HANDOFF_API_PORT ?? 3011)}`;
    const frontendUrl = `http://127.0.0.1:${safePort(process.env.HANDOFF_FE_PORT ?? 5175)}`;
    assert.notEqual(
      apiUrl,
      frontendUrl,
      'API and Frontend need different ports',
    );
    const marker = `handoff-${randomUUID()}`;
    return {
      marker,
      databaseUrl: process.env.DATABASE_URL,
      apiUrl,
      frontendUrl,
      jwtAccessSecret: randomBytes(32).toString('hex'),
      jwtRefreshSecret: randomBytes(32).toString('hex'),
      accounts: ['buyer-a', 'buyer-b', 'seller-a', 'seller-b'].map((label) => ({
        label,
        email: `${marker}-${label}@example.test`,
        password: `Aa1!${randomBytes(18).toString('hex')}`,
        role: label.startsWith('buyer') ? 'USER' : 'SELLER',
      })),
    };
  }
}
function database(config) {
  safeDatabase(config.databaseUrl);
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  return { pool, prisma: new PrismaClient({ adapter: new PrismaPg(pool) }) };
}
async function prepare() {
  const config = await configuration(true);
  const { apiUrl, frontendUrl } = config;
  const { pool, prisma } = database(config);
  try {
    let exists = true;
    try {
      await readFile(privatePath);
    } catch (error) {
      if (error.code === 'ENOENT') exists = false;
      else throw error;
    }
    if (!exists) {
      assert.equal(
        await prisma.user.count(),
        0,
        'Refuse to seed a database containing other users',
      );
      assert.equal(
        await prisma.product.count(),
        0,
        'Refuse to seed existing catalog',
      );
      // Persist credentials before commit so restart can resume without resetting passwords.
      await writeFile(privatePath, JSON.stringify(config, null, 2), {
        flag: 'wx',
        mode: 0o600,
      });
    }
    await mkdir(uploadRoot, { recursive: true });
    await writeFile(
      path.join(uploadRoot, 'handoff.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#fff0e8"/><text x="24" y="85" fill="#a03000" font-size="20">QA fixture only</text></svg>',
    );
    const hashes = await Promise.all(
      config.accounts.map((account) => bcrypt.hash(account.password, 12)),
    );
    config.fixtures = await prisma.$transaction(
      async (tx) => {
        const users = new Map();
        for (let i = 2; i < 4; i++) {
          const account = config.accounts[i];
          const existing = await tx.user.findUnique({
            where: { email: account.email },
          });
          if (existing) {
            assert.equal(existing.role, account.role);
            assert(
              await bcrypt.compare(account.password, existing.passwordHash),
              'Do not reset existing password',
            );
          }
          const user =
            existing ??
            (await tx.user.create({
              data: {
                email: account.email,
                passwordHash: hashes[i],
                role: account.role,
                fullName: `QA ${account.label}`,
              },
            }));
          users.set(account.label, user);
          account.id = user.id;
        }
        const stores = [];
        for (const label of ['seller-a', 'seller-b'])
          stores.push(
            (await tx.store.findUnique({
              where: { sellerId: users.get(label).id },
            })) ??
              (await tx.store.create({
                data: {
                  sellerId: users.get(label).id,
                  name: `QA ${label}`,
                  status: 'ACTIVE',
                },
              })),
          );
        const category =
          (await tx.category.findUnique({ where: { slug: config.marker } })) ??
          (await tx.category.create({
            data: { slug: config.marker, name: 'QA manual test leaf' },
          }));
        const fixtures = [];
        for (const [label, storeIndex, stock, price, draft] of [
          ['normal', 0, 200, '10000.00', false],
          ['other-store', 1, 10, '25000.00', false],
          ['last-stock', 0, 1, '12000.00', false],
          ['out-of-stock', 0, 0, '15000.00', false],
          ['private-draft', 0, 8, '16000.00', true],
        ]) {
          const skuCode = `${config.marker}-${label}`;
          const existing = await tx.productVariant.findUnique({
            where: { skuCode },
          });
          if (existing) {
            fixtures.push({
              label,
              variantId: existing.id,
              productId: existing.productId,
            });
            continue;
          }
          const storeId = stores[storeIndex].id;
          const product = await tx.product.create({
            data: {
              storeId,
              categoryId: category.id,
              name: `QA ${label}`,
              description:
                'Explicit manual QA fixture. Not ABO or seller moderation evidence.',
              sellerStatus: draft ? 'DRAFT' : 'ACTIVE',
              moderationStatus: draft ? 'NOT_SUBMITTED' : 'APPROVED',
              images: {
                create: { url: '/uploads/handoff.svg', isPrimary: true },
              },
              shippingProfile: { create: { packageWeightGrams: 100 } },
            },
          });
          const variant = await tx.productVariant.create({
            data: {
              productId: product.id,
              storeId,
              skuCode,
              optionSignature: 'default',
              price,
              stock,
            },
          });
          fixtures.push({
            label,
            variantId: variant.id,
            productId: product.id,
          });
        }
        for (let i = 0; i < 2; i++) {
          const account = config.accounts[i];
          const existing = await tx.user.findUnique({
            where: { email: account.email },
          });
          if (existing) {
            assert.equal(existing.role, 'USER');
            assert(
              await bcrypt.compare(account.password, existing.passwordHash),
              'Do not reset existing password',
            );
            account.id = existing.id;
            continue;
          }
          const user = await tx.user.create({
            data: {
              email: account.email,
              passwordHash: hashes[i],
              role: 'USER',
              fullName: `QA ${account.label}`,
              addresses: {
                create: {
                  recipientName: `QA ${account.label}`,
                  phone: '0900000000',
                  province: 'QA Province',
                  ward: 'QA Ward',
                  addressLine: 'QA address, not a real recipient',
                  isDefault: true,
                },
              },
              cart: {
                create: {
                  items: {
                    create: fixtures
                      .filter((f) =>
                        ['normal', 'other-store'].includes(f.label),
                      )
                      .map((f) => ({ variantId: f.variantId, quantity: 2 })),
                  },
                },
              },
            },
          });
          account.id = user.id;
        }
        return fixtures;
      },
      { timeout: 30000 },
    );
    await writeFile(privatePath, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
    const buyersPath = path.join(be, '.env.address-cart-buyers.txt');
    await writeFile(
      buyersPath,
      [
        'LOCAL QA ONLY — không gửi lên GitHub. localhost của Hiền không phải máy Hoàng.',
        `API: ${apiUrl}`,
        `Frontend: ${frontendUrl}`,
        ...config.accounts
          .slice(0, 2)
          .map((a) => `${a.label}\nEmail: ${a.email}\nPassword: ${a.password}`),
      ].join('\n\n'),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        status: 'PREPARED',
        database: safeDatabase(config.databaseUrl),
        privateCredentials: privatePath,
        apiUrl,
        frontendUrl,
        fixtures: config.fixtures,
      }),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
async function serve() {
  const config = await configuration();
  assert(config.fixtures?.length === 5, 'Run prepare first');
  const { apiUrl, frontendUrl } = config;
  // Explicit override before importing AppModule; no accidental dev DB/index access.
  Object.assign(process.env, {
    DATABASE_URL: config.databaseUrl,
    JWT_ACCESS_SECRET: config.jwtAccessSecret,
    JWT_REFRESH_SECRET: config.jwtRefreshSecret,
    NODE_ENV: 'development',
    FRONTEND_URL: frontendUrl,
    UPLOAD_ROOT: uploadRoot,
    AI_SERVICE_URL: 'http://127.0.0.1:9',
    SEARCH_SYNC_ENABLED: 'false',
    SEARCH_RECONCILIATION_ENABLED: 'false',
    PRODUCT_IMAGE_REPAIR_ENABLED: 'false',
    ORDER_AUTO_COMPLETE_ENABLED: 'false',
  });
  const { NestFactory } = await import('@nestjs/core');
  const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
  const { AppModule } = await import('../dist/app.module.js');
  const { configureApp } = await import('../dist/configure-app.js');
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.useStaticAssets(uploadRoot, { prefix: '/uploads/' });
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Isolated Address/Cart QA')
        .setVersion('local-only')
        .addBearerAuth()
        .build(),
    ),
  );
  app.enableShutdownHooks();
  await app.listen(safePort(new URL(apiUrl).port), '127.0.0.1');
  console.log(
    `HANDOFF_READY ${apiUrl}/docs — local loopback only; no shared index workers`,
  );
}
async function verify() {
  const config = await configuration();
  const { pool, prisma } = database(config);
  const { apiUrl } = config;
  const checks = [];
  let temporaryId, result;
  const verificationPath = path.join(
    be,
    '.env.address-cart-handoff-verification.json',
  );
  await writeFile(
    verificationPath,
    JSON.stringify({ status: 'RUNNING', startedAt: new Date().toISOString() }),
  );
  // Email local-part must fit 64 characters; do not concatenate two UUIDs.
  const temporaryEmail = `qa-${randomUUID()}@example.test`;
  async function http(method, route, body, token, status = 200) {
    const response = await fetch(`${apiUrl}${route}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(
      response.status,
      status,
      `${method} ${route}: HTTP ${response.status}, expected ${status}`,
    );
    return {
      data: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get('set-cookie'),
    };
  }
  try {
    await http('GET', '/health');
    checks.push('health + real PostgreSQL');
    const sessions = [];
    for (const account of config.accounts.slice(0, 2)) {
      const session = await http('POST', '/auth/login', {
        email: account.email,
        password: account.password,
      });
      assert.equal(session.data.user.role, 'USER');
      assert.equal(
        (await http('GET', '/auth/me', null, session.data.accessToken)).data.id,
        account.id,
      );
      const refresh = await fetch(`${apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: { Cookie: session.cookie.split(';')[0] },
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(refresh.status, 200);
      sessions.push(session.data);
      checks.push(`${account.label} real login/me/refresh`);
    }
    const register = await http(
      'POST',
      '/auth/register',
      {
        email: temporaryEmail,
        password: `Aa1!${randomBytes(18).toString('hex')}`,
        fullName: 'Ephemeral QA',
      },
      null,
      201,
    );
    temporaryId = register.data.user.id;
    const token = register.data.accessToken;
    const addressBody = {
      recipientName: 'QA ephemeral',
      phone: '0900000000',
      province: 'QA',
      ward: 'QA',
      addressLine: 'QA',
      isDefault: true,
    };
    const address = (
      await http('POST', '/me/addresses', addressBody, token, 201)
    ).data;
    await http(
      'PATCH',
      `/me/addresses/${address.id}`,
      { addressLine: 'QA updated' },
      token,
    );
    const foreign = sessions[1].accessToken;
    await http(
      'PATCH',
      `/me/addresses/${address.id}`,
      { addressLine: 'Forbidden' },
      foreign,
      404,
    );
    assert(
      !(await http('GET', '/me/addresses', null, foreign)).data.items.some(
        (a) => a.id === address.id,
      ),
    );
    await http(
      'PATCH',
      `/me/addresses/${address.id}`,
      { isDefault: false },
      token,
      409,
    );
    for (let i = 1; i < 20; i++)
      await http(
        'POST',
        '/me/addresses',
        { ...addressBody, recipientName: `QA ${i}`, isDefault: false },
        token,
        201,
      );
    await http(
      'POST',
      '/me/addresses',
      { ...addressBody, isDefault: false },
      token,
      409,
    );
    assert.equal(
      (await http('GET', '/me/addresses', null, token)).data.items.length,
      20,
    );
    checks.push(
      'address create/read/update + foreign 404 + default guard + 20-address limit',
    );
    const fixture = (label) => config.fixtures.find((f) => f.label === label);
    const stockBefore = (
      await prisma.productVariant.findUniqueOrThrow({
        where: { id: fixture('normal').variantId },
      })
    ).stock;
    await http(
      'PUT',
      `/cart/items/${fixture('normal').variantId}`,
      { quantity: 99 },
      token,
    );
    await http(
      'PUT',
      `/cart/items/${fixture('normal').variantId}`,
      { quantity: 2 },
      token,
    );
    await http(
      'PUT',
      `/cart/items/${fixture('other-store').variantId}`,
      { quantity: 1 },
      token,
    );
    await http(
      'PUT',
      `/cart/items/${fixture('last-stock').variantId}`,
      { quantity: 2 },
      token,
      409,
    );
    await http(
      'PUT',
      `/cart/items/${fixture('normal').variantId}`,
      { quantity: 100 },
      token,
      400,
    );
    await http(
      'PUT',
      `/cart/items/${fixture('normal').variantId}`,
      { quantity: 0 },
      token,
      400,
    );
    for (const label of ['out-of-stock', 'private-draft'])
      await http(
        'PUT',
        `/cart/items/${fixture(label).variantId}`,
        { quantity: 1 },
        token,
        409,
      );
    const cart = (await http('GET', '/cart', null, token)).data;
    assert.equal(cart.groups.length, 2);
    assert.equal(cart.lineCount, 2);
    assert.equal(cart.totalQuantity, 3);
    assert.equal(cart.purchasableSubtotal, '45000.00');
    assert.equal(
      (
        await prisma.productVariant.findUniqueOrThrow({
          where: { id: fixture('normal').variantId },
        })
      ).stock,
      stockBefore,
    );
    checks.push(
      'cart grouping/counts/Decimal + max quantity/stock/visibility + no stock reservation',
    );
    for (const label of ['normal', 'other-store', 'out-of-stock'])
      await http('GET', `/products/${fixture(label).productId}`);
    await http(
      'GET',
      `/products/${fixture('private-draft').productId}`,
      null,
      null,
      404,
    );
    const image = await fetch(`${apiUrl}/uploads/handoff.svg`, {
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(image.status, 200);
    assert(image.headers.get('content-type').includes('image/svg+xml'));
    checks.push(
      'public product fixtures + private 404 + real served fixture image',
    );
    // Only controlled fixture injection tests stale private Cart lines, never public API creation.
    await prisma.cartItem.create({
      data: {
        cartId: (
          await prisma.cart.findUniqueOrThrow({
            where: { userId: temporaryId },
          })
        ).id,
        variantId: fixture('private-draft').variantId,
        quantity: 1,
      },
    });
    const hidden = (
      await http('GET', '/cart', null, token)
    ).data.unavailableItems.find(
      (item) => item.variantId === fixture('private-draft').variantId,
    );
    assert(hidden);
    assert(!('productName' in hidden));
    assert(!('currentUnitPrice' in hidden));
    checks.push('private draft Cart line leaks no name/price');
    const preview = (
      await http(
        'POST',
        '/checkout/preview',
        {
          addressId: address.id,
          paymentProvider: 'COD',
          items: [
            {
              variantId: fixture('normal').variantId,
              quantity: 2,
              expectedUnitPrice: '10000.00',
            },
          ],
        },
        token,
      )
    ).data;
    assert.equal(preview.canCheckout, true);
    assert.equal(preview.totals.total, '20000.00');
    assert.equal(
      await prisma.order.count({ where: { buyerId: temporaryId } }),
      0,
    );
    checks.push('real Checkout preview selected line only; no Order created');
    await http(
      'DELETE',
      `/cart/items/${fixture('normal').variantId}`,
      null,
      token,
      204,
    );
    await http('DELETE', `/me/addresses/${address.id}`, null, token, 204);
    checks.push('address/cart delete');
    result = {
      status: 'PASS',
      checkedAt: new Date().toISOString(),
      database: safeDatabase(config.databaseUrl),
      checks,
      fixtures: config.fixtures,
      limitations: [
        'Browser Hiền Address/Cart integration NOT_RUN',
        'No actual checkout write in this handoff verification',
        'ES/FAISS/production payments NOT_RUN',
      ],
    };
  } finally {
    try {
      // Registration can commit even when its HTTP response is lost. Recover only
      // this run's unique email before cleanup; never touch a handoff Buyer.
      if (!temporaryId) {
        temporaryId = (
          await prisma.user.findUnique({
            where: { email: temporaryEmail },
            select: { id: true },
          })
        )?.id;
      }
      if (temporaryId) {
        const user = await prisma.user.findUnique({
          where: { id: temporaryId },
        });
        assert.equal(
          user?.email,
          temporaryEmail,
          'Cleanup must match this exact ephemeral fixture',
        );
        assert.equal(
          await prisma.order.count({ where: { buyerId: temporaryId } }),
          0,
          'Do not delete purchased data',
        );
        await prisma.user.delete({ where: { id: temporaryId } }); // Owned addresses/cart/tokens cascade.
      }
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  }
  // PASS includes successful scoped cleanup, not just HTTP assertions.
  result.cleanup =
    'Ephemeral verification Buyer and owned address/cart/tokens removed; handoff accounts preserved';
  await writeFile(verificationPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const action = process.argv[2];
  try {
    if (action === 'prepare') await prepare();
    else if (action === 'serve') await serve();
    else if (action === 'verify') await verify();
    else
      throw new Error(
        'Use prepare | serve | verify. Set dedicated DATABASE_URL before prepare; migrate deploy first.',
      );
  } catch (error) {
    // Do not print connection strings, credentials, response bodies or JWTs.
    console.error(
      `HANDOFF_FAILED ${error instanceof assert.AssertionError ? error.message.split('\n')[0] : (error.code ?? 'See local configuration/build and prerequisites')}`,
    );
    process.exitCode = 1;
  }
}
