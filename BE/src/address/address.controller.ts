import { BuyerAccess } from '../auth/buyer-access.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiParam,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import {
  AddressListDto,
  AddressDefaultCommandDto,
  AddressErrorDto,
  AddressResponseDto,
  CreateAddressDto,
  UpdateAddressDto,
} from './address.dto.js';
import { AddressExceptionFilter, AddressIdPipe } from './address-http.js';
import { AddressService } from './address.service.js';

@ApiTags('buyer-address')
@ApiBearerAuth()
@ApiBadRequestResponse({
  type: AddressErrorDto,
  description: 'VALIDATION_ERROR',
})
@ApiUnauthorizedResponse({ type: AddressErrorDto })
@ApiForbiddenResponse({ type: AddressErrorDto })
@UseGuards(JwtAuthGuard, RolesGuard)
@BuyerAccess()
@Roles(Role.USER)
@UseFilters(AddressExceptionFilter)
@Controller('me/addresses')
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AddressListDto })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.addresses.list(user.userId);
  }

  @Post()
  @ApiConflictResponse({
    type: AddressErrorDto,
    description: 'ADDRESS_LIMIT_REACHED hoặc ADDRESS_WRITE_CONFLICT',
  })
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ type: AddressResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAddressDto,
  ) {
    return this.addresses.create(user.userId, dto);
  }

  @Patch(':addressId')
  @ApiParam({
    name: 'addressId',
    schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
  })
  @ApiNotFoundResponse({ type: AddressErrorDto })
  @ApiConflictResponse({
    type: AddressErrorDto,
    description: 'DEFAULT_ADDRESS_CANNOT_BE_UNSET hoặc ADDRESS_WRITE_CONFLICT',
  })
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AddressResponseDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId', AddressIdPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addresses.update(user.userId, Number(id), dto);
  }

  @Put(':addressId/default')
  @ApiParam({
    name: 'addressId',
    schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
  })
  @ApiNotFoundResponse({ type: AddressErrorDto })
  @ApiConflictResponse({ type: AddressErrorDto })
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AddressResponseDto })
  setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId', AddressIdPipe) id: string,
    @Body() dto: AddressDefaultCommandDto,
  ) {
    void dto;
    return this.addresses.setDefault(user.userId, Number(id));
  }

  @Delete(':addressId')
  @ApiParam({
    name: 'addressId',
    schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
  })
  @ApiNotFoundResponse({ type: AddressErrorDto })
  @ApiConflictResponse({ type: AddressErrorDto })
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('addressId', AddressIdPipe) id: string,
  ) {
    return this.addresses.remove(user.userId, Number(id));
  }
}
