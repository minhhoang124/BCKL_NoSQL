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

export class CreateAddressDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  recipientName!: string;

  @ApiProperty({ minLength: 8, maxLength: 20, example: '0901234567' })
  @Transform(trim)
  @IsString()
  @Length(8, 20)
  @Matches(/^[0-9+() .-]+$/)
  @Matches(/^(?:[^0-9]*[0-9]){8,15}[^0-9]*$/)
  phone!: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(trim)
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

  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(trim)
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
