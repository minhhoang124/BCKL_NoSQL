import { ServiceUnavailableException } from '@nestjs/common';
export function phoneOtpConfig() {
  try {
    const key = process.env.AUTH_PHONE_OTP_HMAC_SECRET ?? '',
      u = new URL(process.env.DATABASE_URL ?? '');
    const qa =
      u.hostname === '127.0.0.1' &&
      u.port === '5549' &&
      /^\/bckl_order_resolution_test_[a-z0-9_]{1,40}$/.test(u.pathname);
    const ci =
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.CI === 'true' &&
      /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') &&
      ['127.0.0.1', 'localhost'].includes(u.hostname) &&
      u.port === '5432' &&
      u.pathname === '/klcn_ecommerce';
    if (
      process.env.AUTH_PHONE_OTP_ENABLED !== 'true' ||
      process.env.AUTH_PHONE_OTP_PROVIDER !== 'sandbox' ||
      process.env.NODE_ENV === 'production' ||
      Buffer.byteLength(key) < 32 ||
      u.protocol !== 'postgresql:' ||
      (!qa && !ci) ||
      u.hash ||
      [...u.searchParams].some(([k, v]) => k !== 'schema' || v !== 'public') ||
      u.searchParams.getAll('schema').length > 1
    )
      throw Error();
    return { key, channel: 'SANDBOX' as const };
  } catch {
    throw new ServiceUnavailableException({
      code: 'PHONE_OTP_SANDBOX_DISABLED',
    });
  }
}
