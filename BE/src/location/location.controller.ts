import { Controller, Get, Header, Module, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { DatabaseModule } from '../database.module.js';
import { PrismaService } from '../prisma.service.js';
import {
  activeCatalogVersion,
  locationError,
  PROVINCE_CODE,
} from './location-catalog.js';

class CatalogVersionDto {
  @ApiProperty() id!: number;
  @ApiProperty({ example: 'QĐ 19/2025/QĐ-TTg' }) sourceRef!: string;
  @ApiProperty({ example: '2025-07-01' }) effectiveDate!: string;
}
class DivisionDto {
  @ApiProperty({ example: '01' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['THANH_PHO', 'TINH', 'PHUONG', 'XA', 'DAC_KHU'] })
  kind!: string;
}
class ProvinceListDto {
  @ApiProperty({ type: CatalogVersionDto }) version!: CatalogVersionDto;
  @ApiProperty({ type: [DivisionDto] }) items!: DivisionDto[];
}
class WardListDto extends ProvinceListDto {
  @ApiProperty({ type: DivisionDto }) province!: DivisionDto;
}

function noQuery(query: unknown) {
  if (!query || typeof query !== 'object' || Object.keys(query).length)
    throw locationError(400, 'VALIDATION_ERROR', 'Không nhận tham số lọc.');
}

/** Public, read-only catalogue for address pickers. Names/codes only. */
@ApiTags('locations')
@Controller('locations')
export class LocationController {
  constructor(private readonly prisma: PrismaService) {}

  private read<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
        return fn(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 2000,
        timeout: 5000,
      },
    );
  }

  private async version(tx: Prisma.TransactionClient) {
    const version = await activeCatalogVersion(tx);
    if (!version)
      throw locationError(
        503,
        'LOCATION_CATALOG_NOT_LOADED',
        'Danh mục địa giới chưa sẵn sàng. Vui lòng thử lại sau.',
      );
    return version;
  }

  @Get('provinces')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOkResponse({ type: ProvinceListDto })
  provinces(@Query() query: unknown) {
    noQuery(query);
    return this.read(async (tx) => {
      const version = await this.version(tx);
      const items = await tx.adminProvince.findMany({
        where: { versionId: version.id },
        select: { code: true, name: true, kind: true },
        orderBy: { code: 'asc' },
      });
      return { version, items };
    });
  }

  @Get('provinces/:provinceCode/wards')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiParam({ name: 'provinceCode', example: '01' })
  @ApiOkResponse({ type: WardListDto })
  wards(@Param('provinceCode') provinceCode: string, @Query() query: unknown) {
    noQuery(query);
    if (!PROVINCE_CODE.test(provinceCode))
      throw locationError(400, 'VALIDATION_ERROR', 'Mã tỉnh/thành không hợp lệ.');
    return this.read(async (tx) => {
      const version = await this.version(tx);
      const province = await tx.adminProvince.findUnique({
        where: { versionId_code: { versionId: version.id, code: provinceCode } },
        select: { code: true, name: true, kind: true },
      });
      if (!province)
        throw locationError(
          404,
          'PROVINCE_NOT_FOUND',
          'Không tìm thấy tỉnh/thành.',
        );
      const items = await tx.adminWard.findMany({
        where: { versionId: version.id, provinceCode },
        select: { code: true, name: true, kind: true },
        orderBy: { code: 'asc' },
      });
      return { version, province, items };
    });
  }
}

@Module({
  imports: [DatabaseModule],
  controllers: [LocationController],
})
export class LocationModule {}
