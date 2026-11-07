import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service.js';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @ApiOkResponse({ description: 'Cây danh mục đang hoạt động' })
  @Get('categories')
  getCategories() {
    return this.catalog.getActiveCategoryTree();
  }

  @ApiOkResponse({ description: 'Thuộc tính đang hoạt động của danh mục' })
  @ApiNotFoundResponse({ description: 'Danh mục không tồn tại hoặc đã tắt' })
  @Get('categories/:categoryId/attributes')
  getCategoryAttributes(@Param('categoryId', ParseIntPipe) categoryId: number) {
    return this.catalog.getCategoryAttributes(categoryId);
  }

  @ApiOkResponse({ description: 'Danh sách thương hiệu đang hoạt động' })
  @Get('brands')
  getBrands() {
    return this.catalog.getActiveBrands();
  }
}
