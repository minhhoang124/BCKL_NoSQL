import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class SearchHybridQueryDto {
  @ApiProperty({
    description: 'Search query text',
    example: 'tai nghe bluetooth',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  query!: string;

  @ApiPropertyOptional({
    description: 'Filter by category IDs (OR within list)',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  @Type(() => Number)
  categoryIds?: number[];

  @ApiPropertyOptional({
    description: 'Filter by brand IDs (OR within list)',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  @Type(() => Number)
  brandIds?: number[];

  @ApiPropertyOptional({ description: 'Minimum price filter', example: 500000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minPrice?: number;

  @ApiPropertyOptional({
    description: 'Maximum price filter',
    example: 2000000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Filter in-stock products only' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  inStock?: boolean;

  @ApiPropertyOptional({
    description: 'Number of final results to return',
    minimum: 1,
    maximum: 50,
    default: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  topK?: number;

  @ApiPropertyOptional({
    description: 'Number of candidates for RRF (must be >= topK)',
    minimum: 1,
    maximum: 150,
    default: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(150)
  @Type(() => Number)
  candidateK?: number;
}
