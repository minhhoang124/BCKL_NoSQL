import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CatalogService } from './catalog.service.js';
import { CreateBrandDto } from './dto/create-brand.dto.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateBrandDto } from './dto/update-brand.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { CreateCategoryAttributeDto } from './dto/create-category-attribute.dto.js';
import { UpdateCategoryAttributeDto } from './dto/update-category-attribute.dto.js';

@ApiTags('admin-catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @ApiOkResponse({ description: 'Toàn bộ danh mục, gồm cả bản ghi đã tắt' })
  @Get('categories')
  getCategories() {
    return this.catalog.getAllCategories();
  }

  @ApiCreatedResponse({ description: 'Danh mục đã được tạo' })
  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @ApiOkResponse({ description: 'Danh mục đã được cập nhật' })
  @Patch('categories/:categoryId')
  updateCategory(
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(categoryId, dto);
  }

  @ApiOkResponse({ description: 'Danh mục đã được tắt (soft delete)' })
  @Delete('categories/:categoryId')
  deactivateCategory(@Param('categoryId', ParseIntPipe) categoryId: number) {
    return this.catalog.deactivateCategory(categoryId);
  }

  @ApiCreatedResponse({ description: 'Thuộc tính danh mục đã được tạo' })
  @Post('categories/:categoryId/attributes')
  createCategoryAttribute(
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Body() dto: CreateCategoryAttributeDto,
  ) {
    return this.catalog.createCategoryAttribute(categoryId, dto);
  }

  @ApiOkResponse({ description: 'Thuộc tính và durable reconciliation job' })
  @Patch('categories/:categoryId/attributes/:attributeId')
  updateCategoryAttribute(
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Param('attributeId', ParseIntPipe) attributeId: number,
    @Body() dto: UpdateCategoryAttributeDto,
  ) {
    return this.catalog.updateCategoryAttribute(categoryId, attributeId, dto);
  }

  @ApiOkResponse({ description: 'Toàn bộ thương hiệu, gồm cả bản ghi đã tắt' })
  @Get('brands')
  getBrands() {
    return this.catalog.getAllBrands();
  }

  @ApiCreatedResponse({ description: 'Thương hiệu đã được tạo' })
  @Post('brands')
  createBrand(@Body() dto: CreateBrandDto) {
    return this.catalog.createBrand(dto);
  }

  @ApiOkResponse({ description: 'Thương hiệu đã được cập nhật' })
  @Patch('brands/:brandId')
  updateBrand(
    @Param('brandId', ParseIntPipe) brandId: number,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.catalog.updateBrand(brandId, dto);
  }

  @ApiOkResponse({ description: 'Thương hiệu đã được tắt (soft delete)' })
  @Delete('brands/:brandId')
  deactivateBrand(@Param('brandId', ParseIntPipe) brandId: number) {
    return this.catalog.deactivateBrand(brandId);
  }
}
