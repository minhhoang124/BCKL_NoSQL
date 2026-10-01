import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isPublicListing,
  publicProduct,
  type ListingProduct,
} from '../product/product-public-policy.js';
import { PrismaService } from '../prisma.service.js';

type CategoryNode = { id: number; parentId: number | null; isActive: boolean };

/**
 * Builds the UPSERT payload for the Search Service from a product that has
 * already passed isPublicListing. Payload fields follow the AI service
 * contract agreed by Hoang and Dat in docs/api/ai-service-contract.md.
 */
export function buildUpsertPayload(
  product: ListingProduct,
  categories: CategoryNode[],
): Prisma.InputJsonValue {
  const pub = publicProduct(product);
  const categoryPathIds: number[] = [];
  const nodes = new Map(categories.map((node) => [node.id, node]));
  let cursor: number | null = product.categoryId;
  while (cursor !== null) {
    if (categoryPathIds.includes(cursor)) throw new Error('Category cycle');
    const node = nodes.get(cursor);
    if (!node) throw new Error('Incomplete category path');
    categoryPathIds.unshift(cursor);
    cursor = node.parentId;
  }
  const attributes: Record<string, string[]> = {};
  for (const attribute of pub.attributes) {
    if (attribute.value !== null && attribute.value !== undefined)
      (attributes[attribute.name] ??= []).push(String(attribute.value));
  }
  const imageUrls = pub.images
    .filter((img) => img.isPrimary)
    .map((img) => img.url)
    .concat(pub.images.filter((img) => !img.isPrimary).map((img) => img.url))
    .slice(0, 10);
  return {
    productId: product.id,
    version: product.version,
    name: pub.name,
    description: pub.description ?? '',
    categoryId: pub.category.id,
    categoryName: pub.category.name,
    categoryPathIds,
    brandId: pub.brand?.id ?? null,
    brandName: pub.brand?.name ?? null,
    attributes,
    imageUrls,
    minPrice: pub.minPrice,
    maxPrice: pub.maxPrice,
    inStock: pub.inStock,
  };
}

/**
 * SearchOutboxService
 *
 * Called within an existing Serializable transaction to write a
 * SearchOutbox record atomically with the Product change. The caller is
 * responsible for providing the transaction client.
 *
 * Rules (per contract and Dat's feedback):
 * - UPSERT when product becomes or remains publicly listed.
 * - DELETE when product is hidden, frozen, rejected, or reverts to draft.
 * - Each (target, productId, version) is immutable. Repeated writes leave
 *   the original payload and delivery/fencing state untouched.
 * - This service never starts its own transaction; only does DB work via
 *   the tx client passed by the caller.
 */
@Injectable()
export class SearchOutboxService {
  private readonly logger = new Logger(SearchOutboxService.name);

  // Inject PrismaService to satisfy NestJS DI. The injected prisma is not
  // used in writeOutboxEvent; callers must pass their tx client.
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write an immutable SearchOutbox event for a product whose state has
   * just changed. Must be called inside the same Serializable transaction
   * that updated the Product row.
   *
   * IMPORTANT: The caller must pass the product with its NEW state (post-update)
   * and the full category tree. This avoids extra reads inside the already-
   * expensive Serializable transaction.
   *
   * @param tx          The Prisma transaction client to use.
   * @param product     The product in its NEW state (after status update).
   * @param categories  All category nodes (for ancestor/leaf validation).
   * @param version     The NEW version number (product.version after increment).
   */
  async writeOutboxEvent(
    tx: Prisma.TransactionClient,
    product: ListingProduct,
    categories: CategoryNode[],
    version: number,
  ): Promise<void> {
    const shouldBePublic = isPublicListing(product, categories);
    const productId = product.id;

    if (shouldBePublic) {
      const payload = buildUpsertPayload(product, categories);
      await tx.searchOutbox.upsert({
        where: {
          target_productId_version: {
            target: 'SEARCH_SERVICE',
            productId,
            version,
          },
        },
        create: {
          target: 'SEARCH_SERVICE',
          operation: 'UPSERT',
          productId,
          version,
          payload,
          status: 'PENDING',
          nextAttemptAt: new Date(),
        },
        update: {},
      });
    } else {
      // Product must be removed from the search index.
      await this.writeDeleteEvent(tx, productId, version);
    }

    this.logger.debug(
      `Outbox event written: product=${productId} version=${version} public=${shouldBePublic}`,
    );
  }

  /**
   * Writes an immutable DELETE event into SearchOutbox.
   *
   * Must be called inside the caller's transaction client (tx).
   * Used when an APPROVED product is unpublished, rejected, frozen,
   * or mutated back to DRAFT.
   *
   * Rules:
   * - Only uses the provided transaction client (tx).
   * - Creates an immutable DELETE event under target_productId_version.
   * - If event already exists, update: {} preserves original delivery state.
   * - Never opens its own transaction or calls HTTP.
   */
  async writeDeleteEvent(
    tx: Prisma.TransactionClient,
    productId: number,
    version: number,
  ): Promise<void> {
    await tx.searchOutbox.upsert({
      where: {
        target_productId_version: {
          target: 'SEARCH_SERVICE',
          productId,
          version,
        },
      },
      create: {
        target: 'SEARCH_SERVICE',
        operation: 'DELETE',
        productId,
        version,
        payload: { productId, version },
        status: 'PENDING',
        nextAttemptAt: new Date(),
      },
      update: {},
    });
    this.logger.debug(
      `DELETE outbox event written: product=${productId} version=${version}`,
    );
  }
}
