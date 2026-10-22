import { BadRequestException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CategoryAttributeDataType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma.service.js';
import { ProductService } from '../src/product/product.service.js';
import { SearchOutboxService } from '../src/search/search-outbox.service.js';
import { assertAttributeReadQaTarget } from './helpers/attribute-read-qa-target.js';

type Work<T> = (tx: Prisma.TransactionClient) => Promise<T>;
type Options = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
};
type TransactionPort = {
  $transaction: <T>(work: Work<T>, options?: Options) => Promise<T>;
};

// Actual ProductService + PostgreSQL. A transaction-entry barrier controls when
// the competing configuration commit occurs; domain reads/writes are not mocked.
describe('Seller attribute canonical validation inside transaction', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let productService: ProductService;
  let outbox: SearchOutboxService;
  let port: TransactionPort;
  let transact: TransactionPort['$transaction'];
  const users: number[] = [];
  const stores: number[] = [];
  const categories: number[] = [];
  const products: number[] = [];

  beforeAll(async () => {
    assertAttributeReadQaTarget(process.env.DATABASE_URL);
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    productService = app.get(ProductService);
    outbox = app.get(SearchOutboxService);
    port = prisma as unknown as TransactionPort;
    transact = port.$transaction.bind(prisma);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    vi.restoreAllMocks();
    if (prisma) {
      await prisma.product.deleteMany({ where: { id: { in: products } } });
      await prisma.category.deleteMany({ where: { id: { in: categories } } });
      await prisma.store.deleteMany({ where: { id: { in: stores } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    }
    await app?.close();
  });

  async function fixture(
    dataType: CategoryAttributeDataType,
    approved = false,
  ) {
    const marker = randomUUID();
    const user = await prisma.user.create({
      data: {
        email: `attr-${marker}@example.test`,
        passwordHash: 'NOT_A_LOGIN_FIXTURE',
        role: 'SELLER',
      },
    });
    users.push(user.id);
    const store = await prisma.store.create({
      data: { sellerId: user.id, name: 'QA Attribute Store', status: 'ACTIVE' },
    });
    stores.push(store.id);
    const category = await prisma.category.create({
      data: { name: 'QA Attributes', slug: `attr-${marker}` },
    });
    categories.push(category.id);
    const definition = await prisma.categoryAttributeDefinition.create({
      data: {
        categoryId: category.id,
        name: 'QA definition',
        slug: 'qa-definition',
        dataType,
      },
    });
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: 'QA attribute product',
        sellerStatus: approved ? 'ACTIVE' : 'DRAFT',
        moderationStatus: approved ? 'APPROVED' : 'NOT_SUBMITTED',
      },
    });
    products.push(product.id);
    return { user, product, definition };
  }

  async function unchanged(product: { id: number }) {
    expect(
      await prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
    ).toEqual(product);
    expect(
      await prisma.productAttributeValue.count({
        where: { productId: product.id },
      }),
    ).toBe(0);
    expect(
      await prisma.searchOutbox.count({ where: { productId: product.id } }),
    ).toBe(0);
  }

  it('rejects text if Admin changed unused definition to NUMBER before the write transaction begins', async () => {
    const { user, product, definition } = await fixture('TEXT');
    vi.spyOn(port, '$transaction').mockImplementationOnce(
      async <T>(work: Work<T>, options?: Options) => {
        await prisma.categoryAttributeDefinition.update({
          where: { id: definition.id },
          data: { dataType: 'NUMBER' },
        });
        return transact(work, options);
      },
    );
    await expect(
      productService.upsertAttributeValue(user.id, product.id, definition.id, {
        textValue: 'old text',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (
        await prisma.categoryAttributeDefinition.findUniqueOrThrow({
          where: { id: definition.id },
        })
      ).dataType,
    ).toBe('NUMBER');
    await unchanged(product);
  });

  it('rejects an option disabled before the write transaction begins', async () => {
    const { user, product, definition } = await fixture('SINGLE_SELECT');
    const option = await prisma.categoryAttributeOption.create({
      data: { attributeDefinitionId: definition.id, value: 'USB', slug: 'usb' },
    });
    vi.spyOn(port, '$transaction').mockImplementationOnce(
      async <T>(work: Work<T>, options?: Options) => {
        await prisma.categoryAttributeOption.update({
          where: { id: option.id },
          data: { isActive: false },
        });
        return transact(work, options);
      },
    );
    await expect(
      productService.upsertAttributeValue(user.id, product.id, definition.id, {
        optionId: option.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (
        await prisma.categoryAttributeOption.findUniqueOrThrow({
          where: { id: option.id },
        })
      ).isActive,
    ).toBe(false);
    await unchanged(product);
  });

  it('rolls back a failed attempt and rereads definition on Serializable retry', async () => {
    const { user, product, definition } = await fixture('TEXT');
    const spy = vi.spyOn(port, '$transaction');
    spy.mockImplementationOnce(async <T>(work: Work<T>, options?: Options) =>
      transact(async (tx) => {
        await work(tx);
        throw new Prisma.PrismaClientKnownRequestError(
          'QA serialization failure',
          { code: 'P2034', clientVersion: Prisma.prismaVersion.client },
        );
      }, options),
    );
    spy.mockImplementationOnce(async <T>(work: Work<T>, options?: Options) => {
      await prisma.categoryAttributeDefinition.update({
        where: { id: definition.id },
        data: { dataType: 'NUMBER' },
      });
      return transact(work, options);
    });
    await expect(
      productService.upsertAttributeValue(user.id, product.id, definition.id, {
        textValue: 'old retry text',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(spy).toHaveBeenCalledTimes(2);
    await unchanged(product);
  });

  it.each([
    { type: CategoryAttributeDataType.BOOLEAN, body: { booleanValue: false } },
    { type: CategoryAttributeDataType.NUMBER, body: { numberValue: '0' } },
  ])(
    'preserves $type zero/false and APPROVED reset/version/DELETE atomically',
    async ({ type, body }) => {
      const { user, product, definition } = await fixture(type, true);
      const value = await productService.upsertAttributeValue(
        user.id,
        product.id,
        definition.id,
        body,
      );
      if (type === 'BOOLEAN') expect(value.booleanValue).toBe(false);
      else expect(value.numberValue?.toString()).toBe('0');
      expect(
        await prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
      ).toMatchObject({
        version: 2,
        sellerStatus: 'DRAFT',
        moderationStatus: 'NOT_SUBMITTED',
      });
      const events = await prisma.searchOutbox.findMany({
        where: { productId: product.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        version: 2,
        operation: 'DELETE',
        payload: { productId: product.id, version: 2 },
      });
    },
  );

  it('outbox failure rolls back the value, version and review reset together', async () => {
    const { user, product, definition } = await fixture('BOOLEAN', true);
    vi.spyOn(outbox, 'writeDeleteEvent').mockRejectedValueOnce(
      new Error('QA outbox failure'),
    );
    await expect(
      productService.upsertAttributeValue(user.id, product.id, definition.id, {
        booleanValue: false,
      }),
    ).rejects.toThrow('QA outbox failure');
    await unchanged(product);
  });
});
