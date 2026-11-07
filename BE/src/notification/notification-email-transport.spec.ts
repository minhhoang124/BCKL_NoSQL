import { afterEach, it, expect, vi } from 'vitest';
import { NotificationEmailTransport } from './notification-email-transport.js';
import { emailConfig, emailPayload } from './notification-email-policy.js';
const cfg = () =>
  emailConfig({
    NODE_ENV: 'test',
    NOTIFICATION_EMAIL_PROVIDER: 'resend',
    NOTIFICATION_EMAIL_FROM: 'notice@example.invalid',
    NOTIFICATION_EMAIL_API_KEY: 'synthetic-not-real-provider-key',
    NOTIFICATION_EMAIL_WEB_ORIGIN: 'http://localhost:5173',
    NOTIFICATION_EMAIL_START_AT: '2026-10-28T00:00:00.000Z',
  });
afterEach(() => vi.unstubAllGlobals());
it('fixed endpoint, idempotency key, no redirects or body from user', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response('{"id":"synthetic-id"}', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const c = cfg(),
    p = emailPayload(c, 'buyer@example.invalid', 'ORDER');
  expect(
    await new NotificationEmailTransport().send(c, p, 'notification-email-42'),
  ).toEqual({ kind: 'accepted', id: 'synthetic-id' });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('https://api.resend.com/emails');
  expect(options.redirect).toBe('error');
  expect(options.headers['Idempotency-Key']).toBe('notification-email-42');
  expect(JSON.parse(options.body)).toEqual(p);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  [429, 'retry'],
  [500, 'unknown'],
  [409, 'unknown'],
  [408, 'unknown'],
  [400, 'failed'],
  [401, 'failed'],
  [422, 'failed'],
])('classifies HTTP%s without leaking response body', async (status, kind) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response('private provider content', { status: Number(status) }),
      ),
  );
  const c = cfg();
  const r = await new NotificationEmailTransport().send(
    c,
    emailPayload(c, 'a@example.invalid', 'STORE'),
    'stable',
  );
  expect(r.kind).toBe(kind);
  expect(JSON.stringify(r)).not.toContain('private');
});
it.each([
  '{}',
  'not json',
  '{"id":"contains private spaces"}',
  `{"id":"${'x'.repeat(9000)}"}`,
])('invalid/oversized accepted response is ambiguous', async (raw) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(raw, { status: 200 })),
  );
  const c = cfg();
  expect(
    (
      await new NotificationEmailTransport().send(
        c,
        emailPayload(c, 'a@example.invalid', 'PRODUCT'),
        'stable',
      )
    ).kind,
  ).toBe('unknown');
});
it('transport timeout remains unknown and does not retry itself', async () => {
  const fetcher = vi.fn().mockRejectedValue(Error('private secret header'));
  vi.stubGlobal('fetch', fetcher);
  const c = cfg();
  expect(
    await new NotificationEmailTransport().send(
      c,
      emailPayload(c, 'a@example.invalid', 'AFTERSALE'),
      'stable',
    ),
  ).toEqual({ kind: 'unknown', code: 'EMAIL_TRANSPORT_UNCONFIRMED' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('local format stays in loopback Mailpit without Authorization', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response('{"ID":"local-id"}', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const c = { ...cfg(), provider: 'mailpit' as const };
  expect(
    (
      await new NotificationEmailTransport().send(
        c,
        emailPayload(c, 'a@example.invalid', 'ORDER'),
        'stable',
      )
    ).kind,
  ).toBe('accepted');
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('http://127.0.0.1:8025/api/v1/send');
  expect(options.headers).not.toHaveProperty('Authorization');
  expect(JSON.parse(options.body).Subject).toContain('[QA LOCAL]');
});
