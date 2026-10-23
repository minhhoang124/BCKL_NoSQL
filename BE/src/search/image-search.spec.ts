import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication, ExecutionContext } from '@nestjs/common';
import { createServer, request as nativeRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Subject, lastValueFrom, of, throwError } from 'rxjs';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureApp } from '../configure-app.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';
import { ImageSearchInterceptor } from './image-search.interceptor.js';
import {
  ImageSearchService,
  parseImageSearchOptions,
  validateImageSearchResponse,
} from './image-search.service.js';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../AI_CLIP/tests/fixtures/backend_contract/image_search_response.generated.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const example = fixture.example;
const options = { topK: 10, candidateK: 30 };

describe('image wire from actual Pydantic models', () => {
  it('is pinned to canonical source and handles exclude-none image query', () => {
    const source = readFileSync(
      new URL('../../../AI_CLIP/app/schemas/search.py', import.meta.url),
      'utf8',
    ).replaceAll('\r\n', '\n');
    expect(createHash('sha256').update(source).digest('hex')).toBe(
      fixture.sourceSha256Lf,
    );
    const router = readFileSync(
      new URL('../../../AI_CLIP/app/routers/search.py', import.meta.url),
      'utf8',
    ).replaceAll('\r\n', '\n');
    expect(createHash('sha256').update(router).digest('hex')).toBe(
      fixture.routerSha256Lf,
    );
    expect(validateImageSearchResponse(example, options)).toEqual(example);
  });
  it.each([
    null,
    [],
    { ...example, extra: true },
    { ...example, query: { ...example.query, text: null } },
    { ...example, query: { ...example.query, type: 'hybrid_text' } },
    { ...example, query: { ...example.query, topK: 9 } },
    { ...example, query: { ...example.query, candidateK: 29 } },
    { ...example, responseTimeMs: -1 },
    { ...example, responseTimeMs: Infinity },
    ...[0, -1, '125', 2147483648, 1.5].map((productId) => ({
      ...example,
      items: [{ productId, rank: 1, score: 0.5 }],
    })),
    ...[0, 11, '1', NaN].map((rank) => ({
      ...example,
      items: [{ productId: 125, rank, score: 0.5 }],
    })),
    ...[Infinity, NaN, '0.5'].map((score) => ({
      ...example,
      items: [{ productId: 125, rank: 1, score }],
    })),
    {
      ...example,
      items: [{ productId: 125, rank: 1, score: 0.5, name: 'private' }],
    },
  ])('rejects invalid envelope/item before hydrate %#', (raw) =>
    expect(() => validateImageSearchResponse(raw, options)).toThrow(),
  );
  it.each([
    { topK: '0' },
    { topK: '51' },
    { topK: '01' },
    { topK: ['1', '2'] },
    { candidateK: '' },
    { topK: '20', candidateK: '10' },
    { unknown: '1' },
    { candidateK: '151' },
  ])('rejects invalid multipart fields %#', (raw) =>
    expect(() => parseImageSearchOptions(raw)).toThrow(),
  );
  it('matches canonical defaults and allows negative finite cosine scores', () => {
    expect(parseImageSearchOptions({})).toEqual(options);
    expect(parseImageSearchOptions({ topK: '50' })).toEqual({
      topK: 50,
      candidateK: 150,
    });
    expect(
      validateImageSearchResponse(
        { ...example, items: [{ productId: 125, rank: 1, score: -0.5 }] },
        options,
      ).items,
    ).toHaveLength(1);
  });
});

