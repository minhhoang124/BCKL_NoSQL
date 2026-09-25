import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicProductQueryDto } from './dto/product-lifecycle.dto.js';
import { ProductLifecycleService } from './product-lifecycle.service.js';
import { ProductIdPipe } from './product-id.pipe.js';

@ApiTags('products')
@Controller('products')
export class PublicProductController {
  constructor(private readonly products: ProductLifecycleService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: PublicProductQueryDto) {
    return this.products.publicList(query);
  }

  @Get(':productId')
  @Header('Cache-Control', 'no-store')
  detail(@Param('productId', ProductIdPipe) id: number) {
    return this.products.publicDetail(id);
  }
}
