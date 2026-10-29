import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { configureOrderListHttp } from './order/order-list.http.js';
import { registerOrderDeliveryParser } from './order/order-delivery.http.js';
import { registerOrderReturnedParser } from './order/order-returned.http.js';
import { registerOrderCompletionParser } from './order/order-completion.http.js';
import { registerCheckoutParser } from './checkout/checkout-http.js';
import { registerOrderCancellationParser } from './order/order-cancellation.http.js';
import { registerSellerOrderCommandParser } from './order/seller-order-command.http.js';
import { configureAccountListHttp } from './auth/admin-account-list.js';
import { registerAttributeWriteParser } from './catalog/admin-attribute-write.http.js';
import { registerAccountSettingsHttp } from './auth/account-settings.http.js';
import { registerAuthSessionHttp } from './auth/auth-session.http.js';

export function configureApp(app: INestApplication): void {
  // Preflight is transport negotiation, not a business write. Handle before body/query gates.
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    exposedHeaders: ['Retry-After'],
  });

  // Apply before guards/validation as sensitive Admin failures must not be cached either.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (/^\/(?:search(?:\/|$)|(?:seller|admin)\/search-analytics(?:\/|$))/i.test(req.path)) {
      res.setHeader('Cache-Control','no-store');
      const read = ['GET','HEAD'].includes(req.method);
      if ((!read && req.originalUrl.includes('?')) || (read && (req.headers['transfer-encoding']!==undefined || (req.headers['content-length']!==undefined && req.headers['content-length']!=='0')))) {res.status(400).json({statusCode:400,code:'SEARCH_ANALYTICS_INVALID_INPUT'});return;}
    }
    if (/^\/stores(?:\/|$)/i.test(req.path)) {
      res.setHeader('Cache-Control','no-store');
      if(['GET','HEAD'].includes(req.method)&&(req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))){res.status(400).json({statusCode:400,code:'PUBLIC_STORE_INVALID_INPUT'});return;}
    }
    if (/^\/payments\/vnpay(?:\/|$)/i.test(req.path)) {
      res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','no-referrer');
    }
    if(/^\/account\/notifications(?:\/|$)/i.test(req.path)){
      res.setHeader('Cache-Control','no-store');const read=['GET','HEAD'].includes(req.method);
      if((!read&&req.originalUrl.includes('?'))||(read&&(req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0')))){res.status(400).json({statusCode:400,code:'NOTIFICATION_INVALID_INPUT'});return;}
    }
    if (/^\/(?:products\/[^/]+\/reviews|account\/order-items\/[^/]+\/review|seller\/reviews|admin\/reviews|review-commands)(?:\/|$)/i.test(req.path)) {
      res.setHeader('Cache-Control','no-store');
      const read=['GET','HEAD'].includes(req.method);
      if ((!read&&req.originalUrl.includes('?'))||(read&&(req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0')))) {res.status(400).json({statusCode:400,code:'REVIEW_INVALID_INPUT'});return;}
    }
    if (/^\/(?:account\/store-application|admin\/store-applications)(?:\/|$)/i.test(req.path)) {
      res.setHeader('Cache-Control', 'no-store');
      const read = ['GET','HEAD'].includes(req.method);
      if ((!read && req.originalUrl.includes('?')) || (read && (req.headers['transfer-encoding'] !== undefined || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')))) {
        res.status(400).json({statusCode:400,code:'STORE_APPLICATION_INVALID_INPUT'}); return;
      }
    }
    if (/^\/(?:admin|seller)\/dashboard(?:\/|$)/i.test(req.path)) {
      res.setHeader('Cache-Control', 'no-store');
      if (['GET', 'HEAD'].includes(req.method) &&
          (req.headers['transfer-encoding'] !== undefined || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0'))) {
        res.status(400).json({ statusCode: 400, code: 'DASHBOARD_BODY_NOT_ALLOWED' }); return;
      }
    }
    if (/^\/(?:seller\/|admin\/)?aftersales(?:\/|$)/i.test(req.path)) {
      res.setHeader('Cache-Control', 'no-store');
    }
    if (/^\/admin\/system-health\/?$/i.test(req.path)) {
      res.setHeader('Cache-Control', 'no-store');
      if ((req.method === 'GET' || req.method === 'HEAD') &&
          (req.originalUrl.includes('?') || req.headers['transfer-encoding'] !== undefined ||
           (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0'))) {
        res.status(400).json({ statusCode: 400, message: 'Health does not accept query or body.' });
        return;
      }
    }
    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      /^\/admin\/categories\/[^/]+\/attributes(?:\/|$)/i.test(req.path)
    ) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });
  configureAccountListHttp(app);
  registerAuthSessionHttp(app);
  registerAccountSettingsHttp(app);
  // Reject unsupported Order GET bodies before any JSON parser is registered.
  configureOrderListHttp(app);
  registerAttributeWriteParser(app);
  registerSellerOrderCommandParser(app);
  registerOrderCancellationParser(app);
  registerOrderDeliveryParser(app);
  registerOrderReturnedParser(app);
  registerOrderCompletionParser(app);
  // After CORS (so browser clients can read safe parser errors), before Nest's
  // default body parser; only Checkout POST routes use the 64 KiB limit.
  registerCheckoutParser(app);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