describe('image upload controller and real HTTP transport (NOT loaded CLIP integration)', () => {
  let app: INestApplication, server: Server, png: Buffer;
  let body: unknown = example,
    status = 200,
    delay = 0,
    responseText: string | undefined;
  let contentType = 'application/json';
  let stallBody = false;
  const hydrate = vi.fn(async (value: unknown) => value);
  const calls: {
    url: string | undefined;
    contentType: string | undefined;
    bytes: Buffer;
  }[] = [];
  let service: ImageSearchService;
  beforeAll(async () => {
    png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer();
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const part of req) chunks.push(Buffer.from(part));
      calls.push({
        url: req.url,
        contentType: req.headers['content-type'],
        bytes: Buffer.concat(chunks),
      });
      const text = responseText ?? JSON.stringify(body);
      if (stallBody) {
        res.writeHead(200, { 'Content-Type': contentType });
        res.flushHeaders();
        setTimeout(() => res.end(text), 1300);
        return;
      }
      setTimeout(() => {
        res.writeHead(status, {
          'Content-Type': contentType,
          ...(status === 302 ? { Location: '/redirected' } : {}),
        });
        res.end(text);
      }, delay);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = {
      get: (key: string) => (key === 'AI_SERVICE_URL' ? url : '1000'),
    } as ConfigService;
    const module = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        ImageSearchService,
        ImageSearchInterceptor,
        { provide: SearchService, useValue: { hydrate } },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    service = app.get(ImageSearchService);
  });
  afterAll(async () => {
    await app?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('forwards JPEG/PNG memory-only with generated filename and hydrates the canonical response', async () => {
    const res = await request(app.getHttpServer())
      .post('/search/image')
      .attach('image', png, {
        filename: '../private-file.png',
        contentType: 'image/png',
      })
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(hydrate).toHaveBeenLastCalledWith(example, { topK: 10 });
    expect(calls[0].url).toBe('/search/image');
    expect(calls[0].contentType).toMatch(/^multipart\/form-data; boundary=/);
    const wire = calls[0].bytes.toString('latin1');
    expect(wire).toContain('filename="query.png"');
    expect(wire).not.toContain('private-file');
    expect(wire).toContain('name="candidateK"\r\n\r\n30');
  });
  it('rejects missing image', async () => {
    await request(app.getHttpServer())
      .post('/search/image')
      .field('topK', '10')
      .expect(400);
  });
  it('rejects SVG disguised as PNG before upstream', async () => {
    await request(app.getHttpServer())
      .post('/search/image')
      .attach('image', Buffer.from('<svg/>'), 'fake.png')
      .expect(415);
  });
  it('rejects truncated PNG and mismatched MIME before upstream', async () => {
    await request(app.getHttpServer())
      .post('/search/image')
      .attach('image', png.subarray(0, 24), 'broken.png')
      .expect(400);
    await request(app.getHttpServer())
      .post('/search/image')
      .attach('image', png, {
        filename: 'false.jpg',
        contentType: 'image/jpeg',
      })
      .expect(415);
  });
  it('rejects duplicate file fields before upstream', async () => {
    await request(app.getHttpServer())
      .post('/search/image')
      .attach('image', png, 'a.png')
      .attach('image', png, 'b.png')
      .expect(400);
  });
  it('keeps the 5 MiB parser bound', async () => {
    await request(app.getHttpServer())
      .post('/search/image')
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'large.png')
      .expect(413);
  });
  it('rejects query parameters before parser', async () => {
    await request(app.getHttpServer())
      .post('/search/image?topK=10')
      .attach('image', png, 'a.png')
      .expect(400);
  });
  it('rejects duplicate text fields', async () => {
    await request(app.getHttpServer())
      .post('/search/image')
      .field('topK', '1')
      .field('topK', '2')
      .attach('image', png, 'a.png')
      .expect(400);
  });
  it('rejects malformed HTTP200 and oversized response before hydrate', async () => {
    const file = {
      buffer: png,
      size: png.length,
      originalname: 'x.png',
      mimetype: 'image/png',
    };
    const before = hydrate.mock.calls.length;
    body = { ...example, query: { ...example.query, type: 'text' } };
    await expect(service.image(file, {})).rejects.toMatchObject({
      status: 502,
    });
    responseText = ' '.repeat(65537);
    await expect(service.image(file, {})).rejects.toMatchObject({
      status: 502,
    });
    responseText = undefined;
    body = example;
    expect(hydrate.mock.calls).toHaveLength(before);
  });
  it('rejects nonJSON/redirect/upstream errors, and aborts the entire body deadline', async () => {
    const file = {
      buffer: png,
      size: png.length,
      originalname: 'x.png',
      mimetype: 'image/png',
    };
    const before = hydrate.mock.calls.length;
    contentType = 'text/html';
    await expect(service.image(file, {})).rejects.toMatchObject({
      status: 502,
    });
    contentType = 'application/json';
    status = 302;
    const sent = calls.length;
    await expect(service.image(file, {})).rejects.toMatchObject({
      status: 503,
    });
    expect(calls.length).toBe(sent + 1);
    status = 503;
    await expect(service.image(file, {})).rejects.toMatchObject({
      status: 503,
    });
    status = 200;
    delay = 1300;
    const started = Date.now();
    await expect(service.image(file, {})).rejects.toMatchObject({
      status: 503,
    });
    expect(Date.now() - started).toBeLessThan(1800);
    delay = 0;
    stallBody = true;
    await expect(service.image(file, {})).rejects.toMatchObject({
      status: 503,
    });
    stallBody = false;
    expect(hydrate.mock.calls).toHaveLength(before);
  });
  it('cuts off a real unfinished multipart stream and can accept the next request', async () => {
    const before = calls.length;
    const started = Date.now();
    const url = await app.getUrl();
    await new Promise<void>((resolve, reject) => {
      const pending = nativeRequest(url + '/search/image', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=slow-query',
          'Transfer-Encoding': 'chunked',
        },
      });
      pending.on('error', (error: NodeJS.ErrnoException) =>
        error.code === 'ECONNRESET' ? resolve() : reject(error),
      );
      pending.on('response', (res) => {
        res.resume();
        reject(new Error('Unexpected upload response'));
      });
      pending.write(
        '--slow-query\r\nContent-Disposition: form-data; name="image"; filename="slow.png"\r\nContent-Type: image/png\r\n\r\n',
      );
      // Intentionally never end the multipart request. The server must cut it.
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(14000);
    expect(Date.now() - started).toBeLessThan(19000);
    expect(calls.length).toBe(before);
    await request(app.getHttpServer())
      .post('/search/image')
      .attach('image', png, 'after.png')
      .expect(200);
  }, 22000);
});

