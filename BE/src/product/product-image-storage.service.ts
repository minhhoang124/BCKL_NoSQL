import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export type UploadedImage = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

export type StoredProductImage = {
  url: string;
  absolutePath: string;
  stagedPath: string;
};

export type StagedProductImageDeletion = {
  originalPath: string;
  stagedPath: string;
  release: () => void;
};

@Injectable()
export class ProductImageStorageService {
  private readonly pathLocks = new Map<string, Promise<void>>();

  // Single-process coordination: include DB reads, publish and compensation,
  // not just the filesystem call. Multi-instance deployment needs shared locking.
  async withProductImageLock<T>(
    productId: number,
    operation: () => Promise<T>,
  ) {
    const release = await this.acquirePathLock(`product-images:${productId}`);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private readonly uploadRoot = path.resolve(
    process.env.UPLOAD_ROOT ?? path.resolve(process.cwd(), '../uploads'),
  );

  async save(
    productId: number,
    file: UploadedImage,
  ): Promise<StoredProductImage> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Cần chọn một file ảnh');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Ảnh không được vượt quá 5 MB');
    }

    const extension = await this.validateAndDetectExtension(file.buffer);
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const directory = path.join(this.uploadRoot, 'products', String(productId));
    await mkdir(directory, { recursive: true });
    const absolutePath = path.join(directory, `${hash}.${extension}`);
    const stagingDirectory = path.join(this.uploadRoot, '.staging');
    await mkdir(stagingDirectory, { recursive: true });
    const stagedPath = path.join(stagingDirectory, randomUUID());
    await writeFile(stagedPath, file.buffer, { flag: 'wx' });

    const baseUrl = (
      process.env.BACKEND_PUBLIC_URL ??
      `http://localhost:${process.env.BACKEND_PORT ?? 3001}`
    ).replace(/\/$/, '');
    return {
      url: `${baseUrl}/uploads/products/${productId}/${hash}.${extension}`,
      absolutePath,
      stagedPath,
    };
  }

  async publish(receipt: StoredProductImage): Promise<void> {
    try {
      await copyFile(
        receipt.stagedPath,
        receipt.absolutePath,
        constants.COPYFILE_EXCL,
      );
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally {
      await rm(receipt.stagedPath, { force: true });
    }
  }

  async discard(receipt: StoredProductImage): Promise<void> {
    await rm(receipt.stagedPath, { force: true });
  }

  /** Verifies that a managed image URL has a published file on storage. */
  async isPublished(url: string): Promise<boolean> {
    const absolutePath = this.resolveManagedPath(url);
    try {
      await access(absolutePath, constants.F_OK);
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  /** Returns false for remote/legacy URLs without touching the filesystem. */
  isManagedUrl(url: string): boolean {
    try {
      this.resolveManagedPath(url);
      return true;
    } catch {
      return false;
    }
  }

  async stageDeletion(url: string): Promise<StagedProductImageDeletion | null> {
    const originalPath = this.resolveManagedPath(url);
    const release = await this.acquirePathLock(originalPath);
    const trashRoot = path.join(
      path.dirname(this.uploadRoot),
      '.bckl-upload-trash',
    );
    const stagedPath = path.join(trashRoot, randomUUID());
    try {
      await mkdir(trashRoot, { recursive: true });
      await rename(originalPath, stagedPath);
      return { originalPath, stagedPath, release };
    } catch (error: unknown) {
      release();
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async finalizeDeletion(staged: StagedProductImageDeletion): Promise<void> {
    try {
      await rm(staged.stagedPath, { force: true });
    } finally {
      staged.release();
    }
  }

  async restoreDeletion(staged: StagedProductImageDeletion): Promise<void> {
    try {
      await mkdir(path.dirname(staged.originalPath), { recursive: true });
      await rename(staged.stagedPath, staged.originalPath);
    } finally {
      staged.release();
    }
  }

  private async acquirePathLock(pathname: string): Promise<() => void> {
    const previous = this.pathLocks.get(pathname) ?? Promise.resolve();
    let unlock!: () => void;
    const current = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const tail = previous.then(() => current);
    this.pathLocks.set(pathname, tail);
    await previous;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      unlock();
      if (this.pathLocks.get(pathname) === tail) {
        this.pathLocks.delete(pathname);
      }
    };
  }

  private resolveManagedPath(url: string): string {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(url).pathname);
    } catch {
      throw new BadRequestException('Đường dẫn ảnh không hợp lệ');
    }
    const prefix = '/uploads/';
    if (!pathname.startsWith(prefix)) {
      throw new BadRequestException(
        'Ảnh không thuộc vùng lưu trữ của hệ thống',
      );
    }
    const relativePath = pathname.slice(prefix.length);
    const absolutePath = path.resolve(this.uploadRoot, relativePath);
    if (
      absolutePath !== this.uploadRoot &&
      !absolutePath.startsWith(`${this.uploadRoot}${path.sep}`)
    ) {
      throw new BadRequestException('Đường dẫn ảnh vượt vùng lưu trữ');
    }
    return absolutePath;
  }

  private async validateAndDetectExtension(
    buffer: Buffer,
  ): Promise<'jpg' | 'png' | 'webp'> {
    try {
      const image = sharp(buffer, {
        failOn: 'error',
        limitInputPixels: 25_000_000,
        sequentialRead: true,
      });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height) throw new Error('missing size');
      await image.stats();
      if (metadata.format === 'jpeg') return 'jpg';
      if (metadata.format === 'png' || metadata.format === 'webp') {
        return metadata.format;
      }
    } catch {
      // Normalize decoder and resource-limit failures into a safe client error.
    }
    throw new BadRequestException(
      'Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP hợp lệ',
    );
  }
}
