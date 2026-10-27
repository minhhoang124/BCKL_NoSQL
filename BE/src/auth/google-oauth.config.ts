import { ServiceUnavailableException } from '@nestjs/common';
export function googleConfig() {
  try {
    if (process.env.AUTH_GOOGLE_ENABLED !== 'true') throw Error();
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET ?? '',
      callback = new URL(process.env.GOOGLE_OAUTH_CALLBACK_URL ?? ''),
      web = new URL(process.env.GOOGLE_OAUTH_WEB_ORIGIN ?? '');
    const trusted = (u: URL) =>
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.protocol === 'https:' ||
        (process.env.NODE_ENV !== 'production' &&
          u.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(u.hostname)));
    if (
      !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) ||
      clientSecret.length < 16 ||
      /[\r\n]/.test(clientSecret) ||
      Buffer.byteLength(stateSecret) < 32 ||
      !trusted(callback) ||
      !trusted(web) ||
      web.pathname !== '/' ||
      callback.pathname !== '/auth/google/callback'
    )
      throw Error();
    return {
      clientId,
      clientSecret,
      stateSecret,
      callback: callback.toString(),
      web: web.origin,
      secure: callback.protocol === 'https:',
    };
  } catch {
    throw new ServiceUnavailableException({
      code: 'GOOGLE_OAUTH_NOT_CONFIGURED',
    });
  }
}
