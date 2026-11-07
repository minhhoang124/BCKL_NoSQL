import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import {
  GoogleOAuthProvider,
  googleProfile,
  oauthDigest,
} from './google-oauth.provider.js';
import { googleConfig } from './google-oauth.config.js';
import { validOAuthRandom } from './google-oauth.service.js';
const clientId = 'synthetic.apps.googleusercontent.com',
  nonce = 'test-nonce',
  pair = generateKeyPairSync('rsa', { modulusLength: 2048 }),
  pem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
function setup() {
  for (const [k, v] of Object.entries({
    AUTH_GOOGLE_ENABLED: 'true',
    GOOGLE_OAUTH_CLIENT_ID: clientId,
    GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-google-client-secret',
    GOOGLE_OAUTH_STATE_SECRET: 'synthetic-google-state-secret-32bytes',
    GOOGLE_OAUTH_CALLBACK_URL: 'http://localhost:3001/auth/google/callback',
    GOOGLE_OAUTH_WEB_ORIGIN: 'http://localhost:5173',
    NODE_ENV: 'test',
  }))
    vi.stubEnv(k, v);
}
beforeEach(setup);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('Google config and canonical inputs', () => {
  it('fails closed unless enabled and every trusted origin/secret is configured', () => {
    expect(googleConfig().callback).toBe(
      'http://localhost:3001/auth/google/callback',
    );
    for (const [k, v] of [
      ['AUTH_GOOGLE_ENABLED', 'false'],
      ['GOOGLE_OAUTH_CLIENT_SECRET', ''],
      ['GOOGLE_OAUTH_STATE_SECRET', 'short'],
      [
        'GOOGLE_OAUTH_CALLBACK_URL',
        'https://user:pass@example.invalid/auth/google/callback',
      ],
      ['GOOGLE_OAUTH_WEB_ORIGIN', 'http://evil.invalid'],
      ['GOOGLE_OAUTH_WEB_ORIGIN', 'https://app.invalid/extra'],
      ['GOOGLE_OAUTH_CALLBACK_URL', 'http://localhost:3001/wrong'],
    ] as const) {
      setup();
      vi.stubEnv(k, v);
      expect(() => googleConfig()).toThrow();
    }
  });
  it('refuses HTTP even loopback in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => googleConfig()).toThrow();
  });
  it('accepts only canonical 256-bit state/proof encodings', () => {
    expect(validOAuthRandom('A'.repeat(43))).toBe(true);
    for (const v of [
      null,
      'A'.repeat(42),
      'A'.repeat(44),
      'A'.repeat(42) + 'B',
      ' '.repeat(43),
    ])
      expect(validOAuthRandom(v)).toBe(false);
  });
});
describe('official Google library ID token verification with synthetic RSA signatures — no network', () => {
  async function verify(
    patch: Record<string, unknown> = {},
    badSignature = false,
  ) {
    const now = Math.floor(Date.now() / 1000),
      payload = {
        iss: 'https://accounts.google.com',
        aud: clientId,
        iat: now,
        exp: now + 600,
        sub: 'google_test_subject',
        email: 'demo@gmail.com',
        email_verified: true,
        nonce,
        ...patch,
      };
    const data = [{ alg: 'RS256', kid: 'qa_key' }, payload]
      .map((x) => Buffer.from(JSON.stringify(x)).toString('base64url'))
      .join('.');
    const signature = createSign('RSA-SHA256')
      .update(data)
      .sign(
        badSignature
          ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
          : pair.privateKey,
      )
      .toString('base64url');
    vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({
      tokens: { id_token: data + '.' + signature },
    } as never);
    vi.spyOn(
      OAuth2Client.prototype,
      'getFederatedSignonCertsAsync',
    ).mockResolvedValue({ certs: { qa_key: pem }, format: 'PEM' } as never);
    return new GoogleOAuthProvider().exchange(
      'synthetic-code',
      'synthetic-pkce',
      oauthDigest(nonce),
    );
  }
  it('accepts a correctly signed and scoped token', async () => {
    expect(await verify()).toMatchObject({
      subject: 'google_test_subject',
      email: 'demo@gmail.com',
      authoritative: true,
    });
  });
  it.each([
    { aud: 'other.apps.googleusercontent.com' },
    { iss: 'https://evil.invalid' },
    { exp: 1, iat: 0 },
    { nonce: 'wrong' },
    { nonce: undefined },
    { email_verified: false },
    { sub: '' },
    { email: 'invalid' },
  ])('rejects invalid claims %j', async (patch) => {
    await expect(verify(patch)).rejects.toThrow();
  });
  it('rejects invalid signature with otherwise valid claims', async () => {
    await expect(verify({}, true)).rejects.toThrow();
  });
  it('does not trust email_verified alone for third-party consumer mailboxes', () => {
    expect(
      googleProfile(
        { sub: 'id', email: 'qa@example.invalid', email_verified: true, nonce },
        oauthDigest(nonce),
      ).authoritative,
    ).toBe(false);
    expect(
      googleProfile(
        {
          sub: 'id',
          email: 'qa@example.invalid',
          email_verified: true,
          hd: 'example.invalid',
          nonce,
        },
        oauthDigest(nonce),
      ).authoritative,
    ).toBe(true);
  });
  it('uses fixed Google authorization endpoint, minimum scopes and S256 PKCE', () => {
    const u = new URL(
      new GoogleOAuthProvider().authorization('state', 'nonce', 'challenge'),
    );
    expect(u.origin + u.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('nonce')).toBe('nonce');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('access_type')).not.toBe('offline');
  });
});
