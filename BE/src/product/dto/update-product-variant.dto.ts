import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const MAX_UPDATABLE_PRODUCT_VERSION = 2_147_483_646;
export const MAX_PG_INT = 2_147_483_647;
export const MAX_VARIANT_EDIT_REASON_LENGTH = 500;

/**
 * Positive VND whole-unit decimal string:
 * - 1..12 integer digits with at least one non-zero digit
 * - optional exact `.00` fractional suffix
 * - no sign, no scientific notation, no fractional cent/dong values
 */
export const POSITIVE_VND_PRICE_REGEX = /^(?!0+(?:\.00)?$)\d{1,12}(?:\.00)?$/;

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateProductVariantDto {
  @IsInt()
  @Min(1)
  @Max(MAX_UPDATABLE_PRODUCT_VERSION)
  expectedProductVersion!: number;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @Matches(POSITIVE_VND_PRICE_REGEX, {
    message:
      'expectedPrice must be a positive whole VND decimal string (up to 12 integer digits, optional .00)',
  })
  expectedPrice!: string;

  @IsInt()
  @Min(0)
  @Max(MAX_PG_INT)
  expectedStock!: number;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @Matches(POSITIVE_VND_PRICE_REGEX, {
    message:
      'price must be a positive whole VND decimal string (up to 12 integer digits, optional .00)',
  })
  price!: string;

  @IsInt()
  @Min(0)
  @Max(MAX_PG_INT)
  stock!: number;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_VARIANT_EDIT_REASON_LENGTH)
  reason!: string;
}
