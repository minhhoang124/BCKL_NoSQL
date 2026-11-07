import { ServiceUnavailableException } from '@nestjs/common';
export function vnpayConfig(requireEnabled = true) {
  try {
    const tmnCode = process.env.VNPAY_TMN_CODE ?? '',
      secret = process.env.VNPAY_HASH_SECRET ?? '',
      web = new URL(process.env.VNPAY_WEB_ORIGIN ?? ''),
      api = new URL(process.env.VNPAY_API_ORIGIN ?? ''),
      db = new URL(process.env.DATABASE_URL ?? '');
    const trusted = (u: URL) =>
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === '/' &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(u.hostname)));
    const qa =
      db.hostname === '127.0.0.1' &&
      db.port === '5549' &&
      /^\/bckl_order_resolution_test_[a-z0-9_]{1,40}$/.test(db.pathname);
    const ci =
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.CI === 'true' &&
      /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') &&
      ['localhost', '127.0.0.1'].includes(db.hostname) &&
      db.port === '5432' &&
      db.pathname === '/klcn_ecommerce';
    if (
      (requireEnabled && process.env.VNPAY_SANDBOX_ENABLED !== 'true') ||
      process.env.NODE_ENV === 'production' ||
      !/^[A-Z0-9]{8}$/.test(tmnCode) ||
      !/^[A-Za-z0-9]{32,128}$/.test(secret) ||
      !trusted(web) ||
      !trusted(api) ||
      db.protocol !== 'postgresql:' ||
      (!qa && !ci) ||
      db.hash ||
      [...db.searchParams].some(([k, v]) => k !== 'schema' || v !== 'public') ||
      db.searchParams.getAll('schema').length > 1
    )
      throw Error();
    return {
      tmnCode,
      secret,
      webOrigin: web.origin,
      returnUrl: api.origin + '/payments/vnpay/return',
    };
  } catch {
    throw new ServiceUnavailableException({ code: 'VNPAY_SANDBOX_DISABLED' });
  }
}
export function vnpayCheckoutEnabled() {
  return process.env.VNPAY_SANDBOX_ENABLED === 'true';
}
