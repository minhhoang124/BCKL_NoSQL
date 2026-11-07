import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ErrorRequestHandler, Request, Response } from 'express';

const sessionWrite = (req: { method?: string; url?: string }) =>
  req.method === 'POST' &&
  /^\/auth\/(?:register|login|refresh|logout)\/?$/i.test(
    (req.url ?? '').split('?')[0],
  );

export function registerAuthSessionHttp(app: INestApplication): void {
  app.use((req: Request, res: Response, next: () => void) => {
    if (!sessionWrite(req)) return next();
    res.setHeader('Cache-Control', 'no-store');
    const trusted = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const origin = req.get('origin');
    // Native/server API clients may omit browser headers. Browser requests must
    // provide the exact configured Origin; no suffix matching or forwarded host.
    const browserWithoutOrigin =
      origin === undefined &&
      (req.get('sec-fetch-site') !== undefined ||
        req.get('sec-fetch-mode') !== undefined ||
        req.get('sec-fetch-dest') !== undefined ||
        req.get('sec-fetch-user') !== undefined);
    if ((origin !== undefined && origin !== trusted) || browserWithoutOrigin) {
      res.status(403).json({ statusCode: 403, code: 'AUTH_ORIGIN_REJECTED' });
      return;
    }
    const type = req.get('content-type');
    const credentialBody = /^\/auth\/(?:register|login)\/?$/i.test(req.path);
    if (
      req.originalUrl.includes('?') ||
      (type === undefined &&
        (req.headers['transfer-encoding'] !== undefined ||
          (req.headers['content-length'] !== undefined &&
            req.headers['content-length'] !== '0'))) ||
      req.get('content-encoding') !== undefined ||
      ((credentialBody || type !== undefined) &&
        !/^application\/json(?:\s*;|\s*$)/i.test(type ?? ''))
    ) {
      res
        .status(400)
        .json({ statusCode: 400, code: 'AUTH_SESSION_INVALID_INPUT' });
      return;
    }
    next();
  });
  (app as NestExpressApplication).useBodyParser('json', {
    type: sessionWrite,
    strict: true,
    limit: 8192,
    inflate: false,
  });
  const errors: ErrorRequestHandler = (error: unknown, req, res, next) => {
    if (!sessionWrite(req)) return next(error);
    const status =
      error &&
      typeof error === 'object' &&
      'type' in error &&
      error.type === 'entity.too.large'
        ? 413
        : 400;
    res
      .status(status)
      .json({ statusCode: status, code: 'AUTH_SESSION_INVALID_INPUT' });
  };
  app.use(errors);
}
