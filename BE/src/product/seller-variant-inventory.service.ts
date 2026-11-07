import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProductModerationStatus,
  Prisma,
  Role,
  StockMovementType,
  StoreStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma.service.js';
import {
  MAX_PG_INT,
  MAX_UPDATABLE_PRODUCT_VERSION,
  MAX_VARIANT_EDIT_REASON_LENGTH,
  POSITIVE_VND_PRICE_REGEX,
  UpdateProductVariantDto,
} from './dto/update-product-variant.dto.js';
import { listingInclude } from './product-public-policy.js';
import { SearchOutboxService } from '../search/search-outbox.service.js';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from './transaction-conflict.js';

const DEFAULT_LOCK_TIMEOUT_MS = 1_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 2_000;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_WAIT_MS = 2_000;
const DEFAULT_DEADLINE_MS = 22_000;
const MAX_SERIALIZABLE_RETRIES = 3;

const ALLOWED_DTO_KEYS = new Set([
  'expectedProductVersion',
  'expectedPrice',
  'expectedStock',
  'price',
  'stock',
  'reason',
]);

type LockedUserRow = {
  id: number;
  role: string;
  isActive: boolean;
  credentialVersion: number;
};

type LockedStoreRow = {
  id: number;
  status: string;
};

type LockedProductRow = {
  id: number;
  storeId: number;
  version: number;
  moderationStatus: string;
  sellerStatus: string;
};

type LockedVariantRow = {
  id: number;
  productId: number;
  price: Prisma.Decimal | string | number;
  stock: number;
};

export interface UpdatedProductVariantProjection {
  productId: number;
  variantId: number;
  version: number;
  price: string;
  stock: number;
}

interface ValidatedVariantEditInput {
  expectedProductVersion: number;
  expectedPrice: Prisma.Decimal;
  expectedStock: number;
  price: Prisma.Decimal;
  stock: number;
  reason: string;
}

