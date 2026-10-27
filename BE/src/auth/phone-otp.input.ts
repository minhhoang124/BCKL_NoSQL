import { BadRequestException } from '@nestjs/common';
const invalid = (): never => {
  throw new BadRequestException({ code: 'PHONE_OTP_INVALID_INPUT' });
};
function exact(raw: unknown, keys: string[]) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.getPrototypeOf(raw) !== Object.prototype
  )
    return invalid();
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    value.confirmed !== true
  )
    return invalid();
  return value;
}
export function phoneOtpRequest(raw: unknown) {
  const x = exact(raw, ['phoneNumber', 'expectedVersion', 'confirmed']);
  // Sandbox workflow uses a bounded canonical international representation.
  // It does not prove that a number is assigned, reachable or owned in reality.
  if (
    typeof x.phoneNumber !== 'string' ||
    !/^\+[1-9][0-9]{7,14}$/.test(x.phoneNumber) ||
    typeof x.expectedVersion !== 'number' ||
    !Number.isInteger(x.expectedVersion) ||
    x.expectedVersion < 0 ||
    x.expectedVersion > 2147483647
  )
    return invalid();
  return { phoneNumber: x.phoneNumber, expectedVersion: x.expectedVersion };
}
export function phoneOtpConfirmation(raw: unknown) {
  const x = exact(raw, ['challengeId', 'code', 'confirmed']);
  if (
    typeof x.challengeId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      x.challengeId,
    ) ||
    typeof x.code !== 'string' ||
    !/^[0-9]{6}$/.test(x.code)
  )
    return invalid();
  return { challengeId: x.challengeId.toLowerCase(), code: x.code };
}
export function phoneOtpReconciliation(raw: unknown) {
  const x = exact(raw, ['challengeId', 'confirmed']);
  return {
    challengeId: phoneOtpConfirmation({ ...x, code: '000000' }).challengeId,
  };
}
