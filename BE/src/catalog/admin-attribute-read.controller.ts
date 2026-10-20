import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import {
  attributeReadId,
  attributeReadQuery,
  attributeReadValidation,
} from './admin-attribute-read.query.js';
import { AdminAttributeReadService } from './admin-attribute-read.service.js';

@ApiTags('admin-category-attributes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/categories/:categoryId/attributes')
export class AdminAttributeReadController {
  constructor(private readonly attributes: AdminAttributeReadService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Param('categoryId') categoryId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.attributes.list(
      attributeReadId(categoryId),
      attributeReadQuery(query),
    );
  }

  @Get(':attributeId')
  @Header('Cache-Control', 'no-store')
  detail(
    @Param('categoryId') categoryId: string,
    @Param('attributeId') attributeId: string,
    @Query() query: Record<string, unknown>,
  ) {
    if (Object.keys(query).length)
      attributeReadValidation('Unknown query field');
    return this.attributes.detail(
      attributeReadId(categoryId),
      attributeReadId(attributeId),
    );
  }

  @Get(':attributeId/options')
  @Header('Cache-Control', 'no-store')
  options(
    @Param('categoryId') categoryId: string,
    @Param('attributeId') attributeId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.attributes.options(
      attributeReadId(categoryId),
      attributeReadId(attributeId),
      attributeReadQuery(query),
    );
  }
}
