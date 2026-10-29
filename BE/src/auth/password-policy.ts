import { BadRequestException } from '@nestjs/common';
import { ValidateBy, type ValidationOptions } from 'class-validator';

// Never trim, normalize, pre-hash, or silently truncate a password.
export function bcryptPassword(
  value: unknown,
  minCharacters = 1,
): value is string {
  return (
    typeof value === 'string' &&
    [...value].length >= minCharacters &&
    Buffer.byteLength(value, 'utf8') <= 72 &&
    !value.includes('\0') &&
    !/\p{Cs}/u.test(value)
  );
}

export function requireBcryptPassword(
  value: unknown,
  minCharacters = 1,
): asserts value is string {
  if (!bcryptPassword(value, minCharacters))
    throw new BadRequestException({
      code: 'PASSWORD_POLICY',
      message:
        'Mật khẩu cần đúng độ dài quy định, tối đa 72 byte UTF-8 và không chứa ký tự NUL.',
    });
}

export function BcryptPassword(
  minCharacters: number,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'bcryptPassword',
      validator: {
        validate: (value) => bcryptPassword(value, minCharacters),
        defaultMessage: () =>
          'Mật khẩu phải có ít nhất ' +
          minCharacters +
          ' ký tự và tối đa 72 byte UTF-8.',
      },
    },
    options,
  );
}
