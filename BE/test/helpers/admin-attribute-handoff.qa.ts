import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import request from 'supertest';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { PrismaService } from '../../src/prisma.service.js';
import { assertAttributeReadQaTarget } from './attribute-read-qa-target.js';

// Explicit local QA seeder, never collected by default E2E. Creates a NEW bundle
// every run; does not reset accounts, passwords, immutable audits or prior data.
describe('Attributes handoff fixture — actual login and HTTP writes', () => {
  let app: INestApplication, db: PrismaService;
  const marker = `attribute_handoff_${randomUUID()}`;
  beforeAll(async () => {
    assertAttributeReadQaTarget(process.env.DATABASE_URL);
    const m = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = m.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });
  it('builds two independent loginable Admins, four data types and private fixture manifest', async () => {
    const outputRoot = path.resolve(process.env.QA_HANDOFF_OUTPUT_ROOT ?? '');
    const commonGit = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const repoRoot = path.dirname(path.resolve(process.cwd(), commonGit));
    if (
      outputRoot !== path.join(repoRoot, 'artifacts', 'attributes-handoff-qa')
    )
      throw new Error('Scoped private artifact root required');
    if (
      !execFileSync(
        'git',
        ['check-ignore', 'artifacts/attributes-handoff-qa/example.json'],
        { cwd: repoRoot, encoding: 'utf8', windowsHide: true },
      ).trim()
    )
      throw new Error('Private handoff directory must be ignored by Git');
    const actors: {
      label: string;
      id: number;
      email: string;
      password: string;
      token: string;
    }[] = [];
    for (const [label, role] of [
      ['admin-a', 'ADMIN'],
      ['admin-b', 'ADMIN'],
      ['seller', 'SELLER'],
      ['buyer', 'USER'],
    ] as const) {
      const password = randomBytes(24).toString('base64url');
      const email = `${marker}-${label}@example.test`;
      const user = await db.user.create({
        data: {
          email,
          role,
          fullName: `QA ${label}`,
          passwordHash: await hash(password, 10),
        },
      });
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      expect(login.body.user.id).toBe(user.id);
      actors.push({
        label,
        id: user.id,
        email,
        password,
        token: login.body.accessToken as string,
      });
    }
    const category = await db.category.create({
      data: {
        name: 'QA bàn giao thuộc tính — LOCAL',
        slug: marker.replaceAll('_', '-'),
      },
    });
    const store = await db.store.create({
      data: {
        sellerId: actors[2].id,
        name: 'QA Attributes fixture Store',
        status: 'ACTIVE',
      },
    });
    const base = `/admin/categories/${category.id}/attributes`;
    const definitions = [];
    for (const [name, slug, dataType] of [
      ['Chất liệu', 'chat-lieu', 'TEXT'],
      ['Dung lượng', 'dung-luong', 'NUMBER'],
      ['Có bảo hành', 'co-bao-hanh', 'BOOLEAN'],
      ['Kết nối', 'ket-noi', 'SINGLE_SELECT'],
    ] as const) {
      const created = await request(app.getHttpServer())
        .post(base)
        .auth(actors[0].token, { type: 'bearer' })
        .send({ name, slug, dataType })
        .expect(201);
      definitions.push(
        created.body.definition as {
          id: number;
          revision: number;
          dataType: string;
        },
      );
    }
    const select = definitions[3];
    const option = await request(app.getHttpServer())
      .post(`${base}/${select.id}/options`)
      .auth(actors[0].token, { type: 'bearer' })
      .send({
        expectedRevision: select.revision,
        value: 'Bluetooth',
        slug: 'bluetooth',
      })
      .expect(201);
    const inactive = await request(app.getHttpServer())
      .post(`${base}/${select.id}/options`)
      .auth(actors[0].token, { type: 'bearer' })
      .send({
        expectedRevision: option.body.definition.revision,
        value: 'USB cũ',
        slug: 'usb-cu',
        isActive: false,
      })
      .expect(201);
    const draft = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: 'QA DRAFT có thuộc tính',
      },
    });
    const values = [
      { attributeDefinitionId: definitions[0].id, textValue: 'Vải QA' },
      { attributeDefinitionId: definitions[1].id, numberValue: '0' },
      { attributeDefinitionId: definitions[2].id, booleanValue: false },
      {
        attributeDefinitionId: select.id,
        optionId: option.body.option.id as number,
      },
    ];
    // Explicit synthetic fixture input; not claimed to be a Seller UI flow.
    for (const value of values)
      await db.productAttributeValue.create({
        data: { productId: draft.id, ...value },
      });
    // Historical Order fixture is created by actual Checkout, never by inventing
    // a receipt/history row. Product approval and catalog inputs below are
    // synthetic QA setup, not evidence of a Seller moderation/browser flow.
    const purchased = await db.product.create({
      data: {
        storeId: store.id,
        categoryId: category.id,
        name: 'QA hàng đã mua — snapshot gốc',
        sellerStatus: 'ACTIVE',
        moderationStatus: 'APPROVED',
        images: {
          create: {
            url: '/uploads/qa-attributes-fixture.png',
            isPrimary: true,
          },
        },
        shippingProfile: { create: { packageWeightGrams: 100 } },
        variants: {
          create: {
            skuCode: `${marker}-ordered`,
            optionSignature: 'default',
            price: '25000',
            stock: 3,
          },
        },
      },
    });
    for (const value of values)
      await db.productAttributeValue.create({
        data: { productId: purchased.id, ...value },
      });
    const variant = await db.productVariant.findFirstOrThrow({
      where: { productId: purchased.id },
    });
    const group = await db.productOptionGroup.create({
      data: { productId: purchased.id, name: 'Màu SKU' },
    });
    const skuValue = await db.productOptionValue.create({
      data: {
        productId: purchased.id,
        groupId: group.id,
        value: 'Đen snapshot',
      },
    });
    await db.productVariantOptionValue.create({
      data: {
        variantId: variant.id,
        productId: purchased.id,
        optionGroupId: group.id,
        optionValueId: skuValue.id,
      },
    });
    const address = await db.userAddress.create({
      data: {
        userId: actors[3].id,
        recipientName: 'Người nhận QA snapshot',
        phone: '0901234567',
        province: 'Province QA',
        ward: 'Ward QA',
        addressLine: 'Địa chỉ gốc khi mua',
      },
    });
    const cart = await db.cart.create({ data: { userId: actors[3].id } });
    await db.cartItem.create({
      data: { cartId: cart.id, variantId: variant.id, quantity: 1 },
    });
    const checkout = await request(app.getHttpServer())
      .post('/checkouts')
      .auth(actors[3].token, { type: 'bearer' })
      .set('Idempotency-Key', `handoff_order_${randomUUID()}`)
      .send({
        addressId: address.id,
        paymentProvider: 'COD',
        items: [
          { variantId: variant.id, quantity: 1, expectedUnitPrice: '25000' },
        ],
      })
      .expect(201);
    const orderId: number = checkout.body.orders[0].id;
    const historical = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, payment: true, statusHistory: true },
    });
    expect(historical.items[0].optionSnapshot).toEqual([
      {
        groupId: group.id,
        groupName: group.name,
        valueId: skuValue.id,
        value: skuValue.value,
      },
    ]);
    expect(historical.items[0].unitPrice.toFixed(2)).toBe('25000.00');
    expect(historical.payment?.status).toBe('UNPAID');
    expect(historical.statusHistory).toHaveLength(1);
    expect(
      (await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } }))
        .stock,
    ).toBe(2);
    expect(
      await db.stockMovement.count({ where: { variantId: variant.id } }),
    ).toBe(1);
    for (const [prefix, actor] of [
      ['', actors[3]],
      ['/seller', actors[2]],
    ] as const) {
      const detail = await request(app.getHttpServer())
        .get(`${prefix}/orders/${orderId}`)
        .auth(actor.token, { type: 'bearer' })
        .expect(200);
      expect(detail.body.items[0]).toMatchObject({
        productName: purchased.name,
        options: ['Đen snapshot'],
        unitPrice: '25000.00',
        lineTotal: '25000.00',
      });
    }
    const summary = [];
    for (const definition of definitions) {
      const detail = await request(app.getHttpServer())
        .get(`${base}/${definition.id}`)
        .auth(actors[1].token, { type: 'bearer' })
        .expect(200);
      expect(detail.body.usage.referencedProductCount).toBe(2);
      summary.push(detail.body);
    }
    const audits = await db.categoryAttributeAudit.findMany({
      where: { categoryId: category.id },
      select: { id: true },
    });
    expect(audits).toHaveLength(6); // Four CREATE definitions + two CREATE options, through actual API.
    const snapshotBefore = JSON.stringify(
      await db.categoryAttributeDefinition.findMany({
        where: { categoryId: category.id },
        orderBy: { id: 'asc' },
      }),
    );
    for (const a of actors.slice(0, 2))
      await request(app.getHttpServer())
        .get(base)
        .auth(a.token, { type: 'bearer' })
        .expect(200);
    expect(
      JSON.stringify(
        await db.categoryAttributeDefinition.findMany({
          where: { categoryId: category.id },
          orderBy: { id: 'asc' },
        }),
      ),
    ).toBe(snapshotBefore);
    await mkdir(outputRoot, { recursive: true });
    const bundle = await mkdtemp(path.join(outputRoot, 'attributes-'));
    await writeFile(
      path.join(bundle, 'credentials.private.json'),
      JSON.stringify(
        { localOnly: true, actors: actors.map(({ token: _token, ...a }) => a) },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
    await writeFile(
      path.join(bundle, 'fixture-map.json'),
      JSON.stringify(
        {
          localOnly: true,
          marker,
          qaDatabase: { host: '127.0.0.1', port: 5549, name: new URL(process.env.DATABASE_URL!).pathname.slice(1) },
          categoryId: category.id,
          storeId: store.id,
          draftProductId: draft.id,
          definitions: summary,
          purchasedProductId: purchased.id,
          purchasedVariantId: variant.id,
          orderId,
          checkoutId: checkout.body.checkoutId,
          buyerId: actors[3].id,
          historicalOrder: {
            createdVia: 'POST /checkouts',
            payment: 'COD/UNPAID',
            unitPrice: '25000.00',
            quantity: 1,
            stockAfter: 2,
            stockMovementCount: 1,
            optionSnapshot: historical.items[0].optionSnapshot,
          },
          activeOptionId: option.body.option.id,
          inactiveOptionId: inactive.body.option.id,
          currentSelectRevision: inactive.body.definition.revision,
          auditCount: audits.length,
          limitations: [
            'Catalog approval is synthetic QA setup, not moderation/browser evidence',
            'Image URL is fixture metadata, not a managed image file',
            'No live UI or loaded Search acceptance',
            'HTTP app stopped after fixture seed; localhost is not shared hosting',
          ],
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      `Private QA bundle created: ${path.relative(repoRoot, bundle)}; contents withheld.`,
    );
  });
});
