import { Prisma } from '@prisma/client';
import { checkoutError, invalidCheckout } from './checkout-error.js';

export const MAX_CHECKOUT_MONEY = new Prisma.Decimal('999999999999.00');
const VND_INPUT = /^[1-9][0-9]*(?:\.00)?$/;

export function checkedMoney(
  value: Prisma.Decimal,
  positive = false,
): Prisma.Decimal {
  if (
    !value.isFinite() ||
    !value.isInteger() ||
    value.lt(0) ||
    (positive && value.isZero())
  )
    invalidCheckout();
  if (value.gt(MAX_CHECKOUT_MONEY))
    throw checkoutError(400, 'VALIDATION_ERROR', 'Số tiền vượt giới hạn.', {
      reason: 'MONEY_LIMIT_EXCEEDED',
    });
  return value;
}

export function parseExpectedUnitPrice(input: unknown): Prisma.Decimal {
  if (typeof input !== 'string' || !VND_INPUT.test(input)) invalidCheckout();
  // Avoid constructing a Decimal from arbitrarily large, syntactically valid
  // input; all prices in this contract have at most 12 whole-dong digits.
  const integerPart = input.split('.')[0];
  if (integerPart.length > 12)
    throw checkoutError(400, 'VALIDATION_ERROR', 'Số tiền vượt giới hạn.', {
      reason: 'MONEY_LIMIT_EXCEEDED',
    });
  return checkedMoney(new Prisma.Decimal(input), true);
}

export function checkedLineTotal(
  unitPrice: Prisma.Decimal,
  quantity: number,
): Prisma.Decimal {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99)
    invalidCheckout();
  return checkedMoney(checkedMoney(unitPrice, true).mul(quantity), true);
}

export function checkedSubtotal(
  amounts: readonly Prisma.Decimal[],
): Prisma.Decimal {
  return amounts.reduce(
    (sum, amount) => checkedMoney(sum.add(checkedMoney(amount))),
    new Prisma.Decimal(0),
  );
}
