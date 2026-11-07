import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
export type ReviewScope = 'BUYER' | 'SELLER' | 'ADMIN';
export type ReviewAction = 'create' | 'edit' | 'reply' | 'hide';
export const invalid = (): never => {
  throw new BadRequestException({ code: 'REVIEW_INVALID_INPUT' });
};
export function positive(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    return invalid();
  return value;
}
export function record(
  raw: unknown,
  fields: string[],
): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => !fields.includes(k))
  )
    return invalid();
  return raw as Record<string, unknown>;
}
export function text(raw: unknown, min = 1, max = 2000): string {
  if (typeof raw !== 'string') return invalid();
  const value = raw.replace(/\r\n/g, '\n').normalize('NFC').trim();
  if (
    [...value].length < min ||
    [...value].length > max ||
    /[\p{Cs}\p{Cc}]/u.test(value.replace(/\n/g, ''))
  )
    return invalid();
  return value;
}
export function validAction(
  scope: unknown,
  action: unknown,
): asserts scope is ReviewScope {
  if (
    typeof action !== 'string' ||
    !(
      (scope === 'BUYER' && ['create', 'edit'].includes(action)) ||
      (scope === 'SELLER' && action === 'reply') ||
      (scope === 'ADMIN' && action === 'hide')
    )
  )
    invalid();
}
export type ReviewBody = {
  commandId: string;
  confirmed: true;
  expectedRevision?: number;
  rating?: number;
  body?: string;
  reason?: string;
};
export function input(
  scope: ReviewScope,
  action: ReviewAction,
  raw: unknown,
): ReviewBody {
  validAction(scope, action);
  const fields = [
    'commandId',
    'confirmed',
    ...(action === 'create' ? [] : ['expectedRevision']),
    ...(scope === 'BUYER'
      ? ['rating', 'body']
      : action === 'reply'
        ? ['body']
        : ['reason']),
  ];
  const r = record(raw, fields);
  if (
    typeof r.commandId !== 'string' ||
    !/^\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      r.commandId,
    ) ||
    r.confirmed !== true
  )
    return invalid();
  const value: ReviewBody = { commandId: r.commandId, confirmed: true };
  if (action !== 'create')
    value.expectedRevision = positive(r.expectedRevision);
  if (scope === 'BUYER') {
    if (
      typeof r.rating !== 'number' ||
      !Number.isInteger(r.rating) ||
      r.rating < 1 ||
      r.rating > 5
    )
      return invalid();
    value.rating = r.rating;
  }
  if (scope === 'BUYER' || action === 'reply') value.body = text(r.body);
  if (action === 'hide') value.reason = text(r.reason, 10, 500);
  return value;
}
export function digest(
  scope: ReviewScope,
  action: ReviewAction,
  itemId: number,
  value: ReviewBody,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 1,
        scope,
        action,
        orderItemId: positive(itemId),
        body: {
          confirmed: true,
          ...(value.expectedRevision === undefined
            ? {}
            : { expectedRevision: value.expectedRevision }),
          ...(value.rating === undefined ? {} : { rating: value.rating }),
          ...(value.body === undefined ? {} : { body: value.body }),
          ...(value.reason === undefined ? {} : { reason: value.reason }),
        },
      }),
    )
    .digest('hex');
}
export function proof(raw: unknown) {
  const r = record(raw, ['commandId', 'requestHash', 'confirmed']);
  if (
    typeof r.commandId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      r.commandId,
    ) ||
    typeof r.requestHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(r.requestHash) ||
    r.confirmed !== true
  )
    return invalid();
  return { commandId: r.commandId, requestHash: r.requestHash };
}
export function page(url: string, enabled = true) {
  const q = new URL(url, 'http://local.invalid').searchParams;
  for (const k of q.keys())
    if (
      !enabled ||
      !['limit', 'beforeId'].includes(k) ||
      q.getAll(k).length !== 1
    )
      invalid();
  const parse = (k: string, fallback: number | null) => {
    const v = q.get(k);
    return v === null
      ? fallback
      : /^[1-9][0-9]*$/.test(v)
        ? positive(Number(v))
        : invalid();
  };
  const limit = parse('limit', 20) as number;
  if (limit > 50) return invalid();
  return { limit, beforeId: parse('beforeId', null) };
}
export function windowDays(raw = process.env.REVIEW_WINDOW_DAYS) {
  if (raw === undefined) return 30;
  if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > 365)
    throw new ServiceUnavailableException({
      code: 'REVIEW_WINDOW_CONFIG_INVALID',
    });
  return Number(raw);
}
