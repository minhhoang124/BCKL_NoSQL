import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class PutCartItemDto {
  @ApiProperty({ minimum: 1, maximum: 99, example: 2, type: 'integer' })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;
}

// An explicit empty DTO makes unsupported query/body fields fail validation.
export class EmptyCartDto {}

export class CartItemResponseDto {
  @ApiProperty({ type: 'integer' })
  variantId!: number;
  @ApiProperty({ type: 'integer' })
  quantity!: number;
  @ApiProperty()
  available!: boolean;
  @ApiProperty({
    nullable: true,
    enum: [
      'PRODUCT_UNAVAILABLE',
      'VARIANT_UNAVAILABLE',
      'OUT_OF_STOCK',
      'INSUFFICIENT_STOCK',
    ],
  })
  unavailableReason!: string | null;
  @ApiPropertyOptional({ type: 'integer' })
  productId?: number;
  @ApiPropertyOptional()
  productName?: string;
  @ApiPropertyOptional()
  imageUrl?: string;
  @ApiPropertyOptional({ type: [String] })
  optionValues?: string[];
  @ApiPropertyOptional({ example: '1290000.00', type: String })
  currentUnitPrice?: string;
  @ApiPropertyOptional({ type: 'integer', minimum: 0 })
  stock?: number;
}

export class CartStoreDto {
  @ApiProperty({ type: 'integer' })
  id!: number;
  @ApiProperty()
  name!: string;
}

export class CartGroupDto {
  @ApiProperty({ type: CartStoreDto })
  store!: CartStoreDto;
  @ApiProperty({ type: [CartItemResponseDto] })
  items!: CartItemResponseDto[];
  @ApiProperty({ example: '2580000.00' })
  purchasableSubtotal!: string;
}

export class CartResponseDto {
  @ApiProperty({ type: [CartGroupDto] })
  groups!: CartGroupDto[];
  @ApiProperty({
    type: [CartItemResponseDto],
    description:
      'Private products: only variantId, quantity, available and unavailableReason.',
  })
  unavailableItems!: CartItemResponseDto[];
  @ApiProperty({ type: 'integer', minimum: 0 })
  lineCount!: number;
  @ApiProperty({ type: 'integer', minimum: 0 })
  totalQuantity!: number;
  @ApiProperty({ example: '2580000.00' })
  purchasableSubtotal!: string;
}

export class CartErrorDto {
  @ApiProperty()
  statusCode!: number;
  @ApiProperty()
  code!: string;
  @ApiProperty()
  message!: string;
}
