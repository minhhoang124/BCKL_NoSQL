import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';
import { ProductImageStorageService } from '../src/product/product-image-storage.service.js';

const execFileAsync = promisify(execFile);

describe('Seller Product API and JSONL importer (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let imageStorage: ProductImageStorageService;
  let sellerToken: string;
  let otherSellerToken: string;
  let storeId: number;
  let leafCategoryId: number;
  let brandId: number;
  let tempRoot: string;
  let secondaryPng: Buffer;

  const marker = `product-api-${Date.now()}`;
  const password = 'StrongPass123!';
  const sellerEmail = `${marker}-seller@example.com`;
  const otherSellerEmail = `${marker}-other@example.com`;
  const rootSlug = `${marker}-electronics`;
  const leafSlug = `${marker}-audio`;
  const brandSlug = `${marker}-brand`;
  const importedExternalId = `test:${marker}`;
  const corruptedImageExternalId = `test:${marker}-corrupted-image`;
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'bckl-product-'));
    process.env.UPLOAD_ROOT = path.join(tempRoot, 'uploads');
    process.env.BACKEND_PUBLIC_URL = 'http://localhost:3001';
    secondaryPng = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    imageStorage = app.get(ProductImageStorageService);

    sellerToken = await registerAndGetToken(sellerEmail);
    otherSellerToken = await registerAndGetToken(otherSellerEmail);
    const seller = await prisma.user.findUniqueOrThrow({
      where: { email: sellerEmail },
    });
    const otherSeller = await prisma.user.findUniqueOrThrow({
      where: { email: otherSellerEmail },
    });
    const store = await prisma.store.create({
      data: {
        sellerId: seller.id,
        name: 'Product API Store',
        status: 'ACTIVE',
      },
    });
    storeId = store.id;
    await prisma.store.create({
      data: {
        sellerId: otherSeller.id,
        name: 'Other Product API Store',
        status: 'ACTIVE',
      },
    });
    const root = await prisma.category.create({
      data: { name: `${marker} Electronics`, slug: rootSlug },
    });
    const leaf = await prisma.category.create({
      data: {
        name: `${marker} Audio`,
        slug: leafSlug,
        parentId: root.id,
      },
    });
    leafCategoryId = leaf.id;
    const brand = await prisma.brand.create({
      data: { name: `${marker} Brand`, slug: brandSlug },
    });
    brandId = brand.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.product.deleteMany({
        where: {
          OR: [
            { storeId },
            { externalId: importedExternalId },
            { externalId: corruptedImageExternalId },
            { store: { seller: { email: otherSellerEmail } } },
          ],
        },
      });
      await prisma.brand.deleteMany({ where: { slug: brandSlug } });
      await prisma.category.deleteMany({ where: { slug: leafSlug } });
      await prisma.category.deleteMany({ where: { slug: rootSlug } });
      await prisma.store.deleteMany({
        where: { seller: { email: { in: [sellerEmail, otherSellerEmail] } } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: [sellerEmail, otherSellerEmail] } },
      });
    }
    if (app) await app.close();
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  async function registerAndGetToken(email: string): Promise<string> {
    const passwordHash = await hash(password, 12);
    await prisma.user.create({
      data: { email, passwordHash, role: Role.SELLER },
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return login.body.accessToken as string;
  }

  it('creates owned Product drafts and ingests validated images', async () => {
    const created = await request(app.getHttpServer())
      .post('/seller/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        categoryId: leafCategoryId,
        brandId,
        name: '  Seller Headphones  ',
        description: '  Draft product  ',
        storeId: 999_999,
      })
      .expect(400);
    expect(created.body.message).toBeDefined();

    const productResponse = await request(app.getHttpServer())
      .post('/seller/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        categoryId: leafCategoryId,
        brandId,
        name: '  Seller Headphones  ',
        description: '  Draft product  ',
      })
      .expect(201);
    const productId = productResponse.body.id as number;
    expect(productResponse.body).toMatchObject({
      storeId,
      name: 'Seller Headphones',
      description: 'Draft product',
      sellerStatus: 'DRAFT',
      moderationStatus: 'NOT_SUBMITTED',
      version: 1,
    });

    await request(app.getHttpServer())
      .get(`/seller/products/${productId}`)
      .set('Authorization', `Bearer ${otherSellerToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/seller/products/${productId}`)
      .set('Authorization', `Bearer ${otherSellerToken}`)
      .send({ name: 'Cross-seller edit' })
      .expect(404);

    for (const invalidPatch of [{ name: null }, { categoryId: null }]) {
      await request(app.getHttpServer())
        .patch(`/seller/products/${productId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(invalidPatch)
        .expect(400);
    }

    const image = await request(app.getHttpServer())
      .post(`/seller/products/${productId}/images`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('isPrimary', 'true')
      .attach('file', onePixelPng, {
        filename: 'primary.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(image.body).toMatchObject({ productId, isPrimary: true });
    expect(image.body.url).toMatch(
      new RegExp(`/uploads/products/${productId}/[a-f0-9]{64}\\.png$`),
    );
    const primaryImagePath = path.join(
      process.env.UPLOAD_ROOT!,
      new URL(image.body.url as string).pathname.replace('/uploads/', ''),
    );
    const primaryImageId = image.body.id as number;

    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/images`)
      .set('Authorization', `Bearer ${otherSellerToken}`)
      .attach('file', secondaryPng, {
        filename: 'cross-seller.png',
        contentType: 'image/png',
      })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/images`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .attach('file', Buffer.from('not an image'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/images`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0x00]), {
        filename: 'truncated.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);

    const secondaryImage = await request(app.getHttpServer())
      .post(`/seller/products/${productId}/images`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('isPrimary', 'false')
      .attach('file', secondaryPng, {
        filename: 'secondary.png',
        contentType: 'image/png',
      })
      .expect(201);
    const secondaryImageId = secondaryImage.body.id as number;

    await request(app.getHttpServer())
      .delete(`/seller/products/${productId}/images/${primaryImageId}`)
      .set('Authorization', `Bearer ${otherSellerToken}`)
      .expect(404);

    const deleteTransactionSpy = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(new Error('forced delete transaction failure'));
    await request(app.getHttpServer())
      .delete(`/seller/products/${productId}/images/${primaryImageId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(500);
    deleteTransactionSpy.mockRestore();
    await expect(access(primaryImagePath)).resolves.toBeUndefined();

    await request(app.getHttpServer())
      .delete(`/seller/products/${productId}/images/${primaryImageId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    await expect(access(primaryImagePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });

    await request(app.getHttpServer())
      .get(`/seller/products/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.images).toHaveLength(1);
        expect(body.images[0]).toMatchObject({
          id: secondaryImageId,
          isPrimary: true,
        });
        expect(body.version).toBe(4);
      });

    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/submit`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toContain('variant');
        expect(body.message).toContain('khối lượng');
      });

    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/variants`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ price: '199000.00', stock: 5, sellerSku: 'HEADPHONE-BLACK' })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          productId,
          sellerSku: 'HEADPHONE-BLACK',
          stock: 5,
          isActive: true,
          optionSignature: 'default',
        });
      });

    await request(app.getHttpServer())
      .patch(`/seller/products/${productId}/shipping-profile`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ packageWeightGrams: 350, packageLengthCm: '20.00' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ productId, packageWeightGrams: 350 });
      });

    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/submit`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: productId,
          sellerStatus: 'ACTIVE',
          moderationStatus: 'PENDING',
          version: 7,
        });
      });

    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/images`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .attach('file', onePixelPng, {
        filename: 'pending.png',
        contentType: 'image/png',
      })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/seller/products/${productId}/images/${secondaryImageId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/seller/products/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Cannot edit pending product' })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/seller/products/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.images).toHaveLength(1);
        expect(body.version).toBe(7);
      });

    await prisma.product.update({
      where: { id: productId },
      data: { moderationStatus: 'FROZEN' },
    });
    await request(app.getHttpServer())
      .delete(`/seller/products/${productId}/images/${secondaryImageId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/seller/products/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.images).toHaveLength(1);
        expect(body.version).toBe(7);
      });
  });

  it('supports category attributes and options and reopens approved products for review', async () => {
    const requiredAttribute = await prisma.categoryAttributeDefinition.create({
      data: {
        categoryId: leafCategoryId,
        name: `${marker} Chất liệu`,
        slug: `${marker}-material`,
        dataType: 'TEXT',
        isRequired: true,
      },
    });
    const requiredSelectAttribute =
      await prisma.categoryAttributeDefinition.create({
        data: {
          categoryId: leafCategoryId,
          name: `${marker} Chuẩn kết nối`,
          slug: `${marker}-connection-standard`,
          dataType: 'SINGLE_SELECT',
          isRequired: true,
          allowsCustom: false,
        },
      });
    const requiredSelectOption = await prisma.categoryAttributeOption.create({
      data: {
        attributeDefinitionId: requiredSelectAttribute.id,
        value: 'Bluetooth',
        slug: `${marker}-bluetooth`,
      },
    });
    const productResponse = await request(app.getHttpServer())
      .post('/seller/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        categoryId: leafCategoryId,
        brandId,
        name: 'Configurable Headphones',
      })
      .expect(201);
    const productId = productResponse.body.id as number;

    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/option-groups`)
      .set('Authorization', `Bearer ${otherSellerToken}`)
      .send({ name: 'Màu sắc' })
      .expect(404);

    const groupResponse = await request(app.getHttpServer())
      .post(`/seller/products/${productId}/option-groups`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Màu sắc', position: 0 })
      .expect(201);
    const groupId = groupResponse.body.id as number;
    const blackValue = await request(app.getHttpServer())
      .post(`/seller/products/${productId}/option-groups/${groupId}/values`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ value: 'Đen', position: 0 })
      .expect(201);
    const whiteValue = await request(app.getHttpServer())
      .post(`/seller/products/${productId}/option-groups/${groupId}/values`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ value: 'Trắng', position: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/images`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .field('isPrimary', 'true')
      .attach('file', onePixelPng, {
        filename: 'required-primary.png',
        contentType: 'image/png',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/variants`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        price: '499000.00',
        stock: 8,
        optionValueIds: [blackValue.body.id as number],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/seller/products/${productId}/shipping-profile`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ packageWeightGrams: 450 })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/submit`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toContain(requiredAttribute.name);
      });

    await request(app.getHttpServer())
      .put(`/seller/products/${productId}/attributes/${requiredAttribute.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ numberValue: '10' })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/seller/products/${productId}/attributes/${requiredAttribute.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ textValue: 'Nhựa ABS' })
      .expect(200);

    await request(app.getHttpServer())
      .put(
        `/seller/products/${productId}/attributes/${requiredSelectAttribute.id}`,
      )
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ optionId: requiredSelectOption.id })
      .expect(200);
    await prisma.categoryAttributeOption.update({
      where: { id: requiredSelectOption.id },
      data: { isActive: false },
    });
    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/submit`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toContain(requiredSelectAttribute.name);
      });
    await prisma.categoryAttributeOption.update({
      where: { id: requiredSelectOption.id },
      data: { isActive: true },
    });

    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/submit`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const setApproved = () =>
      prisma.product.update({
        where: { id: productId },
        data: { sellerStatus: 'ACTIVE', moderationStatus: 'APPROVED' },
      });
    const expectReopened = async () => {
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: productId },
      });
      expect(product).toMatchObject({
        sellerStatus: 'DRAFT',
        moderationStatus: 'NOT_SUBMITTED',
        reviewedAt: null,
        reviewedBy: null,
      });
    };

    await setApproved();
    await request(app.getHttpServer())
      .patch(`/seller/products/${productId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ name: 'Configurable Headphones Updated' })
      .expect(200);
    await expectReopened();

    await setApproved();
    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/images`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .attach('file', secondaryPng, {
        filename: 'approved-change.png',
        contentType: 'image/png',
      })
      .expect(201);
    await expectReopened();

    await setApproved();
    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/variants`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        price: '519000.00',
        stock: 4,
        optionValueIds: [whiteValue.body.id as number],
      })
      .expect(201);
    await expectReopened();

    await setApproved();
    await request(app.getHttpServer())
      .patch(`/seller/products/${productId}/shipping-profile`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ packageWeightGrams: 475 })
      .expect(200);
    await expectReopened();

    const failedUpload = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .png()
      .toBuffer();
    const failedUploadHash = createHash('sha256')
      .update(failedUpload)
      .digest('hex');
    const failedUploadPath = path.join(
      process.env.UPLOAD_ROOT!,
      'products',
      String(productId),
      `${failedUploadHash}.png`,
    );
    const transactionSpy = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(new Error('forced transaction failure'));
    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/images`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .attach('file', failedUpload, {
        filename: 'rollback.png',
        contentType: 'image/png',
      })
      .expect(500);
    transactionSpy.mockRestore();
    await expect(access(failedUploadPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps files and rows consistent during concurrent image requests', async () => {
    const productResponse = await request(app.getHttpServer())
      .post('/seller/products')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        categoryId: leafCategoryId,
        brandId,
        name: 'Concurrent Image Product',
      })
      .expect(201);
    const productId = productResponse.body.id as number;
    const concurrentPng = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 20, g: 40, b: 60 },
      },
    })
      .png()
      .toBuffer();

    const publishFailurePng = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    })
      .png()
      .toBuffer();
    const publishFailureHash = createHash('sha256')
      .update(publishFailurePng)
      .digest('hex');
    const publishFailureUrl = `http://localhost:3001/uploads/products/${productId}/${publishFailureHash}.png`;
    const publishFailurePath = path.join(
      process.env.UPLOAD_ROOT!,
      'products',
      String(productId),
      `${publishFailureHash}.png`,
    );
    const publishSpy = vi
      .spyOn(imageStorage, 'publish')
      .mockRejectedValueOnce(new Error('forced publish failure'));
    await request(app.getHttpServer())
      .post(`/seller/products/${productId}/images`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .attach('file', publishFailurePng, {
        filename: 'publish-failure.png',
        contentType: 'image/png',
      })
      .expect(500);
    publishSpy.mockRestore();
    await expect(
      prisma.productImage.count({
        where: { productId, url: publishFailureUrl },
      }),
    ).resolves.toBe(0);
    await expect(access(publishFailurePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { version: true },
      }),
    ).resolves.toEqual({ version: 3 });

    const transactionSpy = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(new Error('forced concurrent upload failure'));
    const uploadResponses = await Promise.all([
      request(app.getHttpServer())
        .post(`/seller/products/${productId}/images`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .attach('file', concurrentPng, {
          filename: 'concurrent-a.png',
          contentType: 'image/png',
        }),
      request(app.getHttpServer())
        .post(`/seller/products/${productId}/images`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .attach('file', concurrentPng, {
          filename: 'concurrent-b.png',
          contentType: 'image/png',
        }),
    ]);
    transactionSpy.mockRestore();
    expect(uploadResponses.map(({ status }) => status).sort()).toEqual([
      201, 500,
    ]);

    const successfulUpload = uploadResponses.find(
      ({ status }) => status === 201,
    );
    expect(successfulUpload).toBeDefined();
    const imageId = successfulUpload!.body.id as number;
    const imageUrl = successfulUpload!.body.url as string;
    const imagePath = path.join(
      process.env.UPLOAD_ROOT!,
      new URL(imageUrl).pathname.replace('/uploads/', ''),
    );
    await expect(access(imagePath)).resolves.toBeUndefined();
    await expect(
      prisma.productImage.count({ where: { productId, url: imageUrl } }),
    ).resolves.toBe(1);

    const stageDeletionSpy = vi.spyOn(imageStorage, 'stageDeletion');
    const finalizeDeletionSpy = vi.spyOn(imageStorage, 'finalizeDeletion');
    const restoreDeletionSpy = vi.spyOn(imageStorage, 'restoreDeletion');
    const deleteResponses = await Promise.all([
      request(app.getHttpServer())
        .delete(`/seller/products/${productId}/images/${imageId}`)
        .set('Authorization', `Bearer ${sellerToken}`),
      request(app.getHttpServer())
        .delete(`/seller/products/${productId}/images/${imageId}`)
        .set('Authorization', `Bearer ${sellerToken}`),
    ]);
    const deleteStatuses = deleteResponses.map(({ status }) => status);
    expect(deleteStatuses.filter((status) => status === 200)).toHaveLength(1);
    expect(
      deleteStatuses.filter((status) => status === 404 || status === 409),
    ).toHaveLength(1);
    // The second DELETE re-reads after the first operation releases its lock.
    expect(stageDeletionSpy).toHaveBeenCalledTimes(1);
    expect(finalizeDeletionSpy).toHaveBeenCalledTimes(1);
    expect(restoreDeletionSpy).not.toHaveBeenCalled();
    stageDeletionSpy.mockRestore();
    finalizeDeletionSpy.mockRestore();
    restoreDeletionSpy.mockRestore();
    await expect(access(imagePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      prisma.productImage.count({ where: { id: imageId } }),
    ).resolves.toBe(0);

    const raceImage = await request(app.getHttpServer())
      .post(`/seller/products/${productId}/images`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .attach('file', concurrentPng, {
        filename: 'race.png',
        contentType: 'image/png',
      })
      .expect(201);
    const raceResponses = await Promise.all([
      request(app.getHttpServer())
        .post(`/seller/products/${productId}/images`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .attach('file', concurrentPng, {
          filename: 'race-retry.png',
          contentType: 'image/png',
        }),
      request(app.getHttpServer())
        .delete(`/seller/products/${productId}/images/${raceImage.body.id}`)
        .set('Authorization', `Bearer ${sellerToken}`),
    ]);
    expect(raceResponses.map(({ status }) => status)).toEqual([201, 200]);
    const remainingRaceImage = await prisma.productImage.findFirst({
      where: { productId, url: imageUrl },
    });
    if (remainingRaceImage) {
      await expect(access(imagePath)).resolves.toBeUndefined();
      await request(app.getHttpServer())
        .delete(`/seller/products/${productId}/images/${remainingRaceImage.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
    }
    await expect(access(imagePath)).rejects.toMatchObject({ code: 'ENOENT' });

    const cleanupImage = await request(app.getHttpServer())
      .post(`/seller/products/${productId}/images`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .attach('file', publishFailurePng, {
        filename: 'cleanup-failure.png',
        contentType: 'image/png',
      })
      .expect(201);
    const cleanupImageId = cleanupImage.body.id as number;
    const cleanupImagePath = path.join(
      process.env.UPLOAD_ROOT!,
      new URL(cleanupImage.body.url as string).pathname.replace(
        '/uploads/',
        '',
      ),
    );
    const finalizeSpy = vi
      .spyOn(imageStorage, 'finalizeDeletion')
      .mockRejectedValueOnce(new Error('forced trash cleanup failure'));
    await request(app.getHttpServer())
      .delete(`/seller/products/${productId}/images/${cleanupImageId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    finalizeSpy.mockRestore();
    await expect(access(cleanupImagePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      prisma.productImage.count({ where: { id: cleanupImageId } }),
    ).resolves.toBe(0);
  });

  it('imports JSONL idempotently and exports PostgreSQL mapping', async () => {
    const packageRoot = path.join(tempRoot, 'package');
    const imageDirectory = path.join(packageRoot, 'images', marker);
    await mkdir(imageDirectory, { recursive: true });
    await writeFile(path.join(imageDirectory, '1.png'), onePixelPng);
    const inputPath = path.join(packageRoot, 'products.jsonl');
    const mappingPath = path.join(tempRoot, 'mapping.jsonl');
    const record = {
      schemaVersion: 1,
      source: 'test',
      externalId: importedExternalId,
      name: 'Imported Original Name',
      description: null,
      brand: null,
      externalCategory: 'audio',
      normalizedCategory: `${marker} Electronics > ${marker} Audio`,
      images: [
        {
          sourcePath: `images/${marker}/1.png`,
          sortOrder: 1,
          isPrimary: true,
        },
      ],
      sourceAttributes: {},
    };
    await writeFile(inputPath, `${JSON.stringify(record)}\n`, 'utf8');

    const commandArguments = [
      'scripts/import-products.mjs',
      '--input',
      inputPath,
      '--images-root',
      packageRoot,
      '--store-id',
      String(storeId),
      '--uploads-root',
      path.join(tempRoot, 'imported-uploads'),
      '--mapping-output',
      mappingPath,
    ];
    await execFileAsync(process.execPath, commandArguments, {
      cwd: path.resolve(process.cwd()),
      env: process.env,
    });

    const imported = await prisma.product.findUniqueOrThrow({
      where: { externalId: importedExternalId },
      include: { images: true },
    });
    expect(imported).toMatchObject({
      name: 'Imported Original Name',
      sellerStatus: 'DRAFT',
      moderationStatus: 'NOT_SUBMITTED',
    });
    expect(imported.images).toHaveLength(1);

    await writeFile(
      inputPath,
      `${JSON.stringify({ ...record, name: 'Must Not Overwrite' })}\n`,
      'utf8',
    );
    await execFileAsync(process.execPath, commandArguments, {
      cwd: path.resolve(process.cwd()),
      env: process.env,
    });

    const afterSecondRun = await prisma.product.findUniqueOrThrow({
      where: { externalId: importedExternalId },
      include: { images: true },
    });
    expect(afterSecondRun.name).toBe('Imported Original Name');
    expect(afterSecondRun.images).toHaveLength(1);
    const mapping = JSON.parse(
      (await readFile(mappingPath, 'utf8')).trim(),
    ) as {
      externalId: string;
      productId: number;
    };
    expect(mapping).toEqual({
      externalId: importedExternalId,
      productId: imported.id,
    });
  });

  it('rejects a truncated image before creating a Product or mapping', async () => {
    const packageRoot = path.join(tempRoot, 'corrupted-image-package');
    const imageDirectory = path.join(packageRoot, 'images', marker);
    const inputPath = path.join(packageRoot, 'products.jsonl');
    const mappingPath = path.join(tempRoot, 'corrupted-image-mapping.jsonl');
    const uploadsRoot = path.join(tempRoot, 'corrupted-image-uploads');
    await mkdir(imageDirectory, { recursive: true });
    await writeFile(
      path.join(imageDirectory, 'truncated.jpg'),
      Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    );
    await writeFile(
      inputPath,
      `${JSON.stringify({
        schemaVersion: 1,
        source: 'test',
        externalId: corruptedImageExternalId,
        name: 'Corrupted image import candidate',
        description: null,
        brand: null,
        externalCategory: 'audio',
        normalizedCategory: `${marker} Electronics > ${marker} Audio`,
        images: [
          {
            sourcePath: `images/${marker}/truncated.jpg`,
            sortOrder: 1,
            isPrimary: true,
          },
        ],
        sourceAttributes: {},
      })}\n`,
      'utf8',
    );

    await expect(
      execFileAsync(
        process.execPath,
        [
          'scripts/import-products.mjs',
          '--input',
          inputPath,
          '--images-root',
          packageRoot,
          '--store-id',
          String(storeId),
          '--uploads-root',
          uploadsRoot,
          '--mapping-output',
          mappingPath,
        ],
        {
          cwd: path.resolve(process.cwd()),
          env: process.env,
        },
      ),
    ).rejects.toBeDefined();
    await expect(
      prisma.product.count({
        where: { externalId: corruptedImageExternalId },
      }),
    ).resolves.toBe(0);
    await expect(access(mappingPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(uploadsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
