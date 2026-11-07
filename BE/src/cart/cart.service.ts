import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { canActAsBuyer } from '../auth/buyer-access.js';
import { PrismaService } from '../prisma.service.js';
import {
  displayVariants,
  isPublicListing,
  listingInclude,
} from '../product/product-public-policy.js';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from '../product/transaction-conflict.js';
import type { CartItemResponseDto, CartResponseDto } from './cart.dto.js';
import { cartError } from './cart-http.js';

@Injectable()
export class CartService {
  private readonly maxQuantity: number;
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.maxQuantity = Number(config.get<string>('CART_MAX_QUANTITY', '99'));
    if (
      !Number.isSafeInteger(this.maxQuantity) ||
      this.maxQuantity < 1 ||
      this.maxQuantity > 99
    )
      throw new Error('CART_MAX_QUANTITY must be an integer from 1 to 99');
  }

  list(userId: number) {
    // All policy and display reads see one snapshot, including category ancestors.
    return this.prisma.$transaction(
      async (tx) => {
        await this.actor(tx, userId);
        return this.read(tx, userId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  put(userId: number, variantId: number, quantity: number) {
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > this.maxQuantity
    )
      throw cartError(
        400,
        'VALIDATION_ERROR',
        'Số lượng giỏ hàng không hợp lệ.',
      );
    return this.write(userId, async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        include: { product: { include: listingInclude } },
      });
      if (variant?.product.store.sellerId === userId)
        throw cartError(
          409,
          'SELF_PURCHASE_FORBIDDEN',
          'Không thể mua sản phẩm của cửa hàng mình.',
        );
      const categories = await tx.category.findMany({
        select: { id: true, parentId: true, isActive: true },
      });
      if (
        !variant ||
        !isPublicListing(variant.product, categories) ||
        !displayVariants(variant.product).some((item) => item.id === variantId)
      )
        throw cartError(
          409,
          'VARIANT_NOT_AVAILABLE',
          'Biến thể hiện không được bán.',
        );
      if (quantity > variant.stock)
        throw cartError(409, 'INSUFFICIENT_STOCK', 'Tồn kho hiện không đủ.');
      const cart = await tx.cart.upsert({
        where: { userId },
        create: { userId },
        update: {},
        select: { id: true },
      });
      const existing = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
      });
      // A replay of absolute quantity does not mutate even updatedAt.
      if (!existing)
        await tx.cartItem.create({
          data: { cartId: cart.id, variantId, quantity },
        });
      else if (existing.quantity !== quantity)
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity },
        });
      return this.read(tx, userId);
    });
  }

  async remove(userId: number, variantId: number): Promise<void> {
    await this.write(userId, async (tx) => {
      // Missing cart/item is already the requested end state; do not create rows.
      await tx.cartItem.deleteMany({ where: { variantId, cart: { userId } } });
    });
  }

  private async actor(tx: Prisma.TransactionClient, userId: number) {
    const actor = await tx.user.findUnique({
      where: { id: userId },
      select: { isActive: true, role: true },
    });
    if (!actor?.isActive)
      throw cartError(401, 'UNAUTHORIZED', 'Vui lòng đăng nhập lại.');
    if (!canActAsBuyer(actor.role))
      throw cartError(
        403,
        'FORBIDDEN',
        'Bạn không có quyền thao tác giỏ hàng.',
      );
  }

  private async write<T>(
    userId: number,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // Database lock, shared across instances; serializes first-cart and writes.
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
            await this.actor(tx, userId);
            return operation(tx);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isTransactionConflict(error)) throw error;
        if (attempt === 4)
          throw cartError(
            409,
            'CART_WRITE_CONFLICT',
            'Giỏ hàng đang được cập nhật. Vui lòng thử lại.',
          );
        await waitForTransactionRetry(attempt);
      }
    }
    throw new Error('Unreachable cart retry');
  }

  private async read(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<CartResponseDto> {
    const cart = await tx.cart.findUnique({
      where: { userId },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: {
            variant: { include: { product: { include: listingInclude } } },
          },
        },
      },
    });
    const result: CartResponseDto = {
      groups: [],
      unavailableItems: [],
      lineCount: cart?.items.length ?? 0,
      totalQuantity: 0,
      purchasableSubtotal: '0.00',
    };
    if (!cart?.items.length) return result;
    const categories = await tx.category.findMany({
      select: { id: true, parentId: true, isActive: true },
    });
    const groups = new Map<
      number,
      {
        store: { id: number; name: string };
        items: CartItemResponseDto[];
        subtotal: Prisma.Decimal;
      }
    >();
    let subtotal = new Prisma.Decimal(0);
    for (const row of cart.items) {
      result.totalQuantity += row.quantity;
      const product = row.variant.product;
      if (
        product.store.sellerId === userId ||
        !isPublicListing(product, categories)
      ) {
        result.unavailableItems.push({
          variantId: row.variantId,
          quantity: row.quantity,
          available: false,
          unavailableReason: 'PRODUCT_UNAVAILABLE',
        });
        continue;
      }
      let group = groups.get(product.storeId);
      if (!group) {
        group = {
          store: { id: product.storeId, name: product.store.name },
          items: [],
          subtotal: new Prisma.Decimal(0),
        };
        groups.set(product.storeId, group);
      }
      const item: CartItemResponseDto = {
        variantId: row.variantId,
        quantity: row.quantity,
        productId: product.id,
        productName: product.name,
        imageUrl: product.images.find((image) => image.isPrimary)!.url,
        available: false,
        unavailableReason: 'VARIANT_UNAVAILABLE',
      };
      const selected = displayVariants(product).find(
        (variant) => variant.id === row.variantId,
      );
      if (selected) {
        item.currentUnitPrice = selected.price.toFixed(2);
        // Decimal arithmetic only; current price, not an order snapshot.
        item.lineTotal = selected.price.mul(row.quantity).toFixed(2);
        item.stock = selected.stock;
        item.optionValues = product.optionGroups.map((optionGroup) => {
          const link = selected.optionValueLinks.find(
            (value) => value.optionGroupId === optionGroup.id,
          )!;
          return optionGroup.values.find(
            (value) => value.id === link.optionValueId,
          )!.value;
        });
        item.unavailableReason =
          selected.stock === 0
            ? 'OUT_OF_STOCK'
            : row.quantity > selected.stock
              ? 'INSUFFICIENT_STOCK'
              : null;
        item.available = item.unavailableReason === null;
        if (item.available) {
          const lineTotal = selected.price.mul(row.quantity);
          group.subtotal = group.subtotal.plus(lineTotal);
          subtotal = subtotal.plus(lineTotal);
        }
      }
      group.items.push(item);
    }
    result.groups = [...groups.values()].map(({ store, items, subtotal }) => ({
      store,
      items,
      purchasableSubtotal: subtotal.toFixed(2),
    }));
    result.purchasableSubtotal = subtotal.toFixed(2);
    return result;
  }
}
