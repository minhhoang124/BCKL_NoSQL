import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthEmailDelivery } from './email-delivery.js';
beforeEach(() => {
  vi.stubEnv('AUTH_EMAIL_PROVIDER', 'resend');
  vi.stubEnv('AUTH_EMAIL_API_KEY', 'synthetic-private-key-only-for-test');
  vi.stubEnv('AUTH_EMAIL_FROM', 'qa@example.invalid');
  vi.stubEnv('AUTH_EMAIL_WEB_ORIGIN', 'https://example.invalid');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('sends to fixed provider with token only in fragment and no redirects', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await new AuthEmailDelivery().send(
    'recipient@example.invalid',
    'A'.repeat(43),
    'RESET_PASSWORD',
    'synthetic-id',
  );
  expect(fetcher).toHaveBeenCalledWith(
    'https://api.resend.com/emails',
    expect.objectContaining({ redirect: 'error', method: 'POST' }),
  );
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.text).toContain('/reset-password#token=');
  expect(body.text).not.toContain('?token=');
  expect(body.to).toEqual(['recipient@example.invalid']);
  expect(body.html).toBeUndefined();
});
it.each([
  'https://example.invalid/evil',
  'https://example.invalid/?next=evil',
  'https://user:password@example.invalid',
  'https://example.invalid/#x',
  'http://public.example.invalid',
])('refuses invalid configured link origin %s', (origin) => {
  vi.stubEnv('AUTH_EMAIL_WEB_ORIGIN', origin);
  expect(() => new AuthEmailDelivery().configured()).toThrow();
});
it('allows localhost HTTP only outside production', () => {
  vi.stubEnv('AUTH_EMAIL_WEB_ORIGIN', 'http://127.0.0.1:5173');
  vi.stubEnv('NODE_ENV', 'test');
  expect(new AuthEmailDelivery().configured().origin).toBe(
    'http://127.0.0.1:5173',
  );
  vi.stubEnv('NODE_ENV', 'production');
  expect(() => new AuthEmailDelivery().configured()).toThrow();
});
it('never logs provider body or raw token on unconfirmed delivery', async () => {
  const logger = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('PRIVATE_PROVIDER_BODY')),
  );
  const adapter = new AuthEmailDelivery();
  adapter.enqueue(
    'private@example.invalid',
    'A'.repeat(43),
    'VERIFY_EMAIL',
    'id',
  );
  await adapter.onModuleDestroy();
  expect(JSON.stringify(logger.mock.calls)).not.toContain(
    'PRIVATE_PROVIDER_BODY',
  );
  expect(JSON.stringify(logger.mock.calls)).not.toContain('A'.repeat(43));
});
function localMailpit() {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('AUTH_EMAIL_PROVIDER', 'mailpit');
  vi.stubEnv('AUTH_EMAIL_LOCAL_SANDBOX_ENABLED', 'true');
  vi.stubEnv('AUTH_EMAIL_WEB_ORIGIN', 'http://127.0.0.1:5191');
  vi.stubEnv('AUTH_EMAIL_MAILPIT_ORIGIN', 'http://127.0.0.1:8025');
  vi.stubEnv(
    'DATABASE_URL',
    'postgresql://bckl_qa_app_20261021:synthetic@127.0.0.1:5549/bckl_order_resolution_test_local',
  );
}
it('captures a clearly labeled local message without forwarding a Resend API key', async () => {
  localMailpit();
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await new AuthEmailDelivery().send(
    'local@example.invalid',
    'A'.repeat(43),
    'VERIFY_EMAIL',
    'qa-id',
  );
  expect(fetcher).toHaveBeenCalledWith(
    'http://127.0.0.1:8025/api/v1/send',
    expect.objectContaining({
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.Subject).toContain('[QA LOCAL]');
  expect(body.Text).toContain('không gửi tới Gmail');
  expect(body.To).toEqual([{ Email: 'local@example.invalid' }]);
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain(
    'synthetic-private-key-only-for-test',
  );
});
it.each([
  ['NODE_ENV', 'production'],
  ['AUTH_EMAIL_LOCAL_SANDBOX_ENABLED', 'false'],
  ['AUTH_EMAIL_MAILPIT_ORIGIN', 'http://evil.invalid:8025'],
  ['AUTH_EMAIL_MAILPIT_ORIGIN', 'http://127.0.0.1:8025/'],
  ['AUTH_EMAIL_WEB_ORIGIN', 'https://public.example.invalid'],
  [
    'DATABASE_URL',
    'postgresql://bckl_qa_app_20261021:synthetic@127.0.0.1:5432/klcn_ecommerce',
  ],
  [
    'DATABASE_URL',
    'postgresql://postgres:synthetic@127.0.0.1:5549/bckl_order_resolution_test_local',
  ],
  [
    'DATABASE_URL',
    'postgresql://bckl_qa_app_20261021:synthetic@127.0.0.1:5549/demo',
  ],
  [
    'DATABASE_URL',
    'postgresql://bckl_qa_app_20261021:synthetic@127.0.0.1:5549/bckl_order_resolution_test_local?host=evil.invalid',
  ],
])('blocks unsafe local sandbox config %s', (key, value) => {
  localMailpit();
  vi.stubEnv(key, value);
  expect(() => new AuthEmailDelivery().configured()).toThrow();
});
