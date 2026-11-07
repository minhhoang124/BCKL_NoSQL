import { Test } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma.service.js';

// Real Nest multipart + HTTP fixture + PostgreSQL hydration; no HTTP mock.
// The retrieval fixture is NOT FastAPI, CLIP, FAISS or quality evidence.
describe('image gateway PostgreSQL public-policy boundary', () => {
  let app: INestApplication, server: Server, prisma: PrismaService, png: Buffer;
  let visible: number, hidden: number, sellerId: number, storeId: number;
  let malformed = false;
  const marker = `image-gateway-${randomUUID()}`;
  const previousUrl = process.env.AI_SERVICE_URL;
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* Consume multipart memory stream. */
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          query: {
            type: malformed ? 'text' : 'image',
            topK: 10,
            candidateK: 30,
          },
          items: [
            { productId: hidden, rank: 1, score: 0.99 },
            { productId: visible, rank: 2, score: 0.9 },
            { productId: visible, rank: 3, score: 0.8 },
          ],
          responseTimeMs: 2,
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    process.env.AI_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    sellerId = (
      await prisma.user.create({
        data: {
          email: `${marker}@example.test`,
          passwordHash: 'NO_LOGIN_QA',
          role: 'SELLER',
        },
      })
    ).id;
    storeId = (
      await prisma.store.create({
        data: { sellerId, name: marker, status: 'ACTIVE' },
      })
    ).id;
    const category = await prisma.category.create({
      data: { name: marker, slug: marker },
    });
    for (const draft of [false, true]) {
      const product = await prisma.product.create({
        data: {
          storeId,
          categoryId: category.id,
          name: draft ? 'PRIVATE_DRAFT_MUST_NOT_LEAK' : marker,
          sellerStatus: draft ? 'DRAFT' : 'ACTIVE',
          moderationStatus: draft ? 'NOT_SUBMITTED' : 'APPROVED',
          images: {
            create: {
              url: '/uploads/qa-image-query-only.png',
              isPrimary: true,
            },
          },
          shippingProfile: { create: { packageWeightGrams: 100 } },
        },
      });
      await prisma.productVariant.create({
        data: {
          productId: product.id,
          storeId,
          skuCode: `${marker}-${draft}`,
          optionSignature: 'default',
          price: '10000.00',
          stock: 5,
        },
      });
      if (draft) hidden = product.id;
      else visible = product.id;
    }
    png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
  });
  afterAll(async () => {
    await app?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousUrl === undefined) delete process.env.AI_SERVICE_URL;
    else process.env.AI_SERVICE_URL = previousUrl;
    // Preserve QA fixture/audit, never broad-delete another suite's state.
  });
  const search = () =>
    request(app.getHttpServer())
      .post('/search/image')
      .attach('image', png, 'query.png');
  async function snapshot() {
    return {
      products: await prisma.product.findMany({
        where: { id: { in: [visible, hidden] } },
      }),
      variants: await prisma.productVariant.findMany({
        where: { productId: { in: [visible, hidden] } },
      }),
      outbox: await prisma.searchOutbox.count({
        where: { productId: { in: [visible, hidden] } },
      }),
    };
  }
  it('dedupes, keeps relative rank, rejects draft and never mutates business state', async () => {
    const before = await snapshot();
    const response = await search().expect(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      productId: visible,
      rank: 2,
      score: 0.9,
      product: { id: visible },
    });
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_DRAFT');
    expect(await snapshot()).toEqual(before);
  });
  it('uses current canonical Seller eligibility, not stale hits', async () => {
    await prisma.user.update({
      where: { id: sellerId },
      data: { isActive: false },
    });
    const before = await snapshot();
    const response = await search().expect(200);
    expect(response.body.items).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });
  it('rejects malformed HTTP200 even when valid-shaped IDs exist', async () => {
    malformed = true;
    const before = await snapshot();
    await search().expect(502);
    expect(await snapshot()).toEqual(before);
  });
});
