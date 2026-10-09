import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
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
import { SearchOutboxService } from '../search/search-outbox.service.js';
import {
  CheckoutCreateRate,
  checkoutConfigInt,
} from './checkout-create-rate.js';
import { checkoutError } from './checkout-error.js';
import { checkedLineTotal, checkedSubtotal } from './checkout-money.js';
import {
  buildCheckoutRequestV1,
  validateCheckoutKey,
  type CheckoutRequestInput,
} from './checkout-request.js';
import { resolveCheckoutReplay } from './checkout-replay.js';
import {
  validateCheckoutReceiptV1,
  type CheckoutReceiptV1,
} from './checkout-receipt.js';

@Injectable()
export class CheckoutCreateService {
  private readonly logger = new Logger(CheckoutCreateService.name);
  private readonly statementMs: number;
  private readonly lockMs: number;
  private readonly transactionMs: number;
  private readonly waitMs: number;
  private readonly deadlineMs: number;
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: SearchOutboxService,
    private readonly rate: CheckoutCreateRate,
    config: ConfigService,
  ) {
    this.statementMs = checkoutConfigInt(
      config,
      'CHECKOUT_STATEMENT_TIMEOUT_MS',
      2000,
    );
    this.lockMs = checkoutConfigInt(config, 'CHECKOUT_LOCK_TIMEOUT_MS', 1000);
    this.transactionMs = checkoutConfigInt(
      config,
      'CHECKOUT_TRANSACTION_TIMEOUT_MS',
      5000,
    );
    this.waitMs = checkoutConfigInt(config, 'CHECKOUT_MAX_WAIT_MS', 2000);
    this.deadlineMs = checkoutConfigInt(config, 'CHECKOUT_DEADLINE_MS', 22000);
    if (this.lockMs > this.statementMs || this.statementMs > this.transactionMs)
      throw new Error(
        'Checkout requires lock <= statement <= transaction timeout',
      );
  }

  async create(buyerId: number, keyInput: unknown, input: unknown) {
    const key = validateCheckoutKey(keyInput);
    const { canonicalRequest, requestHash } = buildCheckoutRequestV1(
      buyerId,
      input,
    );
    const deadline = Date.now() + this.deadlineMs;
    // Deliberately survives rollback/retry: a failed purchase intent still uses
    // one quota slot, while an internal transaction retry does not use another.
    let countedIntent = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= this.waitMs) break;
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(this.statementMs)}, true)`;
            await tx.$queryRaw`SELECT set_config('lock_timeout', ${String(this.lockMs)}, true)`;
            // Same database lock as Cart and Address; works across app instances.
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${buyerId} FOR UPDATE`;
            const actor = await tx.user.findUnique({
              where: { id: buyerId },
              select: { isActive: true, role: true },
            });
            if (!actor?.isActive)
              throw checkoutError(
                401,
                'UNAUTHORIZED',
                'Vui lòng đăng nhập lại.',
              );
            if (actor.role !== Role.USER)
              throw checkoutError(
                403,
                'FORBIDDEN',
                'Bạn không có quyền thực hiện thao tác này.',
              );
            const stored = await tx.checkout.findUnique({
              where: {
                buyerId_idempotencyKey: { buyerId, idempotencyKey: key },
              },
            });
            const replay = resolveCheckoutReplay(stored, buyerId, requestHash);
            if (replay) return replay;
            if (!countedIntent) {
              this.rate.consume(buyerId, 'intent');
              countedIntent = true;
            }
            return this.purchase(
              tx,
              buyerId,
              key,
              requestHash,
              canonicalRequest,
            );
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: this.waitMs,
            timeout: Math.min(this.transactionMs, remaining - this.waitMs),
          },
        );
        this.logger.log(
          `Checkout committed: buyerId=${buyerId} checkoutId=${result.checkoutId} replayed=${result.replayed}`,
        );
        return result;
      } catch (error) {
        // Raw SELECT ... FOR UPDATE can expose SQLSTATE through P2010 rather
        // than P2034. Only these two database conflicts are safe to retry.
        if (isTransactionConflict(error) || this.isRawConflict(error)) {
          this.logger.warn(
            `Checkout transaction conflict: buyerId=${buyerId} attempt=${attempt + 1}`,
          );
          if (attempt < 2) {
            await waitForTransactionRetry(attempt);
            continue;
          }
          break;
        }
        // Lock/statement/interactive-transaction timeout is not blindly retried.
        if (this.isTimeout(error))
          throw checkoutError(
            409,
            'CHECKOUT_IN_PROGRESS',
            'Chưa xác định kết quả. Giữ nguyên mã yêu cầu và kiểm tra lại.',
          );
        throw error;
      }
    }
    throw checkoutError(
      409,
      'STOCK_CONFLICT',
      'Dữ liệu đang được cập nhật. Vui lòng thử lại với cùng mã yêu cầu.',
    );
  }

  private isTimeout(error: unknown) {
    if (!(error instanceof Error)) return false;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2028'
    )
      return true;
    if (['55P03', '57014'].includes(this.rawSqlState(error))) return true;
    const meta = 'meta' in error ? error.meta : undefined;
    const cause = error.cause;
    return [meta, cause].some(
      (value) =>
        value &&
        typeof value === 'object' &&
        (('code' in value && ['55P03', '57014'].includes(String(value.code))) ||
          ('originalCode' in value &&
            ['55P03', '57014'].includes(String(value.originalCode)))),
    );
  }

  private isRawConflict(error: unknown) {
    return ['40001', '40P01'].includes(this.rawSqlState(error));
  }

  private rawSqlState(error: unknown): string {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2010'
    )
      return '';
    const adapter = error.meta?.driverAdapterError;
    const cause =
      adapter && typeof adapter === 'object' && 'cause' in adapter
        ? adapter.cause
        : null;
    return String(
      error.meta?.code ??
        (cause && typeof cause === 'object' && 'originalCode' in cause
          ? cause.originalCode
          : ''),
    );
  }

  private async purchase(
    tx: Prisma.TransactionClient,
    buyerId: number,
    key: string,
    requestHash: string,
    request: CheckoutRequestInput,
  ) {
    const address = await tx.userAddress.findFirst({
      where: { id: request.addressId, userId: buyerId },
    });
    if (!address)
      throw checkoutError(404, 'ADDRESS_NOT_FOUND', 'Không tìm thấy địa chỉ.');
    const variantIds = request.items.map((item) => item.variantId);
    const refs = await tx.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { productId: true },
    });
    const productIds = [...new Set(refs.map((v) => v.productId))].sort(
      (a, b) => a - b,
    );
    // Product locks precede Variant locks (also used by Seller mutations).
    if (productIds.length)
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM products WHERE id IN (${Prisma.join(productIds)}) ORDER BY id FOR UPDATE`,
      );
    const cart = await tx.cart.findUnique({
      where: { userId: buyerId },
      include: {
        items: {
          where: { variantId: { in: variantIds } },
          include: {
            variant: { include: { product: { include: listingInclude } } },
          },
        },
      },
    });
    const rows = new Map(cart?.items.map((row) => [row.variantId, row]));
    // Check all cart membership/ownership before public errors, as preview does.
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
    const lines = request.items.map((item) => {
      const row = rows.get(item.variantId)!;
      const product = row.variant.product;
      const variant = displayVariants(product).find(
        (v) => v.id === item.variantId,
      );
      if (!isPublicListing(product, categories) || !variant)
        throw checkoutError(
          409,
          'VARIANT_NOT_AVAILABLE',
          'Sản phẩm hiện không được bán.',
          { variantId: item.variantId },
        );
      if (variant.stock < item.quantity)
        throw checkoutError(
          409,
          'INSUFFICIENT_STOCK',
          'Tồn kho hiện không đủ.',
          { variantId: item.variantId },
        );
      if (!variant.price.eq(item.expectedUnitPrice))
        throw checkoutError(
          409,
          'PRICE_CHANGED',
          'Giá sản phẩm đã thay đổi. Vui lòng xác nhận lại.',
          {
            variantId: item.variantId,
            expectedUnitPrice: item.expectedUnitPrice,
            currentUnitPrice: variant.price.toFixed(2),
          },
        );
      return {
        item,
        row,
        product,
        variant,
        lineTotal: checkedLineTotal(variant.price, item.quantity),
      };
    });
    checkedSubtotal(lines.map((line) => line.lineTotal));
    const stores = [...new Set(lines.map((line) => line.product.storeId))].sort(
      (a, b) => a - b,
    );
    const groups = stores.map((storeId) => {
      const items = lines.filter((line) => line.product.storeId === storeId);
      return {
        storeId,
        items,
        subtotal: checkedSubtotal(items.map((line) => line.lineTotal)),
      };
    });
    const checkout = await tx.checkout.create({
      data: { buyerId, idempotencyKey: key, requestHash, hashVersion: 1 },
    });
    const balances = new Map<number, number>();
    for (const { item } of lines) {
      const updated = await tx.productVariant.updateMany({
        where: { id: item.variantId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (updated.count !== 1)
        throw checkoutError(
          409,
          'INSUFFICIENT_STOCK',
          'Tồn kho hiện không đủ.',
          { variantId: item.variantId },
        );
      balances.set(
        item.variantId,
        (
          await tx.productVariant.findUniqueOrThrow({
            where: { id: item.variantId },
            select: { stock: true },
          })
        ).stock,
      );
    }
    const receipt: CheckoutReceiptV1 = {
      checkoutId: checkout.id,
      status: 'COMPLETED',
      orders: [],
    };
    for (const group of groups) {
      const order = await tx.order.create({
        data: {
          orderNumber: `ORD-${randomUUID()}`,
          checkoutId: checkout.id,
          buyerId,
          storeId: group.storeId,
          recipientNameSnapshot: address.recipientName,
          phoneSnapshot: address.phone,
          provinceSnapshot: address.province,
          districtSnapshot: address.district,
          wardSnapshot: address.ward,
          addressLineSnapshot: address.addressLine,
          postalCodeSnapshot: address.postalCode,
          deliveryNoteSnapshot: address.deliveryNote,
          subtotal: group.subtotal,
          shippingFee: 0,
          discountTotal: 0,
          total: group.subtotal,
        },
      });
      for (const { item, product, variant, lineTotal } of group.items) {
        const orderItem = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: product.id,
            variantId: variant.id,
            storeId: group.storeId,
            productNameSnapshot: product.name,
            skuSnapshot: variant.skuCode,
            optionSnapshot: variant.optionValueLinks
              .map((link) => {
                const optionGroup = product.optionGroups.find(
                  (g) => g.id === link.optionGroupId,
                )!;
                const value = optionGroup.values.find(
                  (v) => v.id === link.optionValueId,
                )!;
                return {
                  groupId: optionGroup.id,
                  groupName: optionGroup.name,
                  valueId: value.id,
                  value: value.value,
                };
              })
              .sort((a, b) => a.groupId - b.groupId),
            unitPrice: variant.price,
            quantity: item.quantity,
            lineTotal,
          },
        });
        await tx.stockMovement.create({
          data: {
            variantId: variant.id,
            orderItemId: orderItem.id,
            type: 'CHECKOUT_DECREMENT',
            quantityDelta: -item.quantity,
            balanceAfter: balances.get(variant.id)!,
            idempotencyKey: `checkout:${checkout.id}:item:${orderItem.id}:decrement`,
          },
        });
      }
      await tx.payment.create({
        data: {
          orderId: order.id,
          provider: 'COD',
          status: 'UNPAID',
          amount: group.subtotal,
        },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: 'PENDING_CONFIRMATION',
          actorId: buyerId,
        },
      });
      receipt.orders.push({
        id: order.id,
        orderNumber: order.orderNumber,
        storeId: group.storeId,
        status: 'PENDING_CONFIRMATION',
        total: group.subtotal.toFixed(2),
        payment: {
          provider: 'COD',
          status: 'UNPAID',
          amount: group.subtotal.toFixed(2),
          currency: 'VND',
        },
      });
    }
    for (const id of productIds) {
      const product = await tx.product.update({
        where: { id },
        data: { version: { increment: 1 } },
        include: listingInclude,
      });
      await this.outbox.writeOutboxEvent(
        tx,
        product,
        categories,
        product.version,
      );
    }
    const removed = await tx.cartItem.deleteMany({
      where: { cartId: cart!.id, variantId: { in: variantIds } },
    });
    if (removed.count !== lines.length)
      throw checkoutError(
        409,
        'CART_CHANGED',
        'Giỏ hàng đã thay đổi. Vui lòng tải lại.',
      );
    const validReceipt = validateCheckoutReceiptV1(receipt, checkout.id);
    await tx.checkout.update({
      where: { id: checkout.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        receiptVersion: 1,
        receiptJson: validReceipt as unknown as Prisma.InputJsonValue,
      },
    });
    return { ...validReceipt, replayed: false as const };
  }
}
