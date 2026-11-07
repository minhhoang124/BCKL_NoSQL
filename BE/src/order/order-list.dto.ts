import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus, PaymentProvider, PaymentStatus } from '@prisma/client';

export class OrderListQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 50, default: 20 })
  limit?: number;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 2147483647 })
  afterId?: number;
  @ApiPropertyOptional({ enum: OrderStatus })
  status?: OrderStatus;
}

class OrderListStoreDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
}
class OrderListPaymentDto {
  @ApiProperty({ enum: PaymentProvider }) provider!: PaymentProvider;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty({ example: '10000.00' }) amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt!: string | null;
}
export class OrderListItemPreviewDto {
  @ApiProperty() orderItemId!: number;
  @ApiProperty() productId!: number;
  @ApiProperty() variantId!: number;
  @ApiProperty({ description: 'Product name snapshot at purchase.' })
  productName!: string;
  @ApiProperty({
    type: [String],
    nullable: true,
    example: ['Black'],
    description:
      'Option snapshot at purchase; null only when the saved snapshot is unreadable (never live catalog data).',
  })
  options!: string[] | null;
  @ApiProperty() quantity!: number;
  @ApiProperty({ example: '10000.00', description: 'Unit price at purchase.' })
  unitPrice!: string;
  @ApiProperty({ example: '20000.00' }) lineTotal!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Current illustrative image of the Product, not a purchase snapshot; null when unavailable.',
  })
  imageUrl!: string | null;
}
export class OrderListItemDto {
  @ApiProperty() id!: number;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ type: OrderListStoreDto }) store!: OrderListStoreDto;
  @ApiProperty({ example: '10000.00' }) total!: string;
  @ApiProperty({ type: OrderListPaymentDto, nullable: true })
  payment!: OrderListPaymentDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({
    type: [OrderListItemPreviewDto],
    description: 'At most 3 lines, ordered by order item id ascending.',
  })
  itemPreview!: OrderListItemPreviewDto[];
  @ApiProperty({ description: 'Total number of lines in the order.' })
  itemCount!: number;
  @ApiProperty({ description: 'Sum of quantities over all lines.' })
  totalQuantity!: number;
  @ApiProperty({ description: 'True when itemCount > itemPreview.length.' })
  hasMoreItems!: boolean;
}
export class OrderListResponseDto {
  @ApiProperty({ type: [OrderListItemDto] }) items!: OrderListItemDto[];
  @ApiProperty({ type: Number, nullable: true }) nextCursor!: number | null;
}
export class OrderListErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
}
