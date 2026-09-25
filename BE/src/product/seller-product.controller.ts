import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { CreateProductOptionGroupDto } from './dto/create-product-option-group.dto.js';
import { CreateProductOptionValueDto } from './dto/create-product-option-value.dto.js';
import { CreateProductVariantDto } from './dto/create-product-variant.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { UploadProductImageDto } from './dto/upload-product-image.dto.js';
import { UpsertProductAttributeValueDto } from './dto/upsert-product-attribute-value.dto.js';
import { UpsertShippingProfileDto } from './dto/upsert-shipping-profile.dto.js';
import type { UploadedImage } from './product-image-storage.service.js';
import { ProductService } from './product.service.js';
import { ProductLifecycleService } from './product-lifecycle.service.js';
import { ProductVisibilityDto } from './dto/product-lifecycle.dto.js';
import { ProductIdPipe } from './product-id.pipe.js';

@ApiTags('seller-products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SELLER)
@Controller('seller/products')
export class SellerProductController {
  constructor(
    private readonly products: ProductService,
    private readonly lifecycle: ProductLifecycleService,
  ) {}

  @ApiOkResponse({ description: 'Ẩn/hiện Product đã duyệt theo version' })
  @Patch(':productId/visibility')
  visibility(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ProductIdPipe) productId: number,
    @Body() dto: ProductVisibilityDto,
  ) {
    return this.lifecycle.visibility(productId, user.userId, dto);
  }

  @ApiCreatedResponse({ description: 'Đã tạo Product DRAFT' })
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ) {
    return this.products.createDraft(user.userId, dto);
  }

  @ApiOkResponse({ description: 'Danh sách Product thuộc Store hiện tại' })
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.products.listMine(user.userId);
  }

  @ApiOkResponse({ description: 'Chi tiết Product thuộc Store hiện tại' })
  @Get(':productId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    return this.products.getMine(user.userId, productId);
  }

  @ApiOkResponse({ description: 'Product DRAFT đã được cập nhật' })
  @Patch(':productId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.updateDraft(user.userId, productId, dto);
  }

  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        sortOrder: { type: 'integer', minimum: 0 },
        isPrimary: { type: 'boolean' },
        productOptionValueId: { type: 'integer', minimum: 1, nullable: true },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @Post(':productId/images')
  addImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UploadProductImageDto,
    @UploadedFile() file: UploadedImage,
  ) {
    return this.products.addImage(user.userId, productId, dto, file);
  }

  @ApiOkResponse({ description: 'Ảnh đã được gỡ khỏi Product' })
  @Delete(':productId/images/:imageId')
  deleteImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Param('imageId', ParseIntPipe) imageId: number,
  ) {
    return this.products.deleteImage(user.userId, productId, imageId);
  }

  @ApiCreatedResponse({ description: 'Nhóm phân loại đã được tạo' })
  @Post(':productId/option-groups')
  createOptionGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: CreateProductOptionGroupDto,
  ) {
    return this.products.createOptionGroup(user.userId, productId, dto);
  }

  @ApiCreatedResponse({ description: 'Giá trị phân loại đã được tạo' })
  @Post(':productId/option-groups/:groupId/values')
  createOptionValue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: CreateProductOptionValueDto,
  ) {
    return this.products.createOptionValue(
      user.userId,
      productId,
      groupId,
      dto,
    );
  }

  @ApiOkResponse({ description: 'Giá trị thuộc tính đã được lưu' })
  @Put(':productId/attributes/:attributeDefinitionId')
  upsertAttributeValue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Param('attributeDefinitionId', ParseIntPipe)
    attributeDefinitionId: number,
    @Body() dto: UpsertProductAttributeValueDto,
  ) {
    return this.products.upsertAttributeValue(
      user.userId,
      productId,
      attributeDefinitionId,
      dto,
    );
  }

  @ApiCreatedResponse({ description: 'Variant đã được tạo cho Product' })
  @Post(':productId/variants')
  createVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: CreateProductVariantDto,
  ) {
    return this.products.createVariant(user.userId, productId, dto);
  }

  @ApiOkResponse({ description: 'Thông tin kiện hàng đã được lưu' })
  @Patch(':productId/shipping-profile')
  updateShippingProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpsertShippingProfileDto,
  ) {
    return this.products.upsertShippingProfile(user.userId, productId, dto);
  }

  @ApiOkResponse({ description: 'Product đã được gửi Admin duyệt' })
  @HttpCode(200)
  @Post(':productId/submit')
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    return this.products.submit(user.userId, productId);
  }
}
