import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class CreateProductVariantDto {
  @ApiProperty({ example: '199000.00' })
  @IsNumberString()
  price!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiPropertyOptional({ minLength: 1, maxLength: 80, nullable: true })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 80)
  sellerSku?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [Number], default: [] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  optionValueIds?: number[];
}
