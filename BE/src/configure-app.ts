import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { configureOrderListHttp } from './order/order-list.http.js';
import { registerCheckoutParser } from './checkout/checkout-http.js';
import { registerSellerOrderCommandParser } from './order/seller-order-command.http.js';

export function configureApp(app: INestApplication): void {
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    exposedHeaders: ['Retry-After'],
  });
  // Reject unsupported Order GET bodies before any JSON parser is registered.
  configureOrderListHttp(app);
  registerSellerOrderCommandParser(app);
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
