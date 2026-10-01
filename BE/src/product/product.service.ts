import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CategoryAttributeDataType,
  Prisma,
  ProductModerationStatus,
  ProductSellerStatus,
  StoreStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  isTransactionConflict,
  waitForTransactionRetry,
} from './transaction-conflict.js';
import { PrismaService } from '../prisma.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { CreateProductOptionGroupDto } from './dto/create-product-option-group.dto.js';
import { CreateProductOptionValueDto } from './dto/create-product-option-value.dto.js';
import { CreateProductVariantDto } from './dto/create-product-variant.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { UploadProductImageDto } from './dto/upload-product-image.dto.js';
import { UpsertProductAttributeValueDto } from './dto/upsert-product-attribute-value.dto.js';
import { UpsertShippingProfileDto } from './dto/upsert-shipping-profile.dto.js';
import {
  ProductImageStorageService,
  type UploadedImage,
} from './product-image-storage.service.js';
import { SearchOutboxService } from '../search/search-outbox.service.js';
import { listingInclude } from './product-public-policy.js';

const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
  images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  attributeValues: { orderBy: { id: 'asc' } },
  optionGroups: {
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    include: { values: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
  },
  variants: { orderBy: { id: 'asc' } },
  shippingProfile: true,
} satisfies Prisma.ProductInclude;

type AttributeValueData = {
  optionId: number | null;
  textValue: string | null;
  numberValue: Prisma.Decimal | null;
  booleanValue: boolean | null;
};

