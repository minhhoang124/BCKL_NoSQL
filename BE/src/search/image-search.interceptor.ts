import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { finalize } from 'rxjs';

/** Local ingress protection, not a distributed quota or transaction lock. */
@Injectable()
export class ImageSearchInterceptor implements NestInterceptor {
  private active = 0;
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private nextCleanup = 0;

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    if (request.originalUrl.includes('?'))
      throw new BadRequestException(
        'Image search does not accept query parameters',
      );
    const now = Date.now();
    if (now >= this.nextCleanup) {
      for (const [key, bucket] of this.buckets)
        if (bucket.resetAt <= now) this.buckets.delete(key);
      this.nextCleanup = now + 60000;
    }
    // Express trust proxy is off by default. Never take X-Forwarded-For directly.
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const previous = this.buckets.get(key);
    const bucket =
      !previous || previous.resetAt <= now
        ? { count: 0, resetAt: now + 60000 }
        : previous;
    if (
      bucket.count >= 10 ||
      (!this.buckets.has(key) && this.buckets.size >= 10000)
    ) {
      response.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
      );
      throw new HttpException('Too many image searches', 429);
    }
    bucket.count++;
    this.buckets.set(key, bucket);
    if (this.active >= 2) {
      response.setHeader('Retry-After', '1');
      throw new HttpException('Image search busy', 503);
    }
    this.active++;
    let released = false;
    const onAbort = () => {
      if (!request.complete) release();
    };
    const uploadDeadline = setTimeout(() => {
      if (!request.complete) {
        // A slow/trickling multipart stream must not hold both memory slots
        // indefinitely. Destroy the input stream as well as releasing the slot.
        request.destroy();
        release();
      }
    }, 15000);
    uploadDeadline.unref();
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(uploadDeadline);
      request.removeListener('aborted', onAbort);
      this.active--;
    };
    request.once('aborted', onAbort);
    // Covers multipart parsing as well as decode/upstream/hydrate. The slot is
    // retained until the handler actually finishes, not released on socket close.
    try {
      return next.handle().pipe(finalize(release));
    } catch (error) {
      release();
      throw error;
    }
  }
}
