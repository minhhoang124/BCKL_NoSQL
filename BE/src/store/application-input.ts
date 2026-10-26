import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
export type ApplicationScope = 'OWNER' | 'ADMIN';
export type ApplicationAction = 'submit' | 'edit' | 'resubmit' | 'review';
export type ApplicationBody = Record<string, string | number | boolean>;
export const profileKeys = [
  'name',
  'description',
  'contactName',
  'contactPhone',
  'pickupAddress',
  'returnAddress',
] as const;
export const onboardingEnabled = () =>
  process.env.SELLER_ONBOARDING_ENABLED === 'true';
export function invalid(): never {
  throw new BadRequestException({ code: 'STORE_APPLICATION_INVALID_INPUT' });
}
export function positive(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    return invalid();
  return value;
}
export function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cs}]/u.test(value))
    return invalid();
  const result = value.normalize('NFC').trim();
  if ([...result].length < min || [...result].length > max) return invalid();
  return result;
}
export function object(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    return invalid();
  return value as Record<string, unknown>;
}
export function commandId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    return invalid();
  return value;
}
export function validAction(
  scope: ApplicationScope,
  action: string,
): asserts action is ApplicationAction {
  if (
    !(scope === 'ADMIN'
      ? action === 'review'
      : ['submit', 'edit', 'resubmit'].includes(action))
  )
    invalid();
}
export function applicationInput(
  scope: ApplicationScope,
  action: ApplicationAction,
  value: unknown,
) {
  validAction(scope, action);
  const row = object(value, [
    'commandId',
    'confirmed',
    'reason',
    ...(action === 'submit' ? [] : ['expectedRevision']),
    ...(action === 'submit' || action === 'edit' ? [...profileKeys] : []),
    ...(action === 'review' ? ['status'] : []),
  ]);
  if (row.confirmed !== true) return invalid();
  // Fixed insertion order is the fingerprint v1 wire contract.
  const body: ApplicationBody = {
    confirmed: true,
    reason: text(row.reason, 10, 500),
  };
  if (action !== 'submit')
    body.expectedRevision = positive(row.expectedRevision);
  if (action === 'submit' || action === 'edit') {
    body.name = text(row.name, 3, 120);
    body.description = text(row.description, 0, 1000);
    body.contactName = text(row.contactName, 2, 100);
    body.contactPhone = text(row.contactPhone, 9, 16);
    if (!/^\+?[0-9]{9,15}$/.test(String(body.contactPhone))) return invalid();
    body.pickupAddress = text(row.pickupAddress, 10, 500);
    body.returnAddress = text(row.returnAddress, 10, 500);
  }
  if (action === 'review') {
    if (
      typeof row.status !== 'string' ||
      !['ACTIVE', 'REJECTED', 'SUSPENDED'].includes(row.status)
    )
      return invalid();
    body.status = row.status;
  }
  return { commandId: commandId(row.commandId), body };
}
export function applicationHash(
  scope: ApplicationScope,
  action: ApplicationAction,
  targetId: number,
  body: ApplicationBody,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 1,
        scope,
        action,
        targetId: positive(targetId),
        body,
      }),
    )
    .digest('hex');
}
export function reconcileInput(value: unknown) {
  const row = object(value, ['commandId', 'requestHash', 'confirmed']);
  if (
    row.confirmed !== true ||
    typeof row.requestHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(row.requestHash)
  )
    return invalid();
  return { commandId: commandId(row.commandId), requestHash: row.requestHash };
}
export function applicationQuery(url: string, cursorKey = 'afterId') {
  const params = new URL(url, 'http://localhost').searchParams;
  for (const key of params.keys())
    if (!['limit', cursorKey].includes(key) || params.getAll(key).length !== 1)
      return invalid();
  const read = (key: string, max: number) => {
    const raw = params.get(key);
    if (raw === null) return undefined;
    if (!/^[1-9][0-9]*$/.test(raw)) return invalid();
    const n = positive(Number(raw));
    if (n > max) return invalid();
    return n;
  };
  return {
    limit: read('limit', 50) ?? 20,
    cursor: read(cursorKey, 2147483647),
  };
}
