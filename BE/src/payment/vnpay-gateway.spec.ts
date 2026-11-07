import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { VnpayGateway } from './vnpay-gateway.js';
import { vnpayConfig } from './vnpay-config.js';
const secret = 'SyntheticVnpayChecksumKeyAtLeast32Characters',
  env = {
    VNPAY_SANDBOX_ENABLED: 'true',
    VNPAY_TMN_CODE: 'TEST0001',
    VNPAY_HASH_SECRET: secret,
    VNPAY_WEB_ORIGIN: 'http://localhost:5197',
    VNPAY_API_ORIGIN: 'http://localhost:3397',
    DATABASE_URL:
      'postgresql://qa:synthetic@127.0.0.1:5549/bckl_order_resolution_test_vnpay_unit?schema=public',
    GITHUB_ACTIONS: 'false',
    NODE_ENV: 'test',
  };
beforeEach(() => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());
describe('VNPay SDK adapter with independent HMAC oracle', () => {
  it('signs exactly once and binds sandbox URL, amount/ref and return endpoint', () => {
    const u = new URL(
      new VnpayGateway().build({
        reference: 'a'.repeat(32),
        amount: new Prisma.Decimal('10000.00'),
        createdAt: new Date('2026-10-27T06:00:00Z'),
        expiresAt: new Date('2026-10-27T06:15:00Z'),
        ipAddress: '127.0.0.1',
        returnUrl: env.VNPAY_API_ORIGIN + '/payments/vnpay/return',
        tmnCode: 'TEST0001',
      }),
    );
    expect(u.origin).toBe('https://sandbox.vnpayment.vn');
    expect(u.pathname).toBe('/paymentv2/vpcpay.html');
    expect(u.searchParams.get('vnp_Amount')).toBe('1000000');
    expect(u.searchParams.get('vnp_CreateDate')).toBe('20261027130000');
    const signature = u.searchParams.get('vnp_SecureHash');
    u.searchParams.delete('vnp_SecureHash');
    u.searchParams.sort();
    expect(signature).toBe(
      createHmac('sha512', secret)
        .update(u.searchParams.toString())
        .digest('hex'),
    );
  });
  it('verifies independently signed notifications and rejects amount tampering', () => {
    const q = {
        vnp_Amount: '1000000',
        vnp_TxnRef: 'a'.repeat(32),
        vnp_TmnCode: 'TEST0001',
        vnp_TransactionNo: '12345',
        vnp_ResponseCode: '00',
        vnp_TransactionStatus: '00',
        vnp_PayDate: '20261027130000',
      },
      params = new URLSearchParams(Object.entries(q));
    params.sort();
    const signed = {
      ...q,
      vnp_SecureHash: createHmac('sha512', secret)
        .update(params.toString())
        .digest('hex'),
    };
    expect(new VnpayGateway().verified(signed)).toBe(true);
    expect(
      new VnpayGateway().verified({ ...signed, vnp_Amount: '1000100' }),
    ).toBe(false);
  });
  it('stop-new-start flag does not disable existing signed callback recovery', () => {
    vi.stubEnv('VNPAY_SANDBOX_ENABLED', 'false');
    expect(() => vnpayConfig()).toThrow();
    expect(vnpayConfig(false).tmnCode).toBe('TEST0001');
  });
  it.each([
    ['NODE_ENV', 'production'],
    ['VNPAY_TMN_CODE', 'bad'],
    ['VNPAY_HASH_SECRET', 'short'],
    ['VNPAY_WEB_ORIGIN', 'https://web.invalid/?token=bad'],
    ['VNPAY_API_ORIGIN', 'https://user:pass@api.invalid/'],
    ['DATABASE_URL', 'postgresql://qa:synthetic@127.0.0.1:5432/klcn_ecommerce'],
    [
      'DATABASE_URL',
      'postgresql://qa:synthetic@remote.invalid:5549/bckl_order_resolution_test_x',
    ],
  ])('rejects unsafe config %s', (k, v) => {
    vi.stubEnv(k, v);
    expect(() => vnpayConfig()).toThrow();
  });
});
