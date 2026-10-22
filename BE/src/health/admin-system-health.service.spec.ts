import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma.service.js';
import { AdminSystemHealthService } from './admin-system-health.service.js';
const instant = Date.parse('2026-10-16T06:00:01.000Z');
const snapshot = () =>
  JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../docs/api/examples/search-health-proposed-v1.json',
      ),
      'utf8',
    ),
  );
function setup(
  config = new ConfigService({
    AI_SERVICE_URL: 'http://127.0.0.1:8000',
    SEARCH_INTERNAL_HEALTH_TOKEN: 'test-private-health-token',
  }),
) {
  const actor = vi.fn().mockResolvedValue({ role: 'ADMIN', isActive: true });
  const tx = { $executeRawUnsafe: vi.fn(), user: { findUnique: actor } };
  const prisma = { $transaction: vi.fn(async (work) => work(tx)) };
  const service = new AdminSystemHealthService(
    prisma as unknown as PrismaService,
    config,
  );
  return { service, actor };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('Admin Search health collection', () => {
  it('expires server cache after 15 monotonic seconds and keeps response mutation outside cache', async () => {
    let tick = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => tick);
    vi.spyOn(Date, 'now').mockReturnValue(instant);
    const http = vi.fn(async () => Response.json(snapshot()));
    vi.stubGlobal('fetch', http);
    const { service } = setup();
    const first = await service.read(1);
    first.search.snapshot!.components.faiss.vectorCount = 99999;
    expect(
      (await service.read(1)).search.snapshot!.components.faiss.vectorCount,
    ).toBe(2);
    tick = 15001;
    await service.read(1);
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('does not reuse a cached healthy observation after the consumer clock moves backwards', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(instant);
    const http = vi.fn().mockResolvedValue(Response.json(snapshot()));
    vi.stubGlobal('fetch', http);
    const { service } = setup();
    expect((await service.read(1)).search.errorCode).toBeNull();
    clock.mockReturnValue(instant - 6000);
    expect((await service.read(1)).search).toMatchObject({
      status: 'UNKNOWN',
      errorCode: 'AI_INVALID_RESPONSE',
      snapshot: null,
    });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('single-flight/caches AI only, but rechecks every actor before and after the await', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(instant);
    const http = vi.fn().mockResolvedValue(Response.json(snapshot()));
    vi.stubGlobal('fetch', http);
    const { service, actor } = setup();
    const [a, b] = await Promise.all([service.read(1), service.read(2)]);
    expect(http).toHaveBeenCalledTimes(1);
    expect(actor).toHaveBeenCalledTimes(4);
    expect(a.search.status).toBe('DEGRADED');
    expect(a.search).toEqual(b.search);
    await service.read(1);
    expect(http).toHaveBeenCalledTimes(1);
    expect(actor).toHaveBeenCalledTimes(6);
    expect(http.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
    });
    expect(JSON.stringify(a)).not.toContain('test-private-health-token');
  });
  it('does not disclose the result if Admin is disabled during HTTP', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(instant);
    const { service, actor } = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        actor.mockResolvedValue({ role: 'ADMIN', isActive: false });
        return Response.json(snapshot());
      }),
    );
    await expect(service.read(1)).rejects.toThrow('Unauthorized');
  });
  it('never calls AI for a non-Admin or missing actor', async () => {
    const http = vi.fn();
    vi.stubGlobal('fetch', http);
    const { service, actor } = setup();
    actor.mockResolvedValue({ role: 'USER', isActive: true });
    await expect(service.read(1)).rejects.toThrow('Forbidden');
    actor.mockResolvedValue(null);
    await expect(service.read(1)).rejects.toThrow('Unauthorized');
    expect(http).not.toHaveBeenCalled();
  });
  it.each([
    'extra',
    'missing',
    'oversize',
    'invalid-json',
    'wrong-content-type',
  ])('rejects malformed HTTP 200: %s', async (kind) => {
    vi.spyOn(Date, 'now').mockReturnValue(instant);
    let response: Response;
    if (kind === 'extra')
      response = Response.json({ ...snapshot(), privatePath: '/private' });
    else if (kind === 'missing') response = Response.json({ schemaVersion: 1 });
    else if (kind === 'oversize')
      response = new Response('x'.repeat(32769), {
        headers: { 'content-type': 'application/json' },
      });
    else if (kind === 'invalid-json')
      response = new Response('{bad', {
        headers: { 'content-type': 'application/json' },
      });
    else
      response = new Response('{}', {
        headers: { 'content-type': 'text/html' },
      });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const result = await setup().service.read(1);
    expect(result.search).toMatchObject({
      status: 'UNKNOWN',
      errorCode: 'AI_INVALID_RESPONSE',
      snapshot: null,
    });
    expect(JSON.stringify(result)).not.toContain('/private');
  });
  it('bounds even a stuck fetch to two seconds without retry', async () => {
    vi.useFakeTimers();
    const http = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', http);
    const result = setup().service.read(1);
    await vi.advanceTimersByTimeAsync(2001);
    expect((await result).search.errorCode).toBe('AI_TIMEOUT');
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
  it('bounds a stalled body, not just response headers', async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({ start() {} });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body, {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const result = setup().service.read(1);
    await vi.advanceTimersByTimeAsync(2001);
    expect((await result).search.errorCode).toBe('AI_TIMEOUT');
  });
  it('missing internal token is UNKNOWN without a network request', async () => {
    const http = vi.fn();
    vi.stubGlobal('fetch', http);
    const { service } = setup(new ConfigService());
    expect((await service.read(1)).search.errorCode).toBe('AI_UNREACHABLE');
    expect(http).not.toHaveBeenCalled();
  });
});
