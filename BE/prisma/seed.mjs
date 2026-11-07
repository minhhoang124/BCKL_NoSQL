import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { config } from 'dotenv';
import pg from 'pg';
import { ensureDemoUser } from './seed-demo-user.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(currentDirectory, '../../.env') });
config({ path: path.resolve(currentDirectory, '../.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database');
}

const { Pool } = pg;
const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DEMO_PASSWORD = 'Demo123!';

/**
 * Create-if-missing helper: returns the existing record or creates a new one.
 * Never updates an existing record.
 */
async function findOrCreate(client, uniqueWhere, createData) {
  const existing = await client.findUnique({ where: uniqueWhere });
  if (existing) return { record: existing, created: false };
  const record = await client.create({ data: createData });
  return { record, created: true };
}

async function seed() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  await prisma.$transaction(async (tx) => {
    const seller = await ensureDemoUser({
      userClient: tx.user,
      email: 'seller.demo@example.com',
      expectedRole: 'SELLER',
      fullName: 'Demo Seller',
      demoPassword: DEMO_PASSWORD,
      passwordHash,
    });

    await ensureDemoUser({
      userClient: tx.user,
      email: 'admin.demo@example.com',
      expectedRole: 'ADMIN',
      fullName: 'Demo Admin',
      demoPassword: DEMO_PASSWORD,
      passwordHash,
    });

    // Store: create only if this Seller has no Store yet.
    const { record: store } = await findOrCreate(
      tx.store,
      { sellerId: seller.id },
      { sellerId: seller.id, name: 'Demo Electronics Store' },
    );

    // Categories: create only if slugs don't exist yet.
    const { record: electronics } = await findOrCreate(
      tx.category,
      { slug: 'electronics' },
      { name: 'Electronics', slug: 'electronics' },
    );

    const { record: audio } = await findOrCreate(
      tx.category,
      { slug: 'electronics-audio' },
      { name: 'Audio', slug: 'electronics-audio', parentId: electronics.id },
    );

    // Brand: create only if slug doesn't exist yet.
    const { record: brand } = await findOrCreate(
      tx.brand,
      { slug: 'demo-brand' },
      { name: 'Demo Brand', slug: 'demo-brand' },
    );

    // Product: create only if externalId doesn't exist yet.
    // If Product already exists, treat its entire subtree as user-owned data.
    const { record: product, created: productCreated } = await findOrCreate(
      tx.product,
      { externalId: 'internal:demo-electronics-001' },
      {
        externalId: 'internal:demo-electronics-001',
        storeId: store.id,
        categoryId: audio.id,
        brandId: brand.id,
        name: 'Demo Wireless Headphones',
        description:
          'Draft seed product used to verify the product-domain schema.',
      },
    );

    // Variant and Shipping are only created when the Product was freshly
    // created in this seed run.  If the Product already existed, the Seller
    // may have edited or deleted its Variant/Shipping — we must not override.
    if (productCreated) {
      await tx.productVariant.create({
        data: {
          productId: product.id,
          storeId: store.id,
          skuCode: 'DEMO-ELECTRONICS-001-DEFAULT',
          price: '990000.00',
          stock: 10,
          optionSignature: 'default',
        },
      });

      await tx.productShippingProfile.create({
        data: { productId: product.id, packageWeightGrams: 500 },
      });
    }
  });
}

try {
  await seed();
  console.log(
    'Seed completed: seller, admin, store, categories and one draft product.',
  );
} finally {
  await prisma.$disconnect();
  await pool.end();
}
