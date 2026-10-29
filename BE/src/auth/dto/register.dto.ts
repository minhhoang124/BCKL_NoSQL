import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BcryptPassword } from '../password-policy.js';

export enum PublicAccountType {
  USER = 'USER',
  SELLER = 'SELLER',
}

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @Length(8, 72)
  @BcryptPassword(8)
  password!: string;

  @ApiPropertyOptional({ example: 'Nguyễn Văn A' })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  fullName?: string;

  @ApiPropertyOptional({
    enum: PublicAccountType,
    default: PublicAccountType.USER,
  })
  @IsOptional()
  @IsEnum(PublicAccountType)
  accountType?: PublicAccountType;
}
