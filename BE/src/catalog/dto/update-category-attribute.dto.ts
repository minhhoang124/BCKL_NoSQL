import { ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryAttributeDataType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class UpdateCategoryAttributeDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 120 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ enum: CategoryAttributeDataType })
  @IsOptional()
  @IsEnum(CategoryAttributeDataType)
  dataType?: CategoryAttributeDataType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowsCustom?: boolean;
}
