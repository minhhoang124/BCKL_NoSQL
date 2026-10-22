import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { configureApp } from '../configure-app.js';
import { ProductImageStorageService } from './product-image-storage.service.js';
import type { UploadedImage } from './product-image-storage.service.js';
import { ProductLifecycleService } from './product-lifecycle.service.js';
import { ProductService } from './product.service.js';
import { SellerProductController } from './seller-product.controller.js';

// Real controller, configureApp, Nest/Multer parser and Sharp storage; fake
// authentication and Product persistence. This is NOT a JWT/PostgreSQL E2E.
describe('Seller upload HTTP parser security (isolated)', () => {
  let app: INestApplication;
  let directory: string;
  let png: Buffer;
  let storage: ProductImageStorageService;
  const route = '/seller/products/42/images';
  const addImage = vi.fn(
    async (
      _actor: number,
      productId: number,
      _dto: unknown,
      file: UploadedImage,
    ) => {
      const receipt = await storage.save(productId, file);
      await storage.discard(receipt);
      return { url: receipt.url };
    },
  );
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'bckl-upload-http-'));
    vi.stubEnv('UPLOAD_ROOT', directory);
    storage = new ProductImageStorageService();
    png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const module = await Test.createTestingModule({
      controllers: [SellerProductController],
      providers: [
        { provide: ProductService, useValue: { addImage } },
        { provide: ProductLifecycleService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = {
            userId: 7,
            role: 'SELLER',
          };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => {
    if (app) await app.close();
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('accepts a real PNG through the production upload interceptor', async () => {
    const response = await request(app.getHttpServer())
      .post(route)
      .attach('file', png, 'valid.png')
      .expect(201);
    expect(response.body.url).toMatch(/\.png$/);
    expect(addImage).toHaveBeenCalledOnce();
  });
  it('rejects SVG disguised as JPEG without leaving staged files', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    );
    await request(app.getHttpServer())
      .post(route)
      .attach('file', svg, { filename: 'probe.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(addImage).toHaveBeenCalledOnce();
    const files = await readdir(directory, {
      recursive: true,
      withFileTypes: true,
    });
    expect(files.filter((entry) => entry.isFile())).toEqual([]);
  });
  it('rejects unexpected file fields before Product persistence', async () => {
    await request(app.getHttpServer())
      .post(route)
      .attach('wrong', png, 'valid.png')
      .expect(400);
    expect(addImage).not.toHaveBeenCalled();
  });
  it('rejects duplicate file fields before Product persistence', async () => {
    await request(app.getHttpServer())
      .post(route)
      .attach('file', png, 'one.png')
      .attach('file', png, 'two.png')
      .expect(400);
    expect(addImage).not.toHaveBeenCalled();
  });
  it('keeps the 5 MiB parser limit and returns 413 before Product persistence', async () => {
    await request(app.getHttpServer())
      .post(route)
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), 'large.png')
      .expect(413);
    expect(addImage).not.toHaveBeenCalled();
  });
  it('rejects a missing multipart boundary and can serve a subsequent valid upload', async () => {
    await request(app.getHttpServer())
      .post(route)
      .set('Content-Type', 'multipart/form-data')
      .send('incomplete')
      .expect(400);
    expect(addImage).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post(route)
      .attach('file', png, 'valid.png')
      .expect(201);
    expect(addImage).toHaveBeenCalledOnce();
  });
});
