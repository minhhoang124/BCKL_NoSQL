import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Documentation DTOs. Controllers deliberately accept unknown and use the
// strict shared normalizer; no implicit transform/whitelist may change the hash input.
export class CheckoutItemDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  variantId!: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 99 })
  quantity!: number;
  @ApiProperty({
    type: String,
    pattern: '^[1-9][0-9]*(?:\\.00)?$',
    example: '1290000.00',
    description: 'VND nguyên đồng, tối đa 999999999999.00',
  })
  expectedUnitPrice!: string;
}
export class CheckoutPreviewRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  addressId!: number;
  @ApiProperty({ enum: ['COD'] })
  paymentProvider!: 'COD';
  @ApiProperty({
    type: [CheckoutItemDto],
    minItems: 1,
    maxItems: 50,
    description:
      'variantId không trùng; quantity bằng CartItem của Buyer. Reject mọi trường thừa.',
  })
  items!: CheckoutItemDto[];
}
export class CheckoutErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
  @ApiPropertyOptional({ type: Object }) details?: object;
}
export class CheckoutPreviewItemDto extends CheckoutItemDto {
  @ApiProperty({ example: '1290000.00' }) unitPrice!: string;
  @ApiProperty({ example: '2580000.00' }) lineTotal!: string;
  @ApiProperty({
    type: [String],
    enum: ['INSUFFICIENT_STOCK', 'PRICE_CHANGED'],
    description: 'Tối đa một lỗi, ưu tiên stock trước price',
  })
  errors!: string[];
}
export class CheckoutUnavailableDto {
  @ApiProperty({ type: 'integer' }) variantId!: number;
  @ApiProperty({ type: 'integer' }) quantity!: number;
  @ApiProperty({ type: [String], enum: ['VARIANT_NOT_AVAILABLE'] }) errors!: [
    'VARIANT_NOT_AVAILABLE',
  ];
}
export class CheckoutStoreDto {
  @ApiProperty({ type: 'integer' }) id!: number;
  @ApiProperty() name!: string;
}
export class CheckoutPreviewGroupDto {
  @ApiProperty({ type: CheckoutStoreDto }) store!: CheckoutStoreDto;
  @ApiProperty({ type: [CheckoutPreviewItemDto] })
  items!: CheckoutPreviewItemDto[];
  @ApiProperty({ type: String, nullable: true }) subtotal!: string | null;
  @ApiProperty({ type: String, nullable: true }) shippingFee!: string | null;
  @ApiProperty({ type: String, nullable: true }) discountTotal!: string | null;
  @ApiProperty({ type: String, nullable: true }) total!: string | null;
}
export class CheckoutTotalsDto {
  @ApiProperty() subtotal!: string;
  @ApiProperty({ enum: ['0.00'] }) shippingFee!: string;
  @ApiProperty({ enum: ['0.00'] }) discountTotal!: string;
  @ApiProperty() total!: string;
}
export class CheckoutPreviewResponseDto {
  @ApiProperty() canCheckout!: boolean;
  @ApiProperty({ enum: ['COD'] }) paymentProvider!: string;
  @ApiProperty({ enum: ['VND'] }) currency!: string;
  @ApiProperty({ enum: ['DEMO_ZERO_V1'] }) shippingMode!: string;
  @ApiProperty({ type: [CheckoutPreviewGroupDto] })
  groups!: CheckoutPreviewGroupDto[];
  @ApiProperty({ type: [CheckoutUnavailableDto] })
  unavailableItems!: CheckoutUnavailableDto[];
  @ApiProperty({ type: CheckoutTotalsDto, nullable: true })
  totals!: CheckoutTotalsDto | null;
}
export class CheckoutReceiptPaymentDto {
  @ApiProperty({ enum: ['COD'] }) provider!: string;
  @ApiProperty({ enum: ['UNPAID'] }) status!: string;
  @ApiProperty() amount!: string;
  @ApiProperty({ enum: ['VND'] }) currency!: string;
}
export class CheckoutReceiptOrderDto {
  @ApiProperty({ type: 'integer' }) id!: number;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ type: 'integer' }) storeId!: number;
  @ApiProperty({ enum: ['PENDING_CONFIRMATION'] }) status!: string;
  @ApiProperty({ type: CheckoutReceiptPaymentDto })
  payment!: CheckoutReceiptPaymentDto;
  @ApiProperty() total!: string;
}
export class CheckoutLookupResponseDto {
  @ApiProperty({ type: 'integer' }) checkoutId!: number;
  @ApiProperty({ enum: ['COMPLETED'] }) status!: string;
  @ApiProperty({ type: Boolean, enum: [true] }) replayed!: true;
  @ApiProperty({ type: [CheckoutReceiptOrderDto] })
  orders!: CheckoutReceiptOrderDto[];
}
export class CheckoutCreateResponseDto {
  @ApiProperty({ type: 'integer' }) checkoutId!: number;
  @ApiProperty({ enum: ['COMPLETED'] }) status!: string;
  @ApiProperty({ type: Boolean }) replayed!: boolean;
  @ApiProperty({ type: [CheckoutReceiptOrderDto] })
  orders!: CheckoutReceiptOrderDto[];
}
