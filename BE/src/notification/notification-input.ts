import { BadRequestException } from '@nestjs/common';
export const invalid = (): never => {
  throw new BadRequestException({ code: 'NOTIFICATION_INVALID_INPUT' });
};
export function notificationId(raw: unknown): bigint {
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,18}$/.test(raw))
    return invalid();
  const n = BigInt(raw);
  return n <= 9223372036854775807n ? n : invalid();
}
export function notificationPage(url: string) {
  const params = new URL(url, 'http://local.invalid').searchParams;
  for (const key of params.keys())
    if (
      !['limit', 'beforeId', 'unread'].includes(key) ||
      params.getAll(key).length !== 1
    )
      invalid();
  const l = params.get('limit');
  let limit = 20;
  if (l !== null) {
    if (!/^[1-9][0-9]*$/.test(l) || Number(l) > 50) return invalid();
    limit = Number(l);
  }
  const before = params.get('beforeId'),
    unread = params.get('unread');
  if (unread !== null && !['true', 'false'].includes(unread)) return invalid();
  return {
    limit,
    beforeId: before === null ? null : notificationId(before),
    unread: unread === null ? null : unread === 'true',
  };
}
export function readConsent(raw: unknown) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).join(',') !== 'confirmed' ||
    (raw as { confirmed?: unknown }).confirmed !== true
  )
    return invalid();
}
export function readAllConsent(raw: unknown): bigint {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).sort().join(',') !== 'confirmed,throughId' ||
    (raw as { confirmed?: unknown }).confirmed !== true
  )
    return invalid();
  return notificationId((raw as { throughId?: unknown }).throughId);
}
export function notificationAudiences(
  role: string,
): Array<'ACCOUNT' | 'BUYER' | 'SELLER' | 'ADMIN'> {
  return role === 'ADMIN'
    ? ['ACCOUNT', 'ADMIN']
    : role === 'SELLER'
      ? ['ACCOUNT', 'BUYER', 'SELLER']
      : role === 'USER'
        ? ['ACCOUNT', 'BUYER']
        : [];
}
