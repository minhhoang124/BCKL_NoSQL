import { HttpException } from '@nestjs/common';

// Call with canonical User data while holding the User lock. This gate applies
// only to NEW purchase/application intents, never to an existing receipt or a
// recovery request that merely closes an unused command.
export function requireVerifiedEmail(emailVerifiedAt: Date | null | undefined) {
  if (process.env.AUTH_EMAIL_ENABLED === 'true' && !emailVerifiedAt)
    throw new HttpException(
      {
        code: 'EMAIL_VERIFICATION_REQUIRED',
        message: 'Vui lòng xác minh email trong Tài khoản trước khi đặt hàng hoặc gửi hồ sơ mở Store.',
      },
      412,
    );
}
