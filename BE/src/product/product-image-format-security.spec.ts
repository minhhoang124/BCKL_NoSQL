import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductImageStorageService } from './product-image-storage.service.js';

describe('Product image decoder boundary', () => {
  let directory: string;
  let storage: ProductImageStorageService;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'bckl-image-boundary-'));
    vi.stubEnv('UPLOAD_ROOT', directory);
    vi.stubEnv('BACKEND_PUBLIC_URL', 'http://localhost:3001');
    storage = new ProductImageStorageService();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
  );
  const unsupported = [
    {
      label: 'one-byte header',
      buffer: Buffer.from([0xff]),
      mimetype: 'image/jpeg',
      originalname: 'probe.jpg',
    },
    {
      label: 'SVG',
      buffer: svg,
      mimetype: 'image/svg+xml',
      originalname: 'probe.svg',
    },
    {
      label: 'SVG disguised as JPEG',
      buffer: svg,
      mimetype: 'image/jpeg',
      originalname: 'probe.jpg',
    },
    {
      label: 'GIF',
      buffer: Buffer.from('GIF89a'),
      mimetype: 'image/gif',
      originalname: 'probe.gif',
    },
    {
      label: 'HTML',
      buffer: Buffer.from('<html>not an image</html>'),
      mimetype: 'image/png',
      originalname: 'probe.png',
    },
    {
      label: 'PDF',
      buffer: Buffer.from('%PDF-1.7'),
      mimetype: 'image/jpeg',
      originalname: 'probe.jpg',
    },
  ];
  it.each(unsupported)(
    'rejects $label before native decode and before file writes',
    async (file) => {
      const metadata = vi.spyOn(sharp.prototype, 'metadata');
      const stats = vi.spyOn(sharp.prototype, 'stats');
      await expect(
        storage.save(42, { ...file, size: file.buffer.length }),
      ).rejects.toThrow('JPEG, PNG hoặc WebP hợp lệ');
      expect(metadata).not.toHaveBeenCalled();
      expect(stats).not.toHaveBeenCalled();
      expect(await readdir(directory)).toEqual([]);
    },
  );
  it.each(['jpeg', 'png', 'webp'] as const)(
    'keeps valid %s upload/publish behavior',
    async (format) => {
      const image = sharp({
        create: { width: 2, height: 2, channels: 3, background: '#123456' },
      });
      const buffer = await image.toFormat(format).toBuffer();
      const receipt = await storage.save(42, {
        buffer,
        size: buffer.length,
        mimetype: `image/${format}`,
        originalname: `valid.${format}`,
      });
      expect(receipt.url).toMatch(
        new RegExp(`\\.${format === 'jpeg' ? 'jpg' : format}$`),
      );
      await storage.publish(receipt);
      expect(await storage.isPublished(receipt.url)).toBe(true);
    },
  );
  it.each([
    { label: 'JPEG', buffer: Buffer.from([0xff, 0xd8, 0xff, 0]) },
    {
      label: 'PNG',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
    {
      label: 'WebP',
      buffer: Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary'),
    },
  ])(
    'still decodes and rejects a truncated $label header',
    async ({ buffer }) => {
      const metadata = vi.spyOn(sharp.prototype, 'metadata');
      await expect(
        storage.save(42, {
          buffer,
          size: buffer.length,
          mimetype: 'image/png',
          originalname: 'bad.png',
        }),
      ).rejects.toThrow('JPEG, PNG hoặc WebP hợp lệ');
      expect(metadata).toHaveBeenCalledOnce();
      expect(await readdir(directory)).toEqual([]);
    },
  );
  it('uses actual supported bytes, not an untrusted MIME or filename label', async () => {
    const buffer = await sharp({
      create: { width: 1, height: 1, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const receipt = await storage.save(42, {
      buffer,
      size: buffer.length,
      mimetype: 'text/plain',
      originalname: 'arbitrary.txt',
    });
    expect(receipt.url).toMatch(/\.png$/);
    await storage.discard(receipt);
  });

  it('rejects empty input before native decode', async () => {
    const metadata = vi.spyOn(sharp.prototype, 'metadata');
    await expect(
      storage.save(42, {
        buffer: Buffer.alloc(0),
        size: 0,
        mimetype: 'image/jpeg',
        originalname: 'empty.jpg',
      }),
    ).rejects.toThrow('Cần chọn một file ảnh');
    expect(metadata).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it('rejects decoder format disagreement before full pixel decode (injected metadata)', async () => {
    vi.spyOn(sharp.prototype, 'metadata').mockResolvedValueOnce({
      format: 'gif',
      width: 1,
      height: 1,
    } as Metadata);
    const stats = vi.spyOn(sharp.prototype, 'stats');
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0]);
    await expect(
      storage.save(42, {
        buffer,
        size: buffer.length,
        mimetype: 'image/jpeg',
        originalname: 'disagreement.jpg',
      }),
    ).rejects.toThrow('JPEG, PNG hoặc WebP hợp lệ');
    expect(stats).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it('accepts exactly 5 MiB of valid raster data and rejects one byte more before decode', async () => {
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    // Trailing bytes are permitted by the existing raster API, not re-encoded.
    const buffer = Buffer.alloc(5 * 1024 * 1024);
    png.copy(buffer);
    const receipt = await storage.save(42, {
      buffer,
      size: buffer.length,
      mimetype: 'image/png',
      originalname: 'boundary.png',
    });
    await storage.discard(receipt);
    const metadata = vi.spyOn(sharp.prototype, 'metadata');
    const oversized = Buffer.alloc(buffer.length + 1);
    await expect(
      storage.save(42, {
        buffer: oversized,
        size: oversized.length,
        mimetype: 'image/png',
        originalname: 'oversized.png',
      }),
    ).rejects.toThrow('5 MB');
    expect(metadata).not.toHaveBeenCalled();
  });

  it('does not let a non-Multer caller under-report the actual buffer size', async () => {
    const metadata = vi.spyOn(sharp.prototype, 'metadata');
    const buffer = Buffer.alloc(5 * 1024 * 1024 + 1);
    buffer.set([0xff, 0xd8, 0xff]);
    await expect(
      storage.save(42, {
        buffer,
        size: 1,
        mimetype: 'image/jpeg',
        originalname: 'misreported.jpg',
      }),
    ).rejects.toThrow('5 MB');
    expect(metadata).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });
});
