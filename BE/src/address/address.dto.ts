import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Vietnamese mobile number, format check only (not ownership verification):
 * separators removed, +84 rewritten to 0, then 0 + 3/5/7/8/9 + 8 digits.
 * Existing stored addresses are never rewritten.
 */
export const VN_MOBILE = /^0[35789][0-9]{8}$/;
export function normalizeVnPhone(value: unknown): unknown {
  if (typeof value !== 'string' || value.length > 20) return value;
  const compact = value.trim().replace(/[ .()-]/g, '');
  return /^\+84[0-9]+$/.test(compact) ? '0' + compact.slice(3) : compact;
}

// Text fields are required only for a legacy (code-less) address. With codes,
// names come from the active catalogue and any text sent is ignored.
const withoutCodes = (o: { provinceCode?: unknown; wardCode?: unknown }) =>
  o.provinceCode === undefined && o.wardCode === undefined;

export class CreateAddressDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  recipientName!: string;

  @ApiProperty({
    example: '0901234567',
    description:
      'Vietnamese mobile: 0 or +84 followed by 3/5/7/8/9 and 8 digits; spaces/dots/dashes allowed. Stored as 0xxxxxxxxx. Format check only.',
  })
  @Transform(({ value }) => normalizeVnPhone(value))
  @IsString()
  @Matches(VN_MOBILE, { message: 'phone must be a Vietnamese mobile number' })
  phone!: string;

  @ApiPropertyOptional({
    example: '01',
    description:
      'Province code from GET /locations/provinces. Send together with wardCode; names are then taken from the catalogue.',
  })
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^[0-9]{2}$/)
  provinceCode?: string;

  @ApiPropertyOptional({
    example: '00004',
    description: 'Ward/commune code belonging to provinceCode.',
  })
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^[0-9]{5}$/)
  wardCode?: string;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 100,
    description: 'Required only without provinceCode/wardCode (legacy text).',
  })
  @Transform(trim)
  @ValidateIf((o, value) => withoutCodes(o) || value !== undefined)
  @IsString()
  @Length(1, 100)
  province!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: 100,
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 100)
  district?: string | null;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 100,
    description: 'Required only without provinceCode/wardCode (legacy text).',
  })
  @Transform(trim)
  @ValidateIf((o, value) => withoutCodes(o) || value !== undefined)
  @IsString()
  @Length(1, 100)
  ward!: string;

  @ApiProperty({ minLength: 1, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  addressLine!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: 20,
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 20)
  postalCode?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: 500,
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 500)
  deliveryNote?: string | null;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  isDefault?: boolean;
}

// Only omitted fields are optional. Mandatory fields explicitly set to null fail.
export class UpdateAddressDto extends PartialType(CreateAddressDto, {
  skipNullProperties: false,
}) {}

export class AddressResponseDto {
  @ApiProperty() id!: number;
  @ApiProperty() recipientName!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() province!: string;
  @ApiProperty({ type: String, nullable: true }) district!: string | null;
  @ApiProperty() ward!: string;
  @ApiProperty() addressLine!: string;
  @ApiProperty({ type: String, nullable: true }) postalCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) deliveryNote!: string | null;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty({ type: String, nullable: true, example: '01' })
  provinceCode!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '00004' })
  wardCode!: string | null;
  @ApiProperty({
    enum: ['STANDARD', 'OUTDATED', 'LEGACY_FREE_TEXT'],
    description:
      'STANDARD = codes from the active catalogue; OUTDATED = codes from an older catalogue; LEGACY_FREE_TEXT = typed text, not verified. Legacy/outdated addresses remain usable; ask the buyer to re-select.',
  })
  divisionStatus!: 'STANDARD' | 'OUTDATED' | 'LEGACY_FREE_TEXT';
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class AddressListDto {
  @ApiProperty({ type: [AddressResponseDto] }) items!: AddressResponseDto[];
}

// PUT default is a command with no client-controlled owner or state fields.
export class AddressDefaultCommandDto {}

export class AddressErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty({ example: 'ADDRESS_NOT_FOUND' }) code!: string;
  @ApiProperty() message!: string;
}
