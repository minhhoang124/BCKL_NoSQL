import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ReturnAction, ReturnKind } from './aftersales-policy.js';
export type Scope = 'BUYER' | 'SELLER' | 'ADMIN';
export type Action = ReturnAction | 'create';
export type Command = {
  commandId: string;
  body: Record<string, string | number | boolean>;
};
const bad = (): never => {
  throw new BadRequestException({ code: 'AFTERSALE_INVALID_INPUT' });
};
export function positiveId(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 2147483647) return bad();
  return value;
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    return bad();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    return bad();
  return value;
}
export function reason(value: unknown): string {
  if (
    typeof value !== 'string' ||
    /[\p{Cc}\p{Cs}]/u.test(value.replace(/[\t\n\r]/g, ''))
  )
    return bad();
  const normalized = value.normalize('NFC').trim();
  if ([...normalized].length < 10 || [...normalized].length > 1000)
    return bad();
  return normalized;
}
export function commandInput(action: Action, value: unknown): Command {
  if (action === 'create') {
    const row = object(value, [
      'commandId',
      'kind',
      'reasonCode',
      'description',
    ]);
    if (
      typeof row.kind !== 'string' ||
      typeof row.reasonCode !== 'string' ||
      !['REFUND_ONLY', 'RETURN_AND_REFUND'].includes(row.kind) ||
      !['DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'OTHER'].includes(
        row.reasonCode,
      )
    )
      return bad();
    return {
      commandId: uuid(row.commandId),
      body: {
        kind: row.kind as ReturnKind,
        reasonCode: row.reasonCode as string,
        description: reason(row.description),
      },
    };
  }
  if (!['cancel', 'dispute', 'approve', 'reject', 'receive'].includes(action))
    return bad();
  const row = object(value, [
    'commandId',
    'expectedRevision',
    'reason',
    ...(action === 'receive' ? ['restockable'] : []),
  ]);
  if (typeof row.expectedRevision !== 'number') return bad();
  const body: Command['body'] = {
    expectedRevision: positiveId(row.expectedRevision),
    reason: reason(row.reason),
  };
  if (action === 'receive') {
    if (typeof row.restockable !== 'boolean') return bad();
    body.restockable = row.restockable;
  }
  return { commandId: uuid(row.commandId), body };
}
export function commandHash(
  scope: Scope,
  action: Action,
  targetId: number,
  input: Command,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({ scope, action, targetId, body: input.body }),
      'utf8',
    )
    .digest('hex');
}
export function reconcileInput(value: unknown) {
  const row = object(value, ['commandId', 'requestHash']);
  if (
    typeof row.requestHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(row.requestHash)
  )
    return bad();
  return { commandId: uuid(row.commandId), requestHash: row.requestHash };
}
export function pageInput(url: string, history = false) {
  const values = new URL(url, 'http://localhost').searchParams;
  const result: { limit: number; before?: number } = { limit: 20 };
  const cursor = history ? 'beforeRevision' : 'beforeId';
  const seen = new Set<string>();
  for (const [key, value] of values) {
    if (
      !['limit', cursor].includes(key) ||
      seen.has(key) ||
      !/^[1-9][0-9]*$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > (key === 'limit' ? 50 : 2147483647)
    )
      return bad();
    seen.add(key);
    if (key === 'limit') result.limit = Number(value);
    else result.before = Number(value);
  }
  return result;
}
