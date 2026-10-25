import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsString, Min, Max } from 'class-validator';

export class UpdateAccountStatusDto {
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
