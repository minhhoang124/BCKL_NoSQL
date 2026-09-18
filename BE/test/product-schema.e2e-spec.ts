import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma.service.js';

describe('Product schema constraints (e2e)', () => {
  let prisma: PrismaService;
  let productId: number | undefined;
  let storeId: number | undefined;
  let categoryId: number | undefined;
  let userId: number | undefined;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.$connect();

    const marker = `outbox-e2e-${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        email: `${marker}@example.com`,
        passwordHash: 'not-used-by-this-test',
        role: 'SELLER',
      },
    });
    userId = user.id;

    const store = await prisma.store.create({
      data: { sellerId: user.id, name: marker },
    });
    storeId = store.id;
    const category = await prisma.category.create({
      data: { name: marker, slug: marker },
    });
    categoryId = category.id;

    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: marker,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    if (productId) await prisma.product.delete({ where: { id: productId } });
    if (storeId) await prisma.store.delete({ where: { id: storeId } });
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    if (prisma) await prisma.$disconnect();
  });

  it('rejects conflicting operations for the same product version', async () => {
    await prisma.searchOutbox.create({
      data: {
        operation: 'UPSERT',
        productId: productId!,
        version: 1,
        payload: {},
      },
    });

    await expect(
      prisma.searchOutbox.create({
        data: {
          operation: 'DELETE',
          productId: productId!,
          version: 1,
          payload: {},
        },
      }),
    ).rejects.toMatchObject({
      code: 'P2002',
    } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
  });
});
