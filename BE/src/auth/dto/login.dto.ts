import { IsEmail, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BcryptPassword } from '../password-policy.js';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(72)
  @BcryptPassword(1)
  password!: string;
}
