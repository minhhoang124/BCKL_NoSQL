import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canActAsBuyer } from '../auth/buyer-access.js';
import { PrismaService } from '../prisma.service.js';
import {
  displayVariants,
  isPublicListing,
  listingInclude,
} from '../product/product-public-policy.js';
import { checkoutError } from './checkout-error.js';
import { checkedLineTotal, checkedSubtotal } from './checkout-money.js';
import {
  normalizeCheckoutRequest,
  validateCheckoutKey,
} from './checkout-request.js';
import { resolveCheckoutReplay } from './checkout-replay.js';

type LineError = 'INSUFFICIENT_STOCK' | 'PRICE_CHANGED';
export interface CheckoutPreview {
  canCheckout: boolean;
  paymentProvider: 'COD';
  currency: 'VND';
  shippingMode: 'DEMO_ZERO_V1';
  groups: {
    store: { id: number; name: string };
    items: {
      variantId: number;
      quantity: number;
      expectedUnitPrice: string;
      unitPrice: string;
      lineTotal: string;
      errors: LineError[];
    }[];
    subtotal: string | null;
    shippingFee: string | null;
    discountTotal: string | null;
    total: string | null;
  }[];
  unavailableItems: {
    variantId: number;
    quantity: number;
    errors: ['VARIANT_NOT_AVAILABLE'];
  }[];
  totals: {
    subtotal: string;
    shippingFee: '0.00';
    discountTotal: '0.00';
    total: string;
  } | null;
}

@Injectable()
export class CheckoutReadService {
  private readonly logger = new Logger(CheckoutReadService.name);
  constructor(private readonly prisma: PrismaService) {}

  preview(buyerId: number, input: unknown): Promise<CheckoutPreview> {
    const request = normalizeCheckoutRequest(input);
    return this.snapshot(buyerId, async (tx) => {
      const address = await tx.userAddress.findFirst({
        where: { id: request.addressId, userId: buyerId },
        select: { id: true },
      });
      if (!address)
        throw checkoutError(
          404,
          'ADDRESS_NOT_FOUND',
          'Không tìm thấy địa chỉ.',
        );
      // Filter by the actor before loading any cart data; never inspect another cart.
      const cart = await tx.cart.findUnique({
        where: { userId: buyerId },
        select: {
          items: {
            where: {
              variantId: { in: request.items.map((item) => item.variantId) },
            },
            include: {
              variant: { include: { product: { include: listingInclude } } },
            },
          },
        },
      });
      const rows = new Map(cart?.items.map((row) => [row.variantId, row]));
      // Validate the entire selected subset before assembling public display fields.
      for (const item of request.items) {
        const row = rows.get(item.variantId);
        if (!row)
          throw checkoutError(
            404,
            'CART_ITEM_NOT_FOUND',
            'Không tìm thấy sản phẩm trong giỏ của bạn.',
          );
        if (row.quantity !== item.quantity)
          throw checkoutError(
            409,
            'CART_CHANGED',
            'Giỏ hàng đã thay đổi. Vui lòng tải lại.',
          );
        if (row.variant.product.store.sellerId === buyerId)
          throw checkoutError(
            409,
            'SELF_PURCHASE_FORBIDDEN',
            'Không thể mua sản phẩm của cửa hàng mình.',
          );
      }
      const categories = await tx.category.findMany({
        select: { id: true, parentId: true, isActive: true },
      });
      const result: CheckoutPreview = {
        canCheckout: true,
        paymentProvider: 'COD',
        currency: 'VND',
        shippingMode: 'DEMO_ZERO_V1',
        groups: [],
        unavailableItems: [],
        totals: null,
      };
      const groups = new Map<number, CheckoutPreview['groups'][number]>();
      for (const item of request.items) {
        const product = rows.get(item.variantId)!.variant.product;
        const selected = displayVariants(product).find(
          (variant) => variant.id === item.variantId,
        );
        if (!isPublicListing(product, categories) || !selected) {
          result.canCheckout = false;
          result.unavailableItems.push({
            variantId: item.variantId,
            quantity: item.quantity,
            errors: ['VARIANT_NOT_AVAILABLE'],
          });
          continue;
        }
        let group = groups.get(product.storeId);
        if (!group) {
          group = {
            store: { id: product.storeId, name: product.store.name },
            items: [],
            subtotal: null,
            shippingFee: null,
            discountTotal: null,
            total: null,
          };
          groups.set(product.storeId, group);
        }
        const errors: LineError[] =
          item.quantity > selected.stock
            ? ['INSUFFICIENT_STOCK']
            : !selected.price.eq(item.expectedUnitPrice)
              ? ['PRICE_CHANGED']
              : [];
        if (errors.length) result.canCheckout = false;
        group.items.push({
          ...item,
          unitPrice: selected.price.toFixed(2),
          lineTotal: checkedLineTotal(selected.price, item.quantity).toFixed(2),
          errors,
        });
      }
      result.groups = [...groups.values()].sort(
        (a, b) => a.store.id - b.store.id,
      );
      // Check overflow even for a preview with unavailable/price/stock errors.
      const allAmounts: Prisma.Decimal[] = [];
      for (const group of result.groups) {
        const amounts = group.items.map(
          (item) => new Prisma.Decimal(item.lineTotal),
        );
        const subtotal = checkedSubtotal(amounts).toFixed(2);
        allAmounts.push(...amounts);
        if (!group.items.some((item) => item.errors.length)) {
          group.subtotal = group.total = subtotal;
          group.shippingFee = group.discountTotal = '0.00';
        }
      }
      const subtotal = checkedSubtotal(allAmounts).toFixed(2);
      if (result.canCheckout)
        result.totals = {
          subtotal,
          shippingFee: '0.00',
          discountTotal: '0.00',
          total: subtotal,
        };
      return result;
    });
  }

  lookup(buyerId: number, keyInput: unknown) {
    const key = validateCheckoutKey(keyInput);
    return this.snapshot(buyerId, async (tx) => {
      const stored = await tx.checkout.findUnique({
        where: { buyerId_idempotencyKey: { buyerId, idempotencyKey: key } },
        select: {
          id: true,
          buyerId: true,
          requestHash: true,
          hashVersion: true,
          receiptVersion: true,
          receiptJson: true,
          status: true,
          completedAt: true,
        },
      });
      try {
        const result = resolveCheckoutReplay(stored, buyerId);
        if (!result)
          throw checkoutError(
            404,
            'CHECKOUT_NOT_FOUND',
            'Không tìm thấy lần đặt hàng.',
          );
        return result;
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() >= 500)
          this.logger.error(
            `Stored checkout receipt invalid: checkoutId=${stored?.id}`,
          );
        throw error;
      }
    });
  }

  private snapshot<T>(
    buyerId: number,
    read: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        // DB-enforced read-only snapshot: these endpoints cannot reserve stock or
        // accidentally write Cart/Checkout/Order/version/outbox.
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
        await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
        const actor = await tx.user.findUnique({
          where: { id: buyerId },
          select: { isActive: true, role: true },
        });
        if (!actor?.isActive)
          throw checkoutError(401, 'UNAUTHORIZED', 'Vui lòng đăng nhập lại.');
        if (!canActAsBuyer(actor.role))
          throw checkoutError(
            403,
            'FORBIDDEN',
            'Bạn không có quyền thực hiện thao tác này.',
          );
        return read(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 2000,
        timeout: 5000,
      },
    );
  }
}