@Injectable()
export class SellerVariantInventoryService {
  private readonly lockTimeoutMs: number;
  private readonly statementTimeoutMs: number;
  private readonly transactionTimeoutMs: number;
  private readonly maxWaitMs: number;
  private readonly deadlineMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly searchOutbox: SearchOutboxService,
    @Optional() private readonly config?: ConfigService,
  ) {
    this.lockTimeoutMs = this.readTimeoutConfig(
      'CHECKOUT_LOCK_TIMEOUT_MS',
      DEFAULT_LOCK_TIMEOUT_MS,
      100,
      10_000,
    );
    this.statementTimeoutMs = this.readTimeoutConfig(
      'CHECKOUT_STATEMENT_TIMEOUT_MS',
      DEFAULT_STATEMENT_TIMEOUT_MS,
      200,
      15_000,
    );
    this.transactionTimeoutMs = this.readTimeoutConfig(
      'CHECKOUT_TRANSACTION_TIMEOUT_MS',
      DEFAULT_TRANSACTION_TIMEOUT_MS,
      500,
      30_000,
    );
    this.maxWaitMs = this.readTimeoutConfig(
      'CHECKOUT_MAX_WAIT_MS',
      DEFAULT_MAX_WAIT_MS,
      100,
      10_000,
    );
    this.deadlineMs = this.readTimeoutConfig(
      'CHECKOUT_DEADLINE_MS',
      DEFAULT_DEADLINE_MS,
      1_000,
      60_000,
    );
  }

  async edit(
    actor: AuthenticatedUser,
    productId: number,
    variantId: number,
    dto: UpdateProductVariantDto,
  ): Promise<UpdatedProductVariantProjection> {
    this.validateActorClaims(actor);
    this.validatePositiveId(productId, 'productId');
    this.validatePositiveId(variantId, 'variantId');
    const input = this.validateAndNormalizeDto(dto);

    const startedAt = Date.now();
    for (let attempt = 0; attempt < MAX_SERIALIZABLE_RETRIES; attempt += 1) {
      const remaining = this.deadlineMs - (Date.now() - startedAt);
      if (remaining <= this.maxWaitMs) {
        throw this.safeConflict(
          'PRODUCT_VARIANT_CONFLICT',
          'Không thể cập nhật phân loại do xung đột giao dịch tạm thời, vui lòng tải lại và thử lại',
        );
      }

      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(
              `SET LOCAL lock_timeout = '${Math.min(this.lockTimeoutMs, remaining - this.maxWaitMs)}ms'`,
            );
            await tx.$executeRawUnsafe(
              `SET LOCAL statement_timeout = '${Math.min(this.statementTimeoutMs, remaining - this.maxWaitMs)}ms'`,
            );

            const userRows = await tx.$queryRaw<LockedUserRow[]>`
              SELECT id, role::text AS role, "isActive", "credentialVersion"
              FROM users WHERE id=${actor.userId} FOR SHARE
            `;
            const liveUser = userRows[0];
            if (
              !liveUser?.isActive ||
              liveUser.credentialVersion !== (actor.credentialVersion ?? 0)
            ) {
              throw new UnauthorizedException(
                'Phiên đăng nhập đã hết hiệu lực, vui lòng đăng nhập lại',
              );
            }
            if (liveUser.role !== Role.SELLER) {
              throw new ForbiddenException(
                'Chỉ tài khoản người bán mới được phép chỉnh sửa tồn kho và giá phân loại',
              );
            }

            // 2. Lock Seller Store FOR SHARE and verify ACTIVE status
            const storeRows = await tx.$queryRaw<LockedStoreRow[]>`
              SELECT "id", "status"::text AS "status"
              FROM "stores"
              WHERE "sellerId" = ${actor.userId}
              FOR SHARE
            `;
            const store = storeRows[0];
            if (!store) {
              throw new ForbiddenException('Người bán chưa khởi tạo cửa hàng');
            }
            if (store.status !== StoreStatus.ACTIVE) {
              throw new ForbiddenException(
                'Cửa hàng hiện không ở trạng thái hoạt động',
              );
            }

            // 3. Lock Product FOR UPDATE before Variant to match Checkout lock order
            const productRows = await tx.$queryRaw<LockedProductRow[]>`
              SELECT
                "id",
                "storeId" AS "storeId",
                "version",
                "moderationStatus"::text AS "moderationStatus",
                "sellerStatus"::text AS "sellerStatus"
              FROM "products"
              WHERE "id" = ${productId}
              FOR UPDATE
            `;
            const product = productRows[0];
            if (!product || product.storeId !== store.id) {
              throw new NotFoundException('Không tìm thấy sản phẩm');
            }
            if (
              product.moderationStatus === ProductModerationStatus.PENDING ||
              product.moderationStatus === ProductModerationStatus.FROZEN
            ) {
              throw new ConflictException({
                code: 'PRODUCT_MODERATION_LOCKED',
                message:
                  'Không thể chỉnh sửa giá hoặc tồn kho khi sản phẩm đang chờ duyệt hoặc bị đóng băng',
              });
            }

            // 4. Lock target Variant FOR UPDATE after Product
            const variantRows = await tx.$queryRaw<LockedVariantRow[]>`
              SELECT "id", "productId" AS "productId", "price", "stock"
              FROM "product_variants"
              WHERE "id" = ${variantId} AND "productId" = ${productId}
              FOR UPDATE
            `;
            const variant = variantRows[0];
            if (!variant || variant.productId !== productId) {
              throw new NotFoundException('Không tìm thấy phân loại sản phẩm');
            }

            const currentPrice = new Prisma.Decimal(String(variant.price));
            if (
              product.version !== input.expectedProductVersion ||
              !currentPrice.equals(input.expectedPrice) ||
              variant.stock !== input.expectedStock
            ) {
              throw this.safeConflict(
                'PRODUCT_VARIANT_CHANGED',
                'Dữ liệu sản phẩm hoặc phân loại đã thay đổi, vui lòng tải lại trước khi lưu',
              );
            }

            // 5. Conditional CAS update on target ProductVariant ONLY (price + stock)
            const updatedVariantCount = await tx.productVariant.updateMany({
              where: {
                id: variantId,
                productId,
                product: {
                  storeId: store.id,
                  version: input.expectedProductVersion,
                },
                price: input.expectedPrice,
                stock: input.expectedStock,
              },
              data: {
                price: input.price,
                stock: input.stock,
              },
            });
            if (updatedVariantCount.count !== 1) {
              throw this.safeConflict(
                'PRODUCT_VARIANT_CHANGED',
                'Dữ liệu sản phẩm hoặc phân loại đã thay đổi, vui lòng tải lại trước khi lưu',
              );
            }

            // 6. Conditional CAS increment on Product.version WITHOUT resetting moderationStatus or sellerStatus (Owner D13)
            const updatedProductCount = await tx.product.updateMany({
              where: {
                id: productId,
                storeId: store.id,
                version: input.expectedProductVersion,
                moderationStatus: {
                  notIn: [
                    ProductModerationStatus.PENDING,
                    ProductModerationStatus.FROZEN,
                  ],
                },
              },
              data: {
                version: { increment: 1 },
              },
            });
            if (updatedProductCount.count !== 1) {
              throw this.safeConflict(
                'PRODUCT_VARIANT_CHANGED',
                'Phiên bản sản phẩm đã thay đổi, vui lòng tải lại trước khi lưu',
              );
            }

            const newVersion = input.expectedProductVersion + 1;
            const stockDelta = input.stock - input.expectedStock;

            // 7. Record StockMovement only when stock actually changes
            if (stockDelta !== 0) {
              await tx.stockMovement.create({
                data: {
                  variantId,
                  orderItemId: null,
                  type: StockMovementType.MANUAL_ADJUSTMENT,
                  quantityDelta: stockDelta,
                  balanceAfter: input.stock,
                  idempotencyKey: `SKU_EDIT:${productId}:${input.expectedProductVersion}:${variantId}`,
                  reason: input.reason,
                },
              });
            }

            // 8. Load updated full product and categories inside the same transaction and emit SearchOutbox event
            const fullProduct = await tx.product.findUnique({
              where: { id: productId },
              include: listingInclude,
            });
            if (!fullProduct || fullProduct.storeId !== store.id) {
              throw new NotFoundException(
                'Không tìm thấy sản phẩm sau khi cập nhật',
              );
            }

            const categories = await tx.category.findMany({
              select: {
                id: true,
                parentId: true,
                isActive: true,
              },
            });

            await this.searchOutbox.writeOutboxEvent(
              tx,
              fullProduct,
              categories,
              newVersion,
            );

            return {
              productId,
              variantId,
              version: newVersion,
              price: input.price.toFixed(2),
              stock: input.stock,
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: this.maxWaitMs,
            timeout: Math.min(
              this.transactionTimeoutMs,
              remaining - this.maxWaitMs,
            ),
          },
        );
      } catch (error) {
        if (this.isDeterministicAdjustmentIdempotencyCollision(error)) {
          throw this.safeConflict(
            'PRODUCT_VARIANT_CHANGED',
            'Dữ liệu sản phẩm hoặc phân loại đã thay đổi, vui lòng tải lại trước khi lưu',
          );
        }

        if (
          isTransactionConflict(error) ||
          ['40001', '40P01'].includes(this.sqlState(error)) ||
          this.isLockOrStatementTimeout(error)
        ) {
          const hasNextAttempt = attempt + 1 < MAX_SERIALIZABLE_RETRIES;
          if (hasNextAttempt && Date.now() - startedAt < this.deadlineMs) {
            await waitForTransactionRetry(attempt);
            continue;
          }
          throw this.safeConflict(
            'PRODUCT_VARIANT_CONFLICT',
            'Không thể cập nhật phân loại do xung đột giao dịch tạm thời, vui lòng tải lại và thử lại',
          );
        }

        throw error;
      }
    }

    throw this.safeConflict(
      'PRODUCT_VARIANT_CONFLICT',
      'Không thể cập nhật phân loại do xung đột giao dịch tạm thời, vui lòng tải lại và thử lại',
    );
  }

  private validateActorClaims(actor: AuthenticatedUser): void {
    if (
      !actor ||
      typeof actor !== 'object' ||
      !Number.isInteger(actor.userId) ||
      actor.userId < 1 ||
      actor.userId > MAX_PG_INT
    ) {
      throw new UnauthorizedException('Thông tin xác thực không hợp lệ');
    }
    if (
      actor.credentialVersion !== undefined &&
      (!Number.isInteger(actor.credentialVersion) ||
        actor.credentialVersion < 0 ||
        actor.credentialVersion > MAX_PG_INT)
    ) {
      throw new UnauthorizedException('Thông tin phiên đăng nhập không hợp lệ');
    }
    if (actor.role !== Role.SELLER) {
      throw new ForbiddenException(
        'Chỉ tài khoản người bán mới được phép chỉnh sửa tồn kho và giá phân loại',
      );
    }
  }

  private validatePositiveId(value: number, fieldName: string): void {
    if (!Number.isInteger(value) || value < 1 || value > MAX_PG_INT) {
      throw new BadRequestException(
        `${fieldName} phải là số nguyên dương hợp lệ`,
      );
    }
  }

  private validateAndNormalizeDto(
    dto: UpdateProductVariantDto,
  ): ValidatedVariantEditInput {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new BadRequestException('Dữ liệu cập nhật phân loại không hợp lệ');
    }

    const keys = Object.keys(dto);
    if (
      keys.length !== ALLOWED_DTO_KEYS.size ||
      keys.some((key) => !ALLOWED_DTO_KEYS.has(key))
    ) {
      throw new BadRequestException(
        'Payload chỉ được phép chứa đúng 6 trường: expectedProductVersion, expectedPrice, expectedStock, price, stock, reason',
      );
    }

    const {
      expectedProductVersion,
      expectedPrice,
      expectedStock,
      price,
      stock,
      reason,
    } = dto;

    if (
      !Number.isInteger(expectedProductVersion) ||
      expectedProductVersion < 1 ||
      expectedProductVersion > MAX_UPDATABLE_PRODUCT_VERSION
    ) {
      throw new BadRequestException(
        'expectedProductVersion phải là số nguyên từ 1 đến 2147483646',
      );
    }

    if (
      !Number.isInteger(expectedStock) ||
      expectedStock < 0 ||
      expectedStock > MAX_PG_INT
    ) {
      throw new BadRequestException(
        'expectedStock phải là số nguyên không âm hợp lệ',
      );
    }

    if (!Number.isInteger(stock) || stock < 0 || stock > MAX_PG_INT) {
      throw new BadRequestException('stock phải là số nguyên không âm hợp lệ');
    }

    const normalizedExpectedPrice = this.parseCanonicalVndDecimal(
      expectedPrice,
      'expectedPrice',
    );
    const normalizedPrice = this.parseCanonicalVndDecimal(price, 'price');

    if (typeof reason !== 'string') {
      throw new BadRequestException('reason phải là chuỗi ký tự hợp lệ');
    }
    const trimmedReason = reason.trim();
    if (
      trimmedReason.length < 1 ||
      trimmedReason.length > MAX_VARIANT_EDIT_REASON_LENGTH
    ) {
      throw new BadRequestException(
        `reason sau khi cắt khoảng trắng phải từ 1 đến ${MAX_VARIANT_EDIT_REASON_LENGTH} ký tự`,
      );
    }

    if (
      normalizedExpectedPrice.equals(normalizedPrice) &&
      expectedStock === stock
    ) {
      throw new BadRequestException(
        'Giá mới hoặc tồn kho mới phải khác với giá trị hiện tại',
      );
    }

    return {
      expectedProductVersion,
      expectedPrice: normalizedExpectedPrice,
      expectedStock,
      price: normalizedPrice,
      stock,
      reason: trimmedReason,
    };
  }

  private parseCanonicalVndDecimal(
    raw: unknown,
    fieldName: string,
  ): Prisma.Decimal {
    if (typeof raw !== 'string') {
      throw new BadRequestException(
        `${fieldName} phải là chuỗi số nguyên dương VND hợp lệ`,
      );
    }
    const trimmed = raw.trim();
    if (!POSITIVE_VND_PRICE_REGEX.test(trimmed)) {
      throw new BadRequestException(
        `${fieldName} phải là chuỗi số nguyên dương VND tối đa 12 chữ số phần nguyên (tùy chọn .00)`,
      );
    }
    const decimal = new Prisma.Decimal(trimmed);
    if (!decimal.isFinite() || decimal.lte(0) || !decimal.mod(1).equals(0)) {
      throw new BadRequestException(
        `${fieldName} phải là số tiền VND nguyên dương lớn hơn 0`,
      );
    }
    return decimal;
  }

  private readTimeoutConfig(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = this.config?.get<string | number>(key);
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = typeof raw === 'number' ? raw : Number(String(raw));
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return fallback;
    }
    return parsed;
  }

  private isDeterministicAdjustmentIdempotencyCollision(
    error: unknown,
  ): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private isLockOrStatementTimeout(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (['P2024', 'P1008', 'P2028'].includes(error.code)) return true;
      if (error.code === 'P2010') {
        const adapter = error.meta?.driverAdapterError;
        const cause =
          adapter && typeof adapter === 'object' && 'cause' in adapter
            ? adapter.cause
            : null;
        const state = String(
          error.meta?.code ??
            (cause && typeof cause === 'object' && 'originalCode' in cause
              ? cause.originalCode
              : ''),
        );
        return ['55P03', '57014'].includes(state);
      }
      return false;
    }
    if (!(error instanceof Error)) return false;
    const cause =
      error.cause && typeof error.cause === 'object'
        ? (error.cause as Record<string, unknown>)
        : undefined;
    const originalCode =
      typeof cause?.originalCode === 'string' ? cause.originalCode : undefined;
    return originalCode === '55P03' || originalCode === '57014';
  }

  private sqlState(error: unknown): string {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010') {
      const adapter = error.meta?.driverAdapterError;
      const cause = adapter && typeof adapter === 'object' && 'cause' in adapter ? adapter.cause : null;
      return String(error.meta?.code ?? (cause && typeof cause === 'object' && 'originalCode' in cause ? cause.originalCode : ''));
    }
    return '';
  }

  private safeConflict(code: string, message: string): ConflictException {
    return new ConflictException({
      code,
      message,
    });
  }
}
