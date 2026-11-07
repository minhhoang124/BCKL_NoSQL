import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service.js';
import { SearchSyncWorker } from './search-sync.worker.js';

describe('SearchSyncWorker delivery', () => {
  const row = {
    id: 1n,
    productId: 10,
    version: 3,
    operation: 'UPSERT',
    payload: { productId: 10, version: 3 },
    status: 'PENDING',
    attemptCount: 0,
    processedAt: null,
    nextAttemptAt: null,
    updatedAt: new Date(0),
  };
  const ack = {
    productId: 10,
    version: 3,
    operation: 'UPSERT',
    outcome: 'APPLIED',
    indexes: {
      elasticsearch: { status: 'SUCCEEDED', version: 3 },
      faiss: { status: 'SUCCEEDED', version: 3 },
    },
  };
  let prisma: {
    searchOutbox: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let worker: SearchSyncWorker;
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    prisma = {
      searchOutbox: {
        findMany: vi.fn().mockResolvedValue([{ ...row }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    worker = new SearchSyncWorker(
      prisma as unknown as PrismaService,
      {
        get: (key: string) =>
          key === 'AI_SERVICE_URL' ? 'http://localhost:8000' : undefined,
      } as ConfigService,
    );
    request = vi.fn().mockResolvedValue({ status: 200, json: async () => ack });
    vi.stubGlobal('fetch', request);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const finalData = () =>
    prisma.searchOutbox.updateMany.mock.calls.at(-1)?.[0].data;

  it.each(['APPLIED', 'NOOP', 'STALE'])(
    'accepts a complete matching %s acknowledgement',
    async (outcome) => {
      request.mockResolvedValue({
        status: 200,
        json: async () => ({ ...ack, outcome }),
      });
      await worker.runBatch();
      expect(finalData().status).toBe('SUCCEEDED');
      expect(prisma.searchOutbox.updateMany.mock.calls[1][0].where).toEqual({
        id: 1n,
        status: 'PROCESSING',
        attemptCount: 1,
      });
    },
  );

  it.each([
    {},
    { ...ack, productId: 11 },
    { ...ack, version: 4 },
    { ...ack, operation: 'DELETE' },
    { ...ack, outcome: 'PARTIAL_FAILURE' },
    { ...ack, indexes: {} },
    {
      ...ack,
      indexes: { ...ack.indexes, faiss: { status: 'FAILED', version: 3 } },
    },
    {
      ...ack,
      indexes: { ...ack.indexes, faiss: { status: 'SUCCEEDED', version: 2 } },
    },
  ])('does not accept malformed/mismatched HTTP 200: %j', async (body) => {
    request.mockResolvedValue({ status: 200, json: async () => body });
    await worker.runBatch();
    expect(finalData()).toMatchObject({
      status: 'FAILED',
      processedAt: null,
      lastError: 'INVALID_ACKNOWLEDGEMENT',
    });
  });

  it('does not redispatch a terminal 409 on the second batch', async () => {
    request.mockResolvedValue({ status: 409 });
    await worker.runBatch();
    expect(finalData()).toMatchObject({
      status: 'FAILED',
      nextAttemptAt: null,
    });
    expect(finalData().processedAt).toBeInstanceOf(Date);
    // Query predicate excludes the persisted terminal row, not just nextAttemptAt.
    prisma.searchOutbox.findMany.mockImplementation(async ({ where }) => {
      expect(where.processedAt).toBeNull();
      return finalData().processedAt !== null ? [] : [row];
    });
    await worker.runBatch();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('backs off for 30 seconds first, then 120 seconds, preserving the payload', async () => {
    request.mockResolvedValue({ status: 503 });
    await worker.runBatch();
    expect(finalData().nextAttemptAt.getTime() - Date.now()).toBe(30_000);
    prisma.searchOutbox.findMany.mockResolvedValue([
      { ...row, status: 'FAILED', attemptCount: 1 },
    ]);
    await worker.runBatch();
    expect(finalData().nextAttemptAt.getTime() - Date.now()).toBe(120_000);
    expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
  });

  it('provides a 10-second abort signal and schedules retry after timeout', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    request.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            'abort',
            () => reject(new Error('timeout')),
            { once: true },
          );
        }),
    );
    const batch = worker.runBatch();
    await vi.advanceTimersByTimeAsync(10_000);
    await batch;
    expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000);
    expect(finalData()).toMatchObject({
      status: 'FAILED',
      processedAt: null,
      lastError: 'NETWORK_OR_TIMEOUT',
    });
  });

  it('recovers expired PROCESSING with a new fencing token', async () => {
    prisma.searchOutbox.findMany.mockResolvedValue([
      { ...row, status: 'PROCESSING', attemptCount: 2 },
    ]);
    await worker.runBatch();
    const claim = prisma.searchOutbox.updateMany.mock.calls[0][0];
    expect(claim.where.OR).toContainEqual({
      status: 'PROCESSING',
      updatedAt: { lte: new Date(Date.now() - 60_000) },
    });
    expect(claim.where.attemptCount).toBe(2);
    expect(claim.data.attemptCount).toEqual({ increment: 1 });
    expect(
      prisma.searchOutbox.updateMany.mock.calls[1][0].where.attemptCount,
    ).toBe(3);
  });

  it('old worker cannot finalize a lease recovered by another worker', async () => {
    let currentAttempt = 0;
    prisma.searchOutbox.updateMany.mockImplementation(
      async ({ where, data }) => {
        if (data.status === 'PROCESSING') {
          currentAttempt = 1;
          return { count: 1 };
        }
        return { count: where.attemptCount === currentAttempt ? 1 : 0 };
      },
    );
    request.mockImplementation(async () => {
      currentAttempt = 2; // Other worker reclaimed expired lease during a pause.
      return { status: 200, json: async () => ack };
    });
    await worker.runBatch();
    expect(
      prisma.searchOutbox.updateMany.mock.calls[1][0].where.attemptCount,
    ).toBe(1);
    expect(currentAttempt).toBe(2);
  });

  it('skips a lost claim without HTTP dispatch', async () => {
    prisma.searchOutbox.updateMany.mockResolvedValue({ count: 0 });
    await worker.runBatch();
    expect(request).not.toHaveBeenCalled();
  });

  it('dispatches DELETE with the immutable event version', async () => {
    prisma.searchOutbox.findMany.mockResolvedValue([
      { ...row, operation: 'DELETE' },
    ]);
    request.mockResolvedValue({
      status: 200,
      json: async () => ({ ...ack, operation: 'DELETE' }),
    });
    await worker.runBatch();
    expect(request).toHaveBeenCalledWith(
      'http://localhost:8000/index/product/10?version=3',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(finalData().status).toBe('SUCCEEDED');
  });

  it('empty batch has no writes', async () => {
    prisma.searchOutbox.findMany.mockResolvedValue([]);
    await worker.runBatch();
    expect(prisma.searchOutbox.updateMany).not.toHaveBeenCalled();
  });
});
