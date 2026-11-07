import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { ProductImageStorageService } from './product-image-storage.service.js';
import { isPublicListing, listingInclude } from './product-public-policy.js';
import { SearchOutboxService } from '../search/search-outbox.service.js';
import {
  ProductModerationStatus,
  ProductSellerStatus,
  Prisma,
} from '@prisma/client';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from './transaction-conflict.js';

export interface ImageRepairResult {
  productId: number;
  scannedImages: number;
  removedImages: number;
  promotedPrimary: boolean;
  newVersion: number | null;
  outboxEvent: 'UPSERT' | 'DELETE' | null;
}

export interface ImageRepairSummary {
  scannedProducts: number;
  repairedProducts: number;
  removedImages: number;
  promotedPrimaries: number;
  outboxEvents: number;
  failedProducts: number;
}

@Injectable()
export class ProductImageRepairService {
  private readonly logger = new Logger(ProductImageRepairService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageStorage: ProductImageStorageService,
    private readonly searchOutboxService: SearchOutboxService,
  ) {}

  /**
   * Scans all products with images and repairs orphaned images.
   */
  async repairAll(options?: {
    batchSize?: number;
  }): Promise<ImageRepairSummary> {
    const batchSize = options?.batchSize ?? 50;
    let cursor: number | undefined = undefined;

    const summary: ImageRepairSummary = {
      scannedProducts: 0,
      repairedProducts: 0,
      removedImages: 0,
      promotedPrimaries: 0,
      outboxEvents: 0,
      failedProducts: 0,
    };

    while (true) {
      const products: { id: number }[] = await this.prisma.product.findMany({
        where: {
          ...(cursor ? { id: { gt: cursor } } : {}),
          images: { some: {} },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: batchSize,
      });

      if (products.length === 0) break;

      for (const p of products) {
        summary.scannedProducts++;
        try {
          const result = await this.repairProduct(p.id);
          if (result.removedImages > 0) {
            summary.repairedProducts++;
            summary.removedImages += result.removedImages;
            if (result.promotedPrimary) summary.promotedPrimaries++;
            if (result.outboxEvent) summary.outboxEvents++;
          }
        } catch (err: unknown) {
          summary.failedProducts++;
          this.logger.error(
            `Failed to repair images for product ${p.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      cursor = products[products.length - 1].id;
      if (products.length < batchSize) break;
    }

    this.logger.log(
      `Image repair pass complete: scanned=${summary.scannedProducts} repaired=${summary.repairedProducts} removedImages=${summary.removedImages} promotedPrimaries=${summary.promotedPrimaries} outboxEvents=${summary.outboxEvents} failed=${summary.failedProducts}`,
    );

    return summary;
  }

  /**
   * Repairs orphaned images for a single product.
   * If images are removed, product version is incremented monotonically in an atomic transaction,
   * primary image is promoted if needed, and search outbox event is created if appropriate.
   */
  async repairProduct(productId: number): Promise<ImageRepairResult> {
    return this.imageStorage.withProductImageLock(productId, () =>
      this.repairProductLocked(productId),
    );
  }

  private async repairProductLocked(
    productId: number,
  ): Promise<ImageRepairResult> {
    // Use REPEATABLE READ snapshot to get consistent view of images.
    // isPublished checks happen outside the write transaction (file I/O),
    // but we re-validate inside the write transaction to prevent TOCTOU.
    const images = await this.prisma.productImage.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    if (images.length === 0) {
      return {
        productId,
        scannedImages: 0,
        removedImages: 0,
        promotedPrimary: false,
        newVersion: null,
        outboxEvent: null,
      };
    }

    const orphanedIds: number[] = [];
    for (const img of images) {
      if (!this.imageStorage.isManagedUrl(img.url)) continue;
      const published = await this.imageStorage.isPublished(img.url);
      if (!published) {
        orphanedIds.push(img.id);
      }
    }

    if (orphanedIds.length === 0) {
      return {
        productId,
        scannedImages: images.length,
        removedImages: 0,
        promotedPrimary: false,
        newVersion: null,
        outboxEvent: null,
      };
    }

    // Atomic transaction for removing orphaned images, updating version and search outbox.
    // Re-check which images are actually orphaned inside the transaction to prevent
    // concurrent uploads from being incorrectly deleted.
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // Re-read images inside transaction to detect any concurrent uploads since
            // our outside check. Only delete IDs that were identified AND still match
            // the same URLs we checked.
            const imageUrlsToDelete = new Set(
              images
                .filter((img) => orphanedIds.includes(img.id))
                .map((img) => img.url),
            );

            // Confirm these images still exist with the same URLs (guard against
            // concurrent edits between our external isPublished check and now).
            const toDelete = await tx.productImage.findMany({
              where: {
                id: { in: orphanedIds },
                url: { in: [...imageUrlsToDelete] },
                productId,
              },
              select: { id: true },
            });

            if (toDelete.length === 0) {
              // All candidate orphans were removed or changed by a concurrent operation.
              return {
                productId,
                scannedImages: images.length,
                removedImages: 0,
                promotedPrimary: false,
                newVersion: null,
                outboxEvent: null,
              };
            }

            const confirmedOrphanIds = toDelete.map((r) => r.id);
            await tx.productImage.deleteMany({
              where: { id: { in: confirmedOrphanIds } },
            });

            const remainingImages = await tx.productImage.findMany({
              where: { productId },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            });

            let promotedPrimary = false;
            if (remainingImages.length > 0) {
              const hasPrimary = remainingImages.some((img) => img.isPrimary);
              if (!hasPrimary) {
                const firstImg = remainingImages[0];
                await tx.productImage.update({
                  where: { id: firstImg.id },
                  data: { isPrimary: true },
                });
                promotedPrimary = true;
              }
            }

            const product = await tx.product.findUniqueOrThrow({
              where: { id: productId },
              include: listingInclude,
            });

            const nextVersion = product.version + 1;
            const changed = await tx.product.updateMany({
              where: { id: productId, version: product.version },
              data: {
                version: nextVersion,
                ...(product.moderationStatus ===
                ProductModerationStatus.APPROVED
                  ? {
                      sellerStatus: ProductSellerStatus.DRAFT,
                      moderationStatus: ProductModerationStatus.NOT_SUBMITTED,
                      rejectionReason: null,
                      submittedAt: null,
                      reviewedAt: null,
                      reviewedBy: null,
                    }
                  : {}),
              },
            });
            if (!changed.count)
              throw new Error('IMAGE_REPAIR_VERSION_CONFLICT');

            const categories = await tx.category.findMany({
              select: { id: true, parentId: true, isActive: true },
            });

            const updatedProduct = {
              ...product,
              version: nextVersion,
              ...(product.moderationStatus === ProductModerationStatus.APPROVED
                ? {
                    sellerStatus: ProductSellerStatus.DRAFT,
                    moderationStatus: ProductModerationStatus.NOT_SUBMITTED,
                  }
                : {}),
            };
            const shouldBePublic = isPublicListing(updatedProduct, categories);

            let outboxEvent: 'UPSERT' | 'DELETE' | null = null;
            if (shouldBePublic) {
              await this.searchOutboxService.writeOutboxEvent(
                tx,
                updatedProduct,
                categories,
                nextVersion,
              );
              outboxEvent = 'UPSERT';
            } else {
              const latestOutbox = await tx.searchOutbox.findFirst({
                where: { target: 'SEARCH_SERVICE', productId },
                orderBy: { version: 'desc' },
              });
              if (
                product.moderationStatus === ProductModerationStatus.APPROVED ||
                (latestOutbox && latestOutbox.operation === 'UPSERT')
              ) {
                await this.searchOutboxService.writeDeleteEvent(
                  tx,
                  productId,
                  nextVersion,
                );
                outboxEvent = 'DELETE';
              }
            }

            this.logger.log(
              `Product ${productId} image repair: removed=${confirmedOrphanIds.length} remaining=${remainingImages.length} promotedPrimary=${promotedPrimary} version=${nextVersion} outbox=${outboxEvent}`,
            );

            return {
              productId,
              scannedImages: images.length,
              removedImages: confirmedOrphanIds.length,
              promotedPrimary,
              newVersion: nextVersion,
              outboxEvent,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const optimistic =
          error instanceof Error &&
          error.message === 'IMAGE_REPAIR_VERSION_CONFLICT';
        if (
          (!optimistic && !isTransactionConflict(error)) ||
          attempt === maxAttempts - 1
        )
          throw error;
        await waitForTransactionRetry(attempt);
      }
    }
    throw new Error('Image repair retries exhausted');
  }
}
