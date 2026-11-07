import { BadRequestException } from '@nestjs/common';

export function attributeReadValidation(message: string): never {
  throw new BadRequestException({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message,
  });
}

export function attributeReadId(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    attributeReadValidation('Invalid positive integer');
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id > 2147483647) {
    attributeReadValidation('Invalid positive integer');
  }
  return id;
}

export function attributeReadQuery(query: Record<string, unknown>) {
  if (
    Object.keys(query).some(
      (key) => !['limit', 'afterId', 'isActive'].includes(key),
    )
  ) {
    attributeReadValidation('Unknown query field');
  }
  const limit = query.limit === undefined ? 50 : attributeReadId(query.limit);
  if (limit > 100) attributeReadValidation('Limit exceeds 100');
  const afterId =
    query.afterId === undefined ? undefined : attributeReadId(query.afterId);
  if (
    query.isActive !== undefined &&
    query.isActive !== 'true' &&
    query.isActive !== 'false'
  ) {
    attributeReadValidation('isActive must be true or false');
  }
  return {
    limit,
    afterId,
    isActive:
      query.isActive === undefined ? undefined : query.isActive === 'true',
  };
}
