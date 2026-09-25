import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class ProductVersionDto {
  @ApiProperty({
    minimum: 1,
    description: 'Version displayed when the actor reviewed the Product',
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  version!: number;
}

export class ProductDecisionDto extends ProductVersionDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 1000)
  reason!: string;
}

export class ProductVisibilityDto extends ProductVersionDto {
  @ApiProperty({ enum: ['ACTIVE', 'HIDDEN'] })
  @IsIn(['ACTIVE', 'HIDDEN'])
  sellerStatus!: 'ACTIVE' | 'HIDDEN';
}

export class ProductPageDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Exclusive ascending Product ID cursor',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  afterId?: number;
}

export class PublicProductQueryDto extends ProductPageDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  categoryId?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  storeId?: number;
}
