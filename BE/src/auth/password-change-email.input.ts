import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { emailToken } from './email-recovery.input.js';
import { bcryptPassword } from './password-policy.js';

/**
 * AUTH_PASSWORD_CHANGE_MODE:
 *  - DIRECT (default): existing POST /auth/password (current + new password).
 *  - EMAIL: current password + emailed one-time link bound to the requesting
 *    browser; the direct endpoint is refused so it cannot bypass the email.
 * Any other value fails closed.
 */
export type PasswordChangeMode = 'DIRECT' | 'EMAIL';
export function passwordChangeMode(
  raw = process.env.AUTH_PASSWORD_CHANGE_MODE,
): PasswordChangeMode {
  const value = raw ?? 'DIRECT';
  if (value !== 'DIRECT' && value !== 'EMAIL')
    throw new ServiceUnavailableException({
      code: 'AUTH_PASSWORD_CHANGE_MODE_INVALID',
    });
  return value;
}

const invalidInput = () =>
  new BadRequestException({ code: 'PASSWORD_CHANGE_INVALID_INPUT' });

function exact(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    throw invalidInput();
  return value as Record<string, unknown>;
}

/** 32 random bytes, base64url, held only by the requesting browser. */
export function bindingSecret(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value) ||
    Buffer.from(value, 'base64url').toString('base64url') !== value
  )
    throw invalidInput();
  return value;
}
export const bindingHash = (secret: string) =>
  createHash('sha256').update(secret).digest('hex');

function currentPassword(value: unknown): string {
  // Not policy-checked: legacy passwords must still be usable to re-authenticate.
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value) > 72
  )
    throw invalidInput();
  return value;
}

function newPassword(value: unknown): string {
  if (
    typeof value !== 'string' ||
    [...value].length < 8 ||
    Buffer.byteLength(value) > 72 ||
    !bcryptPassword(value, 8)
  )
    throw new BadRequestException({
      code: 'PASSWORD_POLICY',
      message: 'Mật khẩu cần ít nhất 8 ký tự và tối đa 72 byte UTF-8.',
    });
  return value;
}

export function passwordChangeRequest(value: unknown) {
  const input = exact(value, ['currentPassword', 'confirmed']);
  if (input.confirmed !== true)
    throw new BadRequestException({ code: 'AUTH_EMAIL_CONSENT_REQUIRED' });
  return { currentPassword: currentPassword(input.currentPassword) };
}

export function passwordChangeVerify(value: unknown) {
  const input = exact(value, ['token', 'bindingSecret']);
  return {
    token: emailToken(input.token),
    bindingSecret: bindingSecret(input.bindingSecret),
  };
}

export function passwordChangeConfirm(value: unknown) {
  const input = exact(value, [
    'token',
    'bindingSecret',
    'newPassword',
    'confirmed',
  ]);
  if (input.confirmed !== true)
    throw new BadRequestException({ code: 'AUTH_EMAIL_CONSENT_REQUIRED' });
  return {
    token: emailToken(input.token),
    bindingSecret: bindingSecret(input.bindingSecret),
    newPassword: newPassword(input.newPassword),
  };
}
