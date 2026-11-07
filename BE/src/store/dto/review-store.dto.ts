import { ApiProperty } from '@nestjs/swagger';
import { StoreStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

const ADMIN_STORE_STATUSES = [
  StoreStatus.ACTIVE,
  StoreStatus.REJECTED,
  StoreStatus.SUSPENDED,
] as const;

export class ReviewStoreDto {
  @ApiProperty({ enum: ADMIN_STORE_STATUSES })
  @IsIn(ADMIN_STORE_STATUSES)
  status!: StoreStatus;

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
