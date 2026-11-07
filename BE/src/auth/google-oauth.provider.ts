import { Injectable, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { isEmail } from 'class-validator';
import { createHash } from 'node:crypto';
import { googleConfig } from './google-oauth.config.js';
export type GoogleProfile = {
  subject: string;
  email: string;
  authoritative: boolean;
  fullName: string | null;
};
export const oauthDigest = (v: string) =>
  createHash('sha256').update(v).digest('hex');
export function googleProfile(
  payload: {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    hd?: string;
    name?: string;
    nonce?: unknown;
  },
  nonceHash: string,
): GoogleProfile {
  if (
    typeof payload.nonce !== 'string' ||
    oauthDigest(payload.nonce) !== nonceHash ||
    !/^[A-Za-z0-9_-]{1,255}$/.test(payload.sub ?? '') ||
    typeof payload.email !== 'string' ||
    payload.email.length > 254 ||
    !isEmail(payload.email) ||
    payload.email_verified !== true
  )
    throw new UnauthorizedException({ code: 'GOOGLE_OAUTH_INVALID' });
  const email = payload.email.toLowerCase();
  return {
    subject: payload.sub!,
    email,
    authoritative:
      email.endsWith('@gmail.com') ||
      (typeof payload.hd === 'string' && !!payload.hd),
    fullName:
      typeof payload.name === 'string'
        ? payload.name
            .normalize('NFC')
            // oxlint-disable-next-line no-control-regex -- Strip control characters from provider display names.
            .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
            .slice(0, 100)
            .trim() || null
        : null,
  };
}
@Injectable()
export class GoogleOAuthProvider {
  private client() {
    const c = googleConfig();
    return new OAuth2Client({
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      redirectUri: c.callback,
      transporterOptions: { timeout: 8000, retry: false, maxRedirects: 0 },
    });
  }
  authorization(state: string, nonce: string, codeChallenge: string) {
    const u = new URL(
      this.client().generateAuthUrl({
        scope: ['openid', 'email', 'profile'],
        state,
        prompt: 'select_account',
      }),
    );
    u.searchParams.set('nonce', nonce);
    u.searchParams.set('code_challenge', codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }
  async exchange(code: string, verifier: string, nonceHash: string) {
    try {
      const client = this.client();
      // Abort the actual token request; do not leave a background exchange after a Promise.race timeout.
      const result = await client.getToken({ code, codeVerifier: verifier });
      if (!result.tokens.id_token) throw Error();
      const ticket = await client.verifyIdToken({
        idToken: result.tokens.id_token,
        audience: googleConfig().clientId,
      });
      const payload = ticket.getPayload();
      if (!payload) throw Error();
      return googleProfile(payload, nonceHash);
    } catch {
      throw new UnauthorizedException({ code: 'GOOGLE_OAUTH_INVALID' });
    }
  }
}