type ProductImageMutationSnapshot = {
  id: number;
  storeId: number;
  sellerStatus: ProductSellerStatus;
  moderationStatus: ProductModerationStatus;
  rejectionReason: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: number | null;
  version: number;
};

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageStorage: ProductImageStorageService,
    private readonly outbox: SearchOutboxService,
  ) {}

  async createDraft(sellerId: number, dto: CreateProductDto) {
    const store = await this.getWritableStore(sellerId);
    await this.assertCatalogSelection(dto.categoryId, dto.brandId);
    return this.prisma.product.create({
      data: {
        storeId: store.id,
        categoryId: dto.categoryId,
        brandId: dto.brandId ?? null,
        name: dto.name,
        description: this.normalizeOptionalText(dto.description),
      },
      include: productInclude,
    });
  }

  async listMine(sellerId: number) {
    return this.prisma.product.findMany({
      where: { store: { sellerId } },
      include: productInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  }

  async getMine(sellerId: number, productId: number) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, store: { sellerId } },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
    return product;
  }

  async updateDraft(
    sellerId: number,
    productId: number,
    dto: UpdateProductDto,
  ) {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('Cần ít nhất một trường để cập nhật');
    }
    await this.getWritableStore(sellerId);
    const product = await this.getOwnedEditableProduct(sellerId, productId);
    if (
      product.moderationStatus === 'PENDING' ||
      product.moderationStatus === 'FROZEN'
    ) {
      throw new ForbiddenException(
        'Không thể sửa sản phẩm đang chờ duyệt hoặc bị đóng băng',
      );
    }
    await this.assertCatalogSelection(
      dto.categoryId ?? product.categoryId,
      dto.brandId === undefined ? product.brandId : dto.brandId,
    );

    await this.runSerializable(async (tx) => {
      await this.incrementVersion(tx, product, {
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.brandId !== undefined ? { brandId: dto.brandId } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: this.normalizeOptionalText(dto.description) }
          : {}),
      });
    });

    return this.getMine(sellerId, productId);
  }

  async addImage(
    sellerId: number,
    productId: number,
    dto: UploadProductImageDto,
    file: UploadedImage,
  ) {
    return this.imageStorage.withProductImageLock(productId, () =>
      this.addImageLocked(sellerId, productId, dto, file),
    );
  }

  private async addImageLocked(
    sellerId: number,
    productId: number,
    dto: UploadProductImageDto,
    file: UploadedImage,
  ) {
    await this.getWritableStore(sellerId);
    const product = await this.getOwnedEditableProduct(sellerId, productId);
    if (dto.productOptionValueId) {
      const option = await this.prisma.productOptionValue.findFirst({
        where: { id: dto.productOptionValueId, productId },
        select: { id: true },
      });
      if (!option) {
        throw new BadRequestException('Giá trị phân loại không thuộc sản phẩm');
      }
    }
    const stored = await this.imageStorage.save(product.id, file);

    try {
      const outcome = await this.runSerializable(async (tx) => {
        const existing = await tx.productImage.findUnique({
          where: { productId_url: { productId, url: stored.url } },
        });
        if (existing) {
          return {
            image: existing,
            created: false,
            previousPrimaryImageId: null,
          };
        }
        const currentPrimary = await tx.productImage.findFirst({
          where: { productId, isPrimary: true },
          select: { id: true },
        });
        const isPrimary = dto.isPrimary === true || currentPrimary === null;
        if (isPrimary) {
          await tx.productImage.updateMany({
            where: { productId, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        const image = await tx.productImage.create({
          data: {
            productId,
            productOptionValueId: dto.productOptionValueId ?? null,
            url: stored.url,
            sortOrder: dto.sortOrder ?? 0,
            isPrimary,
          },
        });
        await this.incrementVersion(tx, product);
        return {
          image,
          created: true,
          previousPrimaryImageId: currentPrimary?.id ?? null,
        };
      });
      try {
        await this.imageStorage.publish(stored);
      } catch (error: unknown) {
        if (outcome.created) {
          await this.compensateFailedImagePublish(
            product,
            outcome.image,
            outcome.previousPrimaryImageId,
          );
        }
        throw error;
      }
      return outcome.image;
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.productImage.findUnique({
          where: { productId_url: { productId, url: stored.url } },
        });
        if (existing) {
          await this.imageStorage.publish(stored);
          return existing;
        }
      }
      await this.imageStorage.discard(stored);
      throw error;
    }
  }

  async deleteImage(sellerId: number, productId: number, imageId: number) {
    return this.imageStorage.withProductImageLock(productId, () =>
      this.deleteImageLocked(sellerId, productId, imageId),
    );
  }

  private async deleteImageLocked(
    sellerId: number,
    productId: number,
    imageId: number,
  ) {
    await this.getWritableStore(sellerId);
    const product = await this.getOwnedEditableProduct(sellerId, productId);
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!image) throw new NotFoundException('Không tìm thấy ảnh sản phẩm');
    const staged = await this.imageStorage.stageDeletion(image.url);
    if (!staged) {
      throw new ConflictException(
        'Ảnh đang được xử lý bởi yêu cầu khác, vui lòng thử lại',
      );
    }
    try {
      const result = await this.runSerializable(async (tx) => {
        const deleted = await tx.productImage.deleteMany({
          where: { id: imageId, productId },
        });
        if (!deleted.count) {
          throw new NotFoundException('Không tìm thấy ảnh sản phẩm');
        }
        if (image.isPrimary) {
          const replacement = await tx.productImage.findFirst({
            where: { productId },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          });
          if (replacement) {
            await tx.productImage.update({
              where: { id: replacement.id },
              data: { isPrimary: true },
            });
          }
        }
        await this.incrementVersion(tx, product);
        return { deleted: true };
      });
      await this.imageStorage.finalizeDeletion(staged).catch((error) => {
        staged.release();
        this.logger.warn(
          `Không thể xóa file staging của ảnh ${imageId}: ${String(error)}`,
        );
      });
      return result;
    } catch (error: unknown) {
      await this.imageStorage.restoreDeletion(staged);
      throw error;
    }
  }

  async createOptionGroup(
    sellerId: number,
    productId: number,
    dto: CreateProductOptionGroupDto,
  ) {
    await this.getWritableStore(sellerId);
    const product = await this.getOwnedEditableProduct(sellerId, productId);
    try {
      return await this.runSerializable(async (tx) => {
        const groupCount = await tx.productOptionGroup.count({
          where: { productId },
        });
        if (groupCount >= 2) {
          throw new BadRequestException(
            'Mỗi sản phẩm chỉ được có tối đa 2 nhóm phân loại',
          );
        }
        const group = await tx.productOptionGroup.create({
          data: {
            productId,
            name: dto.name,
            position: dto.position ?? 0,
          },
        });
        await this.incrementVersion(tx, product);
        return group;
      });
    } catch (error: unknown) {
      this.rethrowProductConstraint(error, 'Tên nhóm phân loại đã tồn tại');
    }
  }

  async createOptionValue(
    sellerId: number,
    productId: number,
    groupId: number,
    dto: CreateProductOptionValueDto,
  ) {
    await this.getWritableStore(sellerId);
    const product = await this.getOwnedEditableProduct(sellerId, productId);
    try {
      return await this.runSerializable(async (tx) => {
        const group = await tx.productOptionGroup.findFirst({
          where: { id: groupId, productId },
          select: { id: true },
        });
        if (!group) {
          throw new NotFoundException(
            'Không tìm thấy nhóm phân loại của sản phẩm',
          );
        }
        const value = await tx.productOptionValue.create({
          data: {
            productId,
            groupId,
            value: dto.value,
            position: dto.position ?? 0,
          },
        });
        await this.incrementVersion(tx, product);
        return value;
      });
    } catch (error: unknown) {
      this.rethrowProductConstraint(
        error,
        'Giá trị phân loại đã tồn tại trong nhóm',
      );
    }
  }

  async upsertAttributeValue(
    sellerId: number,
    productId: number,
    attributeDefinitionId: number,
    dto: UpsertProductAttributeValueDto,
  ) {
    await this.getWritableStore(sellerId);
    const product = await this.getOwnedEditableProduct(sellerId, productId);
    const definition = await this.prisma.categoryAttributeDefinition.findFirst({
      where: {
        id: attributeDefinitionId,
        categoryId: product.categoryId,
        isActive: true,
      },
      select: {
        id: true,
        dataType: true,
        allowsCustom: true,
      },
    });
    if (!definition) {
      throw new BadRequestException(
        'Thuộc tính không hoạt động hoặc không thuộc danh mục sản phẩm',
      );
    }
    const data = await this.normalizeAttributeValue(definition, dto);

    return this.runSerializable(async (tx) => {
      const value = await tx.productAttributeValue.upsert({
        where: {
          productId_attributeDefinitionId: {
            productId,
            attributeDefinitionId,
          },
        },
        create: { productId, attributeDefinitionId, ...data },
        update: data,
      });
      await this.incrementVersion(tx, product);
      return value;
    });
  }

  async createVariant(
    sellerId: number,
    productId: number,
    dto: CreateProductVariantDto,
  ) {
    await this.getWritableStore(sellerId);
    const product = await this.getOwnedEditableProduct(sellerId, productId);
    const price = new Prisma.Decimal(dto.price);
    if (price.lte(0)) throw new BadRequestException('Giá phải lớn hơn 0');

    const optionValueIds = [...(dto.optionValueIds ?? [])].sort(
      (left, right) => left - right,
    );
    const [options, optionGroupCount] = await Promise.all([
      optionValueIds.length
        ? this.prisma.productOptionValue.findMany({
            where: { id: { in: optionValueIds }, productId },
            select: { id: true, groupId: true },
          })
        : Promise.resolve([]),
      this.prisma.productOptionGroup.count({ where: { productId } }),
    ]);
    if (options.length !== optionValueIds.length) {
      throw new BadRequestException('Giá trị phân loại không thuộc sản phẩm');
    }
    if (
      new Set(options.map((option) => option.groupId)).size !== options.length
    ) {
      throw new BadRequestException(
        'Mỗi variant chỉ được chọn một giá trị trong mỗi nhóm phân loại',
      );
    }
    if (options.length !== optionGroupCount) {
      throw new BadRequestException(
        'Variant phải chọn đúng một giá trị trong mỗi nhóm phân loại',
      );
    }
    const optionSignature = optionValueIds.length
      ? optionValueIds.join(':')
      : 'default';
    const sellerSku = this.normalizeOptionalText(dto.sellerSku);
    const duplicateCombination = await this.prisma.productVariant.findUnique({
      where: { productId_optionSignature: { productId, optionSignature } },
      select: { id: true },
    });
    if (duplicateCombination) {
      throw new ConflictException('Tổ hợp phân loại của variant đã tồn tại');
    }
    if (sellerSku) {
      const duplicate = await this.prisma.productVariant.findFirst({
        where: { storeId: product.storeId, sellerSku },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('Seller SKU đã tồn tại trong cửa hàng');
      }
    }

    return this.runSerializable(async (tx) => {
      const variant = await tx.productVariant.create({
        data: {
          productId,
          storeId: product.storeId,
          skuCode: `SKU-${productId}-${randomUUID()}`,
          sellerSku,
          price,
          stock: dto.stock,
          isActive: dto.isActive ?? true,
          optionSignature,
        },
      });
      if (options.length) {
        await tx.productVariantOptionValue.createMany({
          data: options.map((option) => ({
            variantId: variant.id,
            productId,
            optionGroupId: option.groupId,
            optionValueId: option.id,
          })),
        });
      }
      await this.incrementVersion(tx, product);
      return tx.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
        include: { optionValueLinks: true },
      });
    });
  }

  async upsertShippingProfile(
    sellerId: number,
    productId: number,
    dto: UpsertShippingProfileDto,
  ) {
    await this.getWritableStore(sellerId);
    const product = await this.getOwnedEditableProduct(sellerId, productId);
    const dimensions = [
      dto.packageLengthCm,
      dto.packageWidthCm,
      dto.packageHeightCm,
    ];
    if (
      dimensions.some(
        (value) => value != null && new Prisma.Decimal(value).lte(0),
      )
    ) {
      throw new BadRequestException('Kích thước kiện hàng phải lớn hơn 0');
    }
    return this.runSerializable(async (tx) => {
      const profile = await tx.productShippingProfile.upsert({
        where: { productId },
        create: { productId, ...dto },
        update: { ...dto },
      });
      await this.incrementVersion(tx, product);
      return profile;
    });
  }

  async submit(sellerId: number, productId: number) {
    return this.imageStorage.withProductImageLock(productId, () =>
      this.submitLocked(sellerId, productId),
    );
  }

  private async submitLocked(sellerId: number, productId: number) {
    await this.getWritableStore(sellerId);
    const product = await this.getOwnedEditableProduct(sellerId, productId);
    const [
      productImages,
      sellableVariant,
      shippingProfile,
      requiredDefinitions,
    ] = await Promise.all([
      this.prisma.productImage.findMany({
        where: { productId },
        select: { id: true, url: true, isPrimary: true },
      }),
      this.prisma.productVariant.findFirst({
        where: { productId, isActive: true, price: { gt: 0 } },
        select: { id: true },
      }),
      this.prisma.productShippingProfile.findUnique({
        where: { productId },
        select: { packageWeightGrams: true },
      }),
      this.prisma.categoryAttributeDefinition.findMany({
        where: {
          categoryId: product.categoryId,
          isActive: true,
          isRequired: true,
        },
        select: {
          id: true,
          name: true,
          dataType: true,
          allowsCustom: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const requiredValues = requiredDefinitions.length
      ? await this.prisma.productAttributeValue.findMany({
          where: {
            productId,
            attributeDefinitionId: {
              in: requiredDefinitions.map((definition) => definition.id),
            },
          },
          select: {
            attributeDefinitionId: true,
            optionId: true,
            textValue: true,
            numberValue: true,
            booleanValue: true,
            option: {
              select: {
                id: true,
                attributeDefinitionId: true,
                isActive: true,
              },
            },
          },
        })
      : [];
    const valuesByDefinition = new Map(
      requiredValues.map((value) => [value.attributeDefinitionId, value]),
    );
    const missing: string[] = [];
    const primaryImage = productImages.find((image) => image.isPrimary);
    if (!primaryImage) {
      missing.push('ảnh chính');
    } else {
      const published = await Promise.all(
        productImages.map((image) => this.imageStorage.isPublished(image.url)),
      );
      if (published.some((exists) => !exists))
        missing.push('file ảnh đã tải lên hợp lệ');
    }
    if (!sellableVariant) missing.push('variant đang bán có giá hợp lệ');
    if (!shippingProfile?.packageWeightGrams)
      missing.push('khối lượng kiện hàng');
    for (const definition of requiredDefinitions) {
      const value = valuesByDefinition.get(definition.id);
      if (
        !value ||
        !this.hasStoredAttributeValue(
          definition.dataType,
          definition.allowsCustom,
          definition.id,
          value,
        )
      ) {
        missing.push(`thuộc tính bắt buộc "${definition.name}"`);
      }
    }
    if (missing.length) {
      throw new BadRequestException(
        `Sản phẩm chưa đủ điều kiện gửi duyệt: ${missing.join(', ')}`,
      );
    }
    const updated = await this.prisma.product.updateMany({
      where: {
        id: productId,
        storeId: product.storeId,
        version: product.version,
      },
      data: {
        sellerStatus: 'ACTIVE',
        moderationStatus: 'PENDING',
        rejectionReason: null,
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        version: { increment: 1 },
      },
    });
    if (!updated.count) {
      throw new ConflictException(
        'Sản phẩm vừa được cập nhật bởi yêu cầu khác',
      );
    }
    return this.getMine(sellerId, productId);
  }

  private async getWritableStore(sellerId: number) {
    const store = await this.prisma.store.findUnique({ where: { sellerId } });
    if (!store) throw new NotFoundException('Seller chưa có cửa hàng');
    if (store.status !== StoreStatus.ACTIVE) {
      throw new ForbiddenException(
        'Cửa hàng phải được duyệt và đang hoạt động',
      );
    }
    return store;
  }

  private async getOwnedProduct(sellerId: number, productId: number) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, store: { sellerId } },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
    return product;
  }

  private async getOwnedEditableProduct(sellerId: number, productId: number) {
    const product = await this.getOwnedProduct(sellerId, productId);
    if (
      product.moderationStatus === 'PENDING' ||
      product.moderationStatus === 'FROZEN'
    ) {
      throw new ForbiddenException(
        'Không thể sửa sản phẩm đang chờ duyệt hoặc bị đóng băng',
      );
    }
    return product;
  }

  private async compensateFailedImagePublish(
    product: ProductImageMutationSnapshot,
    image: { id: number; url: string; isPrimary: boolean },
    previousPrimaryImageId: number | null,
  ) {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await this.runImagePublishCompensation(
          product,
          image,
          previousPrimaryImageId,
        );
        return;
      } catch (error: unknown) {
        if (
          error instanceof BadRequestException ||
          error instanceof ConflictException ||
          error instanceof NotFoundException
        ) {
          throw error;
        }
        if (attempt < maxAttempts - 1) {
          await waitForTransactionRetry(attempt);
          continue;
        }
        this.logger.error(
          `IMAGE_COMPENSATION_FAILED product=${product.id} attempts=${maxAttempts}`,
        );
        throw error;
      }
    }
  }

  private async runImagePublishCompensation(
    product: ProductImageMutationSnapshot,
    image: { id: number; url: string; isPrimary: boolean },
    previousPrimaryImageId: number | null,
  ) {
    await this.runSerializable(async (tx) => {
      const currentImage = await tx.productImage.findUnique({
        where: { id: image.id },
      });
      const currentProduct = await tx.product.findUnique({
        where: { id: product.id },
      });
      // Another successful compensation already removed this exact image.
      if (!currentImage) return;
      if (!currentProduct)
        throw new ConflictException('Sản phẩm không còn tồn tại');
      if (
        currentImage.productId !== product.id ||
        currentImage.url !== image.url
      )
        throw new ConflictException('Ảnh bồi hoàn không khớp sản phẩm');

      const hasSubsequentMutation =
        currentProduct.version !== product.version + 1;
      await tx.productImage.delete({ where: { id: image.id } });

      if (image.isPrimary) {
        const activePrimary = await tx.productImage.findFirst({
          where: { productId: product.id, isPrimary: true },
          select: { id: true },
        });
        if (!activePrimary) {
          const preferredReplacement = previousPrimaryImageId
            ? await tx.productImage.findFirst({
                where: {
                  id: previousPrimaryImageId,
                  productId: product.id,
                },
                select: { id: true },
              })
            : null;
          const replacement =
            preferredReplacement ??
            (await tx.productImage.findFirst({
              where: { productId: product.id },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              select: { id: true },
            }));
          if (replacement) {
            await tx.productImage.update({
              where: { id: replacement.id },
              data: { isPrimary: true },
            });
          }
        }
      }

      if (hasSubsequentMutation) {
        const updated = await tx.product.updateMany({
          where: { id: product.id, version: currentProduct.version },
          data: {
            version: { increment: 1 },
          },
        });
        if (!updated.count) {
          throw new ConflictException(
            'Sản phẩm đã thay đổi trong quá trình bồi hoàn',
          );
        }
      } else {
        const updated = await tx.product.updateMany({
          where: { id: product.id, version: currentProduct.version },
          data: {
            sellerStatus: product.sellerStatus,
            moderationStatus: product.moderationStatus,
            rejectionReason: product.rejectionReason,
            submittedAt: product.submittedAt,
            reviewedAt: product.reviewedAt,
            reviewedBy: product.reviewedBy,
            version: { increment: 1 },
          },
        });
        if (!updated.count) {
          throw new ConflictException(
            'Sản phẩm đã thay đổi trong quá trình bồi hoàn',
          );
        }
      }

      const fullProduct = await tx.product.findUniqueOrThrow({
        where: { id: product.id },
        include: listingInclude,
      });
      const categories = await tx.category.findMany({
        select: { id: true, parentId: true, isActive: true },
      });

      await this.outbox.writeOutboxEvent(
        tx,
        fullProduct,
        categories,
        fullProduct.version,
      );
    });
  }

  private async incrementVersion(
    tx: Prisma.TransactionClient,
    product: {
      id: number;
      storeId: number;
      version: number;
      moderationStatus: ProductModerationStatus;
    },
    extraData?: Prisma.ProductUncheckedUpdateManyInput,
  ): Promise<number> {
    const changed = await tx.product.updateMany({
      where: {
        id: product.id,
        storeId: product.storeId,
        version: product.version,
      },
      data: {
        ...extraData,
        ...this.getReviewResetData(product.moderationStatus),
        version: { increment: 1 },
      },
    });
    if (!changed.count) {
      throw new ConflictException(
        'Sản phẩm vừa được cập nhật bởi yêu cầu khác',
      );
    }
    const newVersion = product.version + 1;
    if (product.moderationStatus === ProductModerationStatus.APPROVED) {
      await this.outbox.writeDeleteEvent(tx, product.id, newVersion);
    }
    return newVersion;
  }

  private getReviewResetData(
    moderationStatus: ProductModerationStatus,
  ): Prisma.ProductUncheckedUpdateManyInput {
    if (moderationStatus !== ProductModerationStatus.APPROVED) return {};
    return {
      sellerStatus: 'DRAFT',
      moderationStatus: ProductModerationStatus.NOT_SUBMITTED,
      rejectionReason: null,
      submittedAt: null,
      reviewedAt: null,
      reviewedBy: null,
    };
  }

  private async normalizeAttributeValue(
    definition: {
      id: number;
      dataType: CategoryAttributeDataType;
      allowsCustom: boolean;
    },
    dto: UpsertProductAttributeValueDto,
  ): Promise<AttributeValueData> {
    const textValue = this.normalizeOptionalText(dto.textValue);
    const provided = [
      dto.optionId != null,
      textValue != null,
      dto.numberValue != null,
      dto.booleanValue != null,
    ].filter(Boolean).length;
    if (provided !== 1) {
      throw new BadRequestException(
        'Phải cung cấp đúng một giá trị phù hợp với kiểu thuộc tính',
      );
    }

    const empty: AttributeValueData = {
      optionId: null,
      textValue: null,
      numberValue: null,
      booleanValue: null,
    };
    if (definition.dataType === CategoryAttributeDataType.TEXT && textValue) {
      return { ...empty, textValue };
    }
    if (
      definition.dataType === CategoryAttributeDataType.NUMBER &&
      dto.numberValue != null
    ) {
      return { ...empty, numberValue: new Prisma.Decimal(dto.numberValue) };
    }
    if (
      definition.dataType === CategoryAttributeDataType.BOOLEAN &&
      dto.booleanValue != null
    ) {
      return { ...empty, booleanValue: dto.booleanValue };
    }
    if (definition.dataType === CategoryAttributeDataType.SINGLE_SELECT) {
      if (dto.optionId != null) {
        const option = await this.prisma.categoryAttributeOption.findFirst({
          where: {
            id: dto.optionId,
            attributeDefinitionId: definition.id,
            isActive: true,
          },
          select: { id: true },
        });
        if (!option) {
          throw new BadRequestException(
            'Lựa chọn thuộc tính không hoạt động hoặc không thuộc định nghĩa',
          );
        }
        return { ...empty, optionId: option.id };
      }
      if (definition.allowsCustom && textValue) {
        return { ...empty, textValue };
      }
    }
    throw new BadRequestException(
      'Giá trị không phù hợp với kiểu của thuộc tính',
    );
  }

  private hasStoredAttributeValue(
    dataType: CategoryAttributeDataType,
    allowsCustom: boolean,
    attributeDefinitionId: number,
    value: {
      optionId: number | null;
      textValue: string | null;
      numberValue: Prisma.Decimal | null;
      booleanValue: boolean | null;
      option: {
        id: number;
        attributeDefinitionId: number;
        isActive: boolean;
      } | null;
    },
  ): boolean {
    if (dataType === CategoryAttributeDataType.TEXT) {
      return Boolean(value.textValue?.trim());
    }
    if (dataType === CategoryAttributeDataType.NUMBER) {
      return value.numberValue !== null;
    }
    if (dataType === CategoryAttributeDataType.BOOLEAN) {
      return value.booleanValue !== null;
    }
    const hasActiveOption =
      value.optionId !== null &&
      value.option?.id === value.optionId &&
      value.option.attributeDefinitionId === attributeDefinitionId &&
      value.option.isActive;
    return (
      hasActiveOption || (allowsCustom && Boolean(value.textValue?.trim()))
    );
  }

  private rethrowProductConstraint(error: unknown, message: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(message);
    }
    throw error;
  }

  private async assertCatalogSelection(
    categoryId: number,
    brandId?: number | null,
  ) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, isActive: true },
      select: { id: true, children: { where: { isActive: true }, take: 1 } },
    });
    if (!category) throw new BadRequestException('Danh mục không hoạt động');
    if (category.children.length) {
      throw new BadRequestException('Sản phẩm phải thuộc danh mục lá');
    }
    if (brandId != null) {
      const brand = await this.prisma.brand.findFirst({
        where: { id: brandId, isActive: true },
        select: { id: true },
      });
      if (!brand) throw new BadRequestException('Thương hiệu không hoạt động');
    }
  }

  private normalizeOptionalText(value: string | null | undefined) {
    if (value == null) return null;
    const normalized = value.trim();
    return normalized.length ? normalized : null;
  }

  private async runSerializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        if (isTransactionConflict(error)) {
          if (attempt < 4) {
            await waitForTransactionRetry(attempt);
            continue;
          }
          throw new ConflictException('Không thể hoàn tất cập nhật đồng thời');
        }
        throw error;
      }
    }
    throw new ConflictException('Không thể hoàn tất cập nhật đồng thời');
  }
}
