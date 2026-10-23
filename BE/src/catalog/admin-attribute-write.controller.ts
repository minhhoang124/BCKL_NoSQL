import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { attributeReadId } from './admin-attribute-read.query.js';
import { AdminAttributeWriteService } from './admin-attribute-write.service.js';
import {
  assertAttributeWriteQuery,
  AttributeWriteExceptionFilter,
  AttributeWriteRateGuard,
} from './admin-attribute-write.http.js';

@ApiTags('admin-category-attributes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, AttributeWriteRateGuard)
@Roles(Role.ADMIN)
@UseFilters(AttributeWriteExceptionFilter)
@Controller('admin/categories/:categoryId/attributes')
export class AdminAttributeWriteController {
  constructor(private readonly attributes: AdminAttributeWriteService) {}

  @Post()
  @ApiBody({
    schema: {
      type: 'object',
      example: { name: 'Kết nối', slug: 'ket-noi', dataType: 'SINGLE_SELECT' },
    },
  })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('categoryId') category: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertAttributeWriteQuery(req);
    return this.attributes.createDefinition(
      actor.userId,
      attributeReadId(category),
      body,
    );
  }

  @Patch(':attributeId')
  @ApiBody({
    schema: {
      type: 'object',
      example: { expectedRevision: 1, name: 'Kết nối thiết bị' },
    },
  })
  patch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('categoryId') category: string,
    @Param('attributeId') attribute: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertAttributeWriteQuery(req);
    return this.attributes.patchDefinition(
      actor.userId,
      attributeReadId(category),
      attributeReadId(attribute),
      body,
    );
  }

  @Post(':attributeId/options')
  @ApiBody({
    schema: {
      type: 'object',
      example: { expectedRevision: 1, value: 'Bluetooth', slug: 'bluetooth' },
    },
  })
  createOption(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('categoryId') category: string,
    @Param('attributeId') attribute: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertAttributeWriteQuery(req);
    return this.attributes.createOption(
      actor.userId,
      attributeReadId(category),
      attributeReadId(attribute),
      body,
    );
  }

  @Patch(':attributeId/options/:optionId')
  @ApiBody({
    schema: { type: 'object', example: { expectedRevision: 2, sortOrder: 1 } },
  })
  patchOption(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('categoryId') category: string,
    @Param('attributeId') attribute: string,
    @Param('optionId') option: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertAttributeWriteQuery(req);
    return this.attributes.patchOption(
      actor.userId,
      attributeReadId(category),
      attributeReadId(attribute),
      attributeReadId(option),
      body,
    );
  }
}