describe('ingress concurrency and quota before memory upload', () => {
  function context(ip = '127.0.0.1') {
    const setHeader = vi.fn();
    const input = Object.assign(new EventEmitter(), {
      originalUrl: '/search/image',
      ip,
      complete: true,
      destroy: vi.fn(),
    });
    return {
      setHeader,
      input,
      context: {
        switchToHttp: () => ({
          getRequest: () => input,
          getResponse: () => ({ setHeader }),
        }),
      } as unknown as ExecutionContext,
    };
  }
  it('rejects the third active request and releases slots on success/error', async () => {
    const gate = new ImageSearchInterceptor(),
      ctx = context();
    const first = new Subject(),
      second = new Subject();
    const a = gate.intercept(ctx.context, { handle: () => first }).subscribe();
    const b = gate.intercept(ctx.context, { handle: () => second }).subscribe();
    expect(() => gate.intercept(ctx.context, { handle: () => of(1) })).toThrow(
      'Image search busy',
    );
    first.complete();
    second.complete();
    a.unsubscribe();
    b.unsubscribe();
    await expect(
      lastValueFrom(
        gate.intercept(ctx.context, {
          handle: () => throwError(() => new Error('parse failed')),
        }),
      ),
    ).rejects.toThrow('parse failed');
    expect(
      await lastValueFrom(gate.intercept(ctx.context, { handle: () => of(1) })),
    ).toBe(1);
  });
  it('caps a live IP bucket and permits expiry', async () => {
    const gate = new ImageSearchInterceptor(),
      ctx = context();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100000);
    try {
      for (let i = 0; i < 10; i++)
        await lastValueFrom(
          gate.intercept(ctx.context, { handle: () => of(1) }),
        );
      expect(() =>
        gate.intercept(ctx.context, { handle: () => of(1) }),
      ).toThrow('Too many image searches');
      expect(ctx.setHeader).toHaveBeenCalledWith('Retry-After', '60');
      clock.mockReturnValue(160001);
      expect(
        await lastValueFrom(
          gate.intercept(ctx.context, { handle: () => of(1) }),
        ),
      ).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });
  it('resets an expired later bucket even before periodic cleanup', async () => {
    const gate = new ImageSearchInterceptor(),
      first = context('first'),
      later = context('later');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100000);
    try {
      await lastValueFrom(
        gate.intercept(first.context, { handle: () => of(1) }),
      );
      clock.mockReturnValue(130000);
      for (let i = 0; i < 10; i++)
        await lastValueFrom(
          gate.intercept(later.context, { handle: () => of(1) }),
        );
      clock.mockReturnValue(160001);
      await lastValueFrom(
        gate.intercept(first.context, { handle: () => of(1) }),
      );
      clock.mockReturnValue(190001);
      expect(
        await lastValueFrom(
          gate.intercept(later.context, { handle: () => of(1) }),
        ),
      ).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });
  it('destroys unfinished upload streams after15s and releases exactly once', async () => {
    vi.useFakeTimers();
    const gate = new ImageSearchInterceptor(),
      ctx = context();
    ctx.input.complete = false;
    const pending = new Subject();
    const subscription = gate
      .intercept(ctx.context, { handle: () => pending })
      .subscribe();
    try {
      await vi.advanceTimersByTimeAsync(15001);
      expect(ctx.input.destroy).toHaveBeenCalledOnce();
      ctx.input.emit('aborted');
      subscription.unsubscribe();
      const a = gate
        .intercept(context('a').context, { handle: () => pending })
        .subscribe();
      const b = gate
        .intercept(context('b').context, { handle: () => pending })
        .subscribe();
      expect(() =>
        gate.intercept(context('c').context, { handle: () => of(1) }),
      ).toThrow('Image search busy');
      a.unsubscribe();
      b.unsubscribe();
    } finally {
      subscription.unsubscribe();
      vi.useRealTimers();
    }
  });
});
