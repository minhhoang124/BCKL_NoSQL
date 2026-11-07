import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { ProductImageStorageService } from './product-image-storage.service.js';

describe('Product input validation', () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it.each([{ name: null }, { categoryId: null }])(
    'rejects non-nullable PATCH fields: %o',
    async (input) => {
      const errors = await validate(plainToInstance(UpdateProductDto, input));
      expect(errors).not.toHaveLength(0);
    },
  );

  it('allows nullable PATCH fields that are nullable in the schema', async () => {
    const errors = await validate(
      plainToInstance(UpdateProductDto, {
        brandId: null,
        description: null,
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('decodes an image and rejects a truncated file with a valid header', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'product-image-test-'));
    process.env.UPLOAD_ROOT = tempRoot;
    process.env.BACKEND_PUBLIC_URL = 'http://localhost:3001';
    const storage = new ProductImageStorageService();
    const validPng = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    const stored = await storage.save(1, {
      buffer: validPng,
      mimetype: 'image/png',
      size: validPng.length,
      originalname: 'valid.png',
    });
    expect(stored.url).toMatch(
      /\/uploads\/products\/1\/[a-f0-9]{64}\.png$/,
    );
    await storage.publish(stored);
    const duplicate = await storage.save(1, {
      buffer: validPng,
      mimetype: 'image/png',
      size: validPng.length,
      originalname: 'duplicate.png',
    });
    expect(duplicate.url).toBe(stored.url);
    await storage.discard(duplicate);

    const truncatedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    await expect(
      storage.save(1, {
        buffer: truncatedJpeg,
        mimetype: 'image/jpeg',
        size: truncatedJpeg.length,
        originalname: 'truncated.jpg',
      }),
    ).rejects.toThrow('JPEG, PNG hoặc WebP hợp lệ');
  });
});
