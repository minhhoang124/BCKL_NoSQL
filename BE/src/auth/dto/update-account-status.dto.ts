import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsString,
  Min,
  Max,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class UpdateAccountStatusDto {
  @ApiPropertyOptional({
    description: 'UUIDv4 required for durable Web commands and reconciliation.',
  })
  @IsOptional()
  @IsUUID('4')
  commandId?: string;
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;

  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedRevision!: number;

  @ApiProperty({
    description: 'NFC trim, 10–500 Unicode code points, no forbidden controls.',
  })
  @IsString()
  reason!: string;
}
