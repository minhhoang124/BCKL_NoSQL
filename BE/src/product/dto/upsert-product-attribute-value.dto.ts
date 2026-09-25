import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertProductAttributeValueDto {
  @ApiPropertyOptional({ minimum: 1, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  optionId?: number | null;

  @ApiPropertyOptional({ maxLength: 2_000, nullable: true })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2_000)
  textValue?: string | null;

  @ApiPropertyOptional({ example: '6.5000', nullable: true })
  @IsOptional()
  @IsNumberString()
  numberValue?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsBoolean()
  booleanValue?: boolean | null;
}
