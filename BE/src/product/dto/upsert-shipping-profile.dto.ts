import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumberString, IsOptional, Min } from 'class-validator';

export class UpsertShippingProfileDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  packageWeightGrams!: number;

  @ApiPropertyOptional({ example: '20.00' })
  @IsOptional()
  @IsNumberString()
  packageLengthCm?: string | null;

  @ApiPropertyOptional({ example: '15.00' })
  @IsOptional()
  @IsNumberString()
  packageWidthCm?: string | null;

  @ApiPropertyOptional({ example: '10.00' })
  @IsOptional()
  @IsNumberString()
  packageHeightCm?: string | null;
}
