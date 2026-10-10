import { HttpException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

export type OrderCommandActor = 'BUYER' | 'SELLER';
export type PreparedOrderCommandName =
  'confirm' | 'start-packing' | 'ready-to-ship' | 'cancel';

export function orderCommandError(status: number, code: string) {
  // Do not include body, key, hash or database details in error responses.
  return new HttpException(
    {
      statusCode: status,
      code,
      message: 'Không thể thực hiện yêu cầu xử lý đơn.',
    },
    status,
  );
}

export function assertOrderCommandActor(
  actor: unknown,
  command: unknown,
): asserts actor is OrderCommandActor {
  if (
    command !== 'confirm' &&
    command !== 'start-packing' &&
    command !== 'ready-to-ship' &&
    command !== 'cancel'
  ) {
    throw orderCommandError(400, 'VALIDATION_ERROR');
  }
  if (
    (actor !== 'BUYER' && actor !== 'SELLER') ||
    (command !== 'cancel' && actor !== 'SELLER')
  ) {
    throw orderCommandError(403, 'FORBIDDEN');
  }
}

/**
 * NEW-command policy only. The runtime caller must authorize ownership, resolve
 * a committed receipt first, then read/lock canonical Order in its transaction.
 * This helper neither authorizes a User nor performs payment/stock mutations.
 */
export function nextOrderCommandStatus(
  actor: OrderCommandActor,
  command: PreparedOrderCommandName,
  currentStatus: OrderStatus,
): OrderStatus {
  assertOrderCommandActor(actor, command);
  if (command === 'cancel') {
    if (
      currentStatus === OrderStatus.PENDING_CONFIRMATION ||
      (actor === 'SELLER' && currentStatus === OrderStatus.CONFIRMED)
    ) {
      return OrderStatus.CANCELLED;
    }
    throw orderCommandError(409, 'ORDER_CANNOT_CANCEL');
  }
  const transitions = {
    confirm: [OrderStatus.PENDING_CONFIRMATION, OrderStatus.CONFIRMED],
    'start-packing': [OrderStatus.CONFIRMED, OrderStatus.PACKING],
    'ready-to-ship': [OrderStatus.PACKING, OrderStatus.READY_TO_SHIP],
  } as const;
  const [from, to] = transitions[command];
  if (currentStatus !== from) {
    throw orderCommandError(409, 'INVALID_ORDER_TRANSITION');
  }
  return to;
}
