import { BadRequestException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { createHash } from 'node:crypto';
export type EmailPurpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD';
export const invalidEmailToken = () =>
  new BadRequestException({
    code: 'EMAIL_TOKEN_INVALID',
    message:
      'Liên kết không hợp lệ, đã dùng hoặc đã hết hạn. Hãy kiểm tra đăng nhập hoặc yêu cầu thư mới.',
  });
function object(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    throw new BadRequestException({ code: 'AUTH_EMAIL_INVALID_INPUT' });
  return value as Record<string, unknown>;
}
export function emailRequest(value: unknown) {
  const input = object(value, ['email']);
  if (typeof input.email !== 'string')
    throw new BadRequestException({ code: 'AUTH_EMAIL_INVALID_INPUT' });
  const email = input.email.trim().toLowerCase();
  if (
    email.length > 254 ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(email) ||
    !isEmail(email)
  )
    throw new BadRequestException({ code: 'AUTH_EMAIL_INVALID_INPUT' });
  return email;
}
export function emailConsent(value: unknown) {
  if (object(value, ['confirmed']).confirmed !== true)
    throw new BadRequestException({ code: 'AUTH_EMAIL_CONSENT_REQUIRED' });
}
export function emailToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value) ||
    Buffer.from(value, 'base64url').toString('base64url') !== value
  )
    throw invalidEmailToken();
  return value;
}
export const emailTokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export function emailConfirmation(value: unknown, reset = false) {
  const input = object(
    value,
    reset ? ['token', 'newPassword', 'confirmed'] : ['token', 'confirmed'],
  );
  if (input.confirmed !== true)
    throw new BadRequestException({ code: 'AUTH_EMAIL_CONSENT_REQUIRED' });
  const token = emailToken(input.token);
  let newPassword: string | undefined;
  if (reset) {
    if (
      typeof input.newPassword !== 'string' ||
      [...input.newPassword].length < 8 ||
      Buffer.byteLength(input.newPassword) > 72 ||
      input.newPassword.includes('\0')
    )
      throw new BadRequestException({
        code: 'PASSWORD_POLICY',
        message: 'Mật khẩu cần ít nhất 8 ký tự và tối đa 72 byte UTF-8.',
      });
    newPassword = input.newPassword;
  }
  return { token, newPassword };
}
