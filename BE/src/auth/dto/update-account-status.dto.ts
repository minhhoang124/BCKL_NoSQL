import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAccountStatusDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}
