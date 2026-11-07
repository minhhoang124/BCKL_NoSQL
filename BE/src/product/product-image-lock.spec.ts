import { mkdir, rename, rm } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductImageStorageService } from './product-image-storage.service.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  copyFile: vi.fn(),
  writeFile: vi.fn(),
}));

describe('Product image operation locks', () => {
  beforeEach(() => vi.resetAllMocks());

  it('serializes the entire upload/delete operation for a product', async () => {
    const storage = new ProductImageStorageService();
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const events: string[] = [];
    const upload = storage.withProductImageLock(1, async () => {
      events.push('upload-read');
      await gate;
      events.push('upload-published');
    });
    const deletion = storage.withProductImageLock(1, async () => {
      events.push('delete-read');
      events.push('delete-committed');
    });
    // Another product must not wait for the blocked upload.
    await storage.withProductImageLock(2, async () => undefined);
    expect(events).toEqual(['upload-read']);
    finish();
    await Promise.all([upload, deletion]);
    expect(events).toEqual([
      'upload-read',
      'upload-published',
      'delete-read',
      'delete-committed',
    ]);
  });

  it('releases product lock even when an operation fails', async () => {
    const storage = new ProductImageStorageService();
    await expect(
      storage.withProductImageLock(1, async () => {
        throw new Error('operation failed');
      }),
    ).rejects.toThrow('operation failed');
    await expect(
      storage.withProductImageLock(1, async () => 'retry'),
    ).resolves.toBe('retry');
  });

  it('releases path lock when creating trash fails, allowing retry', async () => {
    const storage = new ProductImageStorageService();
    vi.mocked(mkdir).mockRejectedValueOnce(new Error('disk error'));
    const url = 'http://localhost:3001/uploads/products/1/test.png';
    await expect(storage.stageDeletion(url)).rejects.toThrow('disk error');
    const staged = await storage.stageDeletion(url);
    expect(staged).not.toBeNull();
    expect(rename).toHaveBeenCalledTimes(1);
    await storage.finalizeDeletion(staged!);
    expect(rm).toHaveBeenCalledTimes(1);
  });
});
