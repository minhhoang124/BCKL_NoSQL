import { BadRequestException } from '@nestjs/common';
import { bcryptPassword } from './password-policy.js';

function body(value: unknown, fields: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new BadRequestException('Dữ liệu tài khoản không hợp lệ');
  return value as Record<string, unknown>;
}
function name(value: unknown): string {
  if (typeof value !== 'string')
    throw new BadRequestException('Tên không hợp lệ');
  const normalized = value.normalize('NFC').trim();
  if (
    [...normalized].length < 2 ||
    [...normalized].length > 100 ||
    /[\p{Cc}\p{Cf}]/u.test(normalized)
  )
    throw new BadRequestException(
      'Tên cần từ 2 đến 100 ký tự, không chứa ký tự điều khiển',
    );
  return normalized;
}
export function profileInput(value: unknown) {
  const input = body(value, ['fullName', 'expectedFullName']);
  if (
    input.expectedFullName !== null &&
    (typeof input.expectedFullName !== 'string' ||
      input.expectedFullName.length > 500)
  )
    throw new BadRequestException('Tên đối chiếu không hợp lệ');
  return {
    fullName: name(input.fullName),
    expectedFullName: input.expectedFullName as string | null,
  };
}
export function passwordInput(value: unknown) {
  const input = body(value, ['currentPassword', 'newPassword']);
  // Passwords are not trimmed or Unicode-normalized. bcrypt's limit is BYTES.
  if (
    typeof input.currentPassword !== 'string' ||
    Buffer.byteLength(input.currentPassword) < 1 ||
    !bcryptPassword(input.currentPassword) ||
    typeof input.newPassword !== 'string' ||
    [...input.newPassword].length < 8 ||
    Buffer.byteLength(input.newPassword) > 72 ||
    !bcryptPassword(input.newPassword, 8)
  )
    throw new BadRequestException(
      'Mật khẩu mới cần ít nhất 8 ký tự và tối đa 72 byte UTF-8',
    );
  return {
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
  };
}
