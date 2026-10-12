import { ApiProperty } from '@nestjs/swagger';
import {
  OrderActorType,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
} from '@prisma/client';

class OrderDetailStoreDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
}
class OrderShippingAddressDto {
  @ApiProperty() recipientName!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() province!: string;
  @ApiProperty({ type: String, nullable: true }) district!: string | null;
  @ApiProperty() ward!: string;
  @ApiProperty() addressLine!: string;
  @ApiProperty({ type: String, nullable: true }) postalCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) deliveryNote!: string | null;
}
class OrderDetailItemDto {
  @ApiProperty() id!: number;
  @ApiProperty() productId!: number;
  @ApiProperty() variantId!: number;
  @ApiProperty() productName!: string;
  @ApiProperty() sku!: string;
  @ApiProperty({ type: [String], example: ['Black'] }) options!: string[];
  @ApiProperty({ example: '10000.00' }) unitPrice!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ example: '20000.00' }) lineTotal!: string;
}
class OrderDetailPaymentDto {
  @ApiProperty({ enum: PaymentProvider }) provider!: PaymentProvider;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty({ example: '20000.00' }) amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt!: string | null;
}
class OrderCancellationActorDto {
  @ApiProperty({ enum: OrderActorType, nullable: true })
  type!: OrderActorType | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Hidden outside the actor allowlist.',
  })
  id!: number | null;
}
class OrderCancellationDto {
  @ApiProperty({ type: OrderCancellationActorDto })
  cancelledBy!: OrderCancellationActorDto;
  @ApiProperty({ type: String, nullable: true }) reasonCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) reasonText!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: string | null;
}
class OrderTimelineDto {
  @ApiProperty({ enum: OrderStatus, nullable: true })
  fromStatus!: OrderStatus | null;
  @ApiProperty({ enum: OrderStatus }) toStatus!: OrderStatus;
  @ApiProperty({ enum: OrderActorType, nullable: true })
  actorType!: OrderActorType | null;
  @ApiProperty({ type: Number, nullable: true }) actorId!: number | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, nullable: true }) reasonCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) reasonText!: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) restockable!: boolean | null;
  @ApiProperty({ type: String, nullable: true }) receiptReference!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) trackingReference!:
    string | null;
  @ApiProperty({ type: Number, nullable: true }) deliveryAttempt!:
    number | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class OrderDetailResponseDto {
  @ApiProperty() id!: number;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ type: OrderDetailStoreDto }) store!: OrderDetailStoreDto;
  @ApiProperty({ type: OrderShippingAddressDto })
  shippingAddress!: OrderShippingAddressDto;
  @ApiProperty({ type: [OrderDetailItemDto] }) items!: OrderDetailItemDto[];
  @ApiProperty({ example: '20000.00' }) subtotal!: string;
  @ApiProperty({ example: '0.00' }) shippingFee!: string;
  @ApiProperty({ example: '0.00' }) discountTotal!: string;
  @ApiProperty({ example: '20000.00' }) total!: string;
  @ApiProperty({ type: OrderDetailPaymentDto, nullable: true })
  payment!: OrderDetailPaymentDto | null;
  @ApiProperty({ type: OrderCancellationDto, nullable: true })
  cancellation!: OrderCancellationDto | null;
  @ApiProperty({ type: [OrderTimelineDto] }) timeline!: OrderTimelineDto[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
