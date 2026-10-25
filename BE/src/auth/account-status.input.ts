import { BadRequestException } from '@nestjs/common';

export interface AccountStatusInput {
  isActive: boolean;
  expectedRevision: number;
  reason: string;
  commandId?: string;
}

export const accountCommandId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );

export function accountStatusInput(body: unknown): AccountStatusInput {
  const bad = () =>
    new BadRequestException(
      'Cần isActive, expectedRevision và lý do 10–500 ký tự.',
    );
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad();
  const value = body as Record<string, unknown>;
  if (
    ![
      'expectedRevision,isActive,reason',
      'commandId,expectedRevision,isActive,reason',
    ].includes(Object.keys(value).sort().join(',')) ||
    (Object.hasOwn(value, 'commandId') && !accountCommandId(value.commandId)) ||
    typeof value.isActive !== 'boolean' ||
    !Number.isInteger(value.expectedRevision) ||
    (value.expectedRevision as number) < 1 ||
    (value.expectedRevision as number) > 2147483647 ||
    typeof value.reason !== 'string'
  )
    throw bad();
  const reason = value.reason.normalize('NFC').trim();
  if (
    [...reason].length < 10 ||
    [...reason].length > 500 ||
    [...reason].some((c) => {
      const cp = c.codePointAt(0)!;
      return (
        (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13) ||
        (cp >= 127 && cp <= 159) ||
        (cp >= 0xd800 && cp <= 0xdfff)
      );
    })
  )
    throw bad();
  return {
    isActive: value.isActive,
    expectedRevision: value.expectedRevision as number,
    reason,
    ...(Object.hasOwn(value, 'commandId')
      ? { commandId: value.commandId as string }
      : {}),
  };
}
