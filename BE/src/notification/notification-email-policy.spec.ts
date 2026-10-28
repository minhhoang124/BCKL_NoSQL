import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  digest,
  emailConfig,
  emailPayload,
  eligibleEmail,
  retryAllowed,
  retryDelayMs,
  EMAIL_RETRY_WINDOW_MS,
} from './notification-email-policy.js';
const env = () => ({
  NODE_ENV: 'test',
  NOTIFICATION_EMAIL_PROVIDER: 'resend',
  NOTIFICATION_EMAIL_FROM: 'notice@example.invalid',
  NOTIFICATION_EMAIL_API_KEY: 'synthetic-private-api-key-only-qa',
  NOTIFICATION_EMAIL_WEB_ORIGIN: 'http://localhost:5173',
  NOTIFICATION_EMAIL_START_AT: '2026-10-28T00:00:00.000Z',
});
describe('Business email policy — no network', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('requires canonical cutoff and a safe fixed origin', () => {
    expect(emailConfig(env()).origin).toBe('http://localhost:5173');
  });
  it.each(['', '2026-10-28', 'not-a-date', '2026-10-28T00:00:00Z'])(
    'rejects noncanonical cutoff %s',
    (cutoff) =>
      expect(() =>
        emailConfig({ ...env(), NOTIFICATION_EMAIL_START_AT: cutoff }),
      ).toThrow(),
  );
  it.each([
    'https://user:pass@example.com',
    'https://example.com/anything',
    'https://example.com/?redirect=x',
    'https://example.com/#x',
    'ftp://example.com',
    'http://external.example',
  ])('rejects origin %s', (origin) =>
    expect(() =>
      emailConfig({ ...env(), NOTIFICATION_EMAIL_WEB_ORIGIN: origin }),
    ).toThrow(),
  );
  it.each(['bad', 'x@example.invalid\nBCC: y@example.invalid'])(
    'rejects from injection %s',
    (from) =>
      expect(() =>
        emailConfig({ ...env(), NOTIFICATION_EMAIL_FROM: from }),
      ).toThrow(),
  );
  it('requires HTTPS in production', () =>
    expect(() => emailConfig({ ...env(), NODE_ENV: 'production' })).toThrow());
  it('pins config across retries, including key changes without storing key', () => {
    const a = emailConfig(env()),
      b = emailConfig({
        ...env(),
        NOTIFICATION_EMAIL_API_KEY: 'other-synthetic-private-key-only-qa',
      });
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
  it('Mailpit is exact local app-role QA only', () => {
    const c = {
      ...env(),
      NOTIFICATION_EMAIL_PROVIDER: 'mailpit',
      NOTIFICATION_EMAIL_LOCAL_SANDBOX_ENABLED: 'true',
      DATABASE_URL:
        'postgresql://bckl_qa_app_20261021:synthetic@127.0.0.1:5549/bckl_order_resolution_test_email?schema=public',
    };
    expect(emailConfig(c).provider).toBe('mailpit');
    for (const DATABASE_URL of [
      c.DATABASE_URL.replace('5549', '5432'),
      c.DATABASE_URL.replace('bckl_qa_app_20261021', 'postgres'),
      c.DATABASE_URL + '&anything=1',
    ])
      expect(() => emailConfig({ ...c, DATABASE_URL })).toThrow();
    expect(() => emailConfig({ ...c, NODE_ENV: 'production' })).toThrow();
  });
  it.each(['ORDER', 'STORE', 'PRODUCT', 'AFTERSALE'])(
    'generic payload has no business PII for %s',
    (kind) => {
      const c = emailConfig(env()),
        p = emailPayload(c, 'buyer@example.invalid', kind);
      expect(p.text).toContain('/account/notifications');
      expect(p.text).not.toMatch(/orderId|reason|payment|stock|token=/i);
      expect(digest(p)).toBe(
        digest(emailPayload(c, 'buyer@example.invalid', kind)),
      );
    },
  );
  it('does not add Chat or arbitrary events to email', () =>
    expect(() =>
      emailPayload(emailConfig(env()), 'a@example.invalid', 'CHAT'),
    ).toThrow());
  it('checks active/verified/current audience, not just email shape', () => {
    const u = {
      isActive: true,
      email: 'buyer@example.invalid',
      emailVerifiedAt: new Date(),
      role: 'USER',
    };
    expect(eligibleEmail(u, 'BUYER')).toBe(true);
    for (const x of [
      { ...u, isActive: false },
      { ...u, emailVerifiedAt: null },
      { ...u, email: 'invalid' },
    ])
      expect(eligibleEmail(x, 'BUYER')).toBe(false);
    expect(eligibleEmail(u, 'SELLER')).toBe(false);
  });
  it('never treats Mailpit, absent timestamps, backwards clocks or expired windows as safe replay', () => {
    const start = new Date('2026-10-28T00:00:00Z');
    expect(
      retryAllowed(
        'resend',
        start,
        new Date(start.getTime() + EMAIL_RETRY_WINDOW_MS - 1),
      ),
    ).toBe(true);
    for (const [provider, first, now] of [
      ['mailpit', start, start],
      ['resend', null, start],
      ['resend', start, new Date(start.getTime() - 1)],
      ['resend', start, new Date(start.getTime() + EMAIL_RETRY_WINDOW_MS)],
    ] as const)
      expect(retryAllowed(provider, first, now)).toBe(false);
  });
  it('bounds exponential backoff', () => {
    expect(retryDelayMs(1)).toBe(30000);
    expect(retryDelayMs(5)).toBe(480000);
    expect(retryDelayMs(100)).toBe(900000);
  });
});

it('reserves a provider idempotency margin larger than lease plus HTTP deadline', () =>
  expect(EMAIL_RETRY_WINDOW_MS + 35000).toBeLessThan(24 * 60 * 60 * 1000));
