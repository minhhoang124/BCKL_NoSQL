import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductImageStorageService, type UploadedImage } from './product-image-storage.service.js';

const bytesLimit = 5 * 1024 * 1024;
const tempPrefix = 'bckl-image-indexing-';
const tempRoot = path.resolve(os.tmpdir());
const file = (buffer: Buffer): UploadedImage => ({ buffer, size: buffer.length, mimetype: 'image/webp', originalname: 'untrusted-filename.webp' });
const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

describe('Product storage image compatibility with indexing', () => {
  let directory = '';
  let storage: ProductImageStorageService;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tempRoot, tempPrefix));
    vi.stubEnv('UPLOAD_ROOT', directory);
    vi.stubEnv('BACKEND_PUBLIC_URL', 'http://localhost:3001');
    storage = new ProductImageStorageService();
  });
  afterEach(async () => {
    vi.restoreAllMocks();vi.unstubAllEnvs();
    if (directory) {
      const resolved = path.resolve(directory);
      // Recursive cleanup may target only this test's absolute mkdtemp child.
      if (resolved !== directory || path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith(tempPrefix)) throw new Error('Refusing unsafe test cleanup');
      await rm(resolved, { recursive: true, force: true });
      directory = '';
    }
  });
  async function webp() {
    return sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 32, g: 140, b: 222, alpha: 0.4 } } }).webp({ lossless: true }).toBuffer();
  }
  it('stores real PNG bytes/hash/extension and preserves decoded WebP pixels and alpha', async () => {
    const input = await webp();
    const originalPixels = await sharp(input).ensureAlpha().raw().toBuffer();
    const receipt = await storage.save(42, file(input));
    const staged = await readFile(receipt.stagedPath);
    expect(staged.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect((await sharp(staged).metadata()).format).toBe('png');
    expect((await sharp(staged).metadata()).hasAlpha).toBe(true);
    expect(await sharp(staged).ensureAlpha().raw().toBuffer()).toEqual(originalPixels);
    expect(staged).not.toEqual(input);
    expect(receipt.url).toBe(`http://localhost:3001/uploads/products/42/${digest(staged)}.png`);
    expect(path.basename(receipt.absolutePath)).toBe(`${digest(staged)}.png`);
    expect(digest(staged)).not.toBe(digest(input));
    await expect(readFile(receipt.absolutePath)).rejects.toThrow();
    await storage.publish(receipt);
    expect(await readFile(receipt.absolutePath)).toEqual(staged);
    expect(await storage.isPublished(receipt.url)).toBe(true);
    await expect(readFile(receipt.stagedPath)).rejects.toThrow();
  });
  it.each(['jpeg', 'png'] as const)('keeps validated %s bytes and content hash unchanged', async format => {
    const input = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#347abc' } }).toFormat(format).toBuffer();
    const receipt = await storage.save(42, file(input));
    expect(await readFile(receipt.stagedPath)).toEqual(input);
    expect(path.basename(receipt.absolutePath)).toBe(`${digest(input)}.${format === 'jpeg' ? 'jpg' : 'png'}`);
    await storage.publish(receipt);
    expect(await readFile(receipt.absolutePath)).toEqual(input);
  });
  it('does not stage any bytes when original WebP is truncated', async () => {
    const input = Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary');
    const encode = vi.spyOn(sharp.prototype, 'png');
    await expect(storage.save(42, file(input))).rejects.toBeInstanceOf(BadRequestException);
    expect(encode).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });
  it('retains original input size validation before decoding/conversion or writes', async () => {
    const input = Buffer.alloc(bytesLimit + 1);input.write('RIFF', 0);input.write('WEBP', 8);
    const metadata = vi.spyOn(sharp.prototype, 'metadata');
    await expect(storage.save(42, { ...file(input), size: 1 })).rejects.toThrow('5 MB');
    expect(metadata).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });
  it('rejects conversion failure with safe client error before staging', async () => {
    const input = await webp();
    vi.spyOn(sharp.prototype, 'toBuffer').mockRejectedValueOnce(new Error('native decoder PRIVATE_INTERNAL_DETAIL'));
    try { await storage.save(42, file(input));expect.unreachable(); }
    catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as Error).message).toContain('chuẩn hóa');
      expect((error as Error).message).not.toContain('PRIVATE_INTERNAL_DETAIL');
    }
    expect(await readdir(directory)).toEqual([]);
  });
  it('rejects actual WebP-to-PNG expansion beyond 5 MiB before creating directories/files', async () => {
    // Deterministic high-entropy raster: lossy WebP fits the input limit while
    // lossless storage of its decoded pixels expands past the stored-byte cap.
    const pixels = Buffer.alloc(1500 * 1500 * 3);let value = 0x13579bdf;
    for (let i = 0; i < pixels.length; i += 1) { value ^= value << 13;value ^= value >>> 17;value ^= value << 5;pixels[i] = value & 255; }
    const input = await sharp(pixels, { raw: { width: 1500, height: 1500, channels: 3 } }).webp({ quality: 80 }).toBuffer();
    const expanded = await sharp(input, { failOn: 'error', limitInputPixels: 25_000_000, sequentialRead: true }).png().toBuffer();
    expect(input.length).toBeLessThanOrEqual(bytesLimit);
    expect(expanded.length).toBeGreaterThan(bytesLimit);
    await expect(storage.save(42, file(input))).rejects.toThrow('sau chuẩn hóa');
    expect(await readdir(directory)).toEqual([]);
  }, 20000);
});
