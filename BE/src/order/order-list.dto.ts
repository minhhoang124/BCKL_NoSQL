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
