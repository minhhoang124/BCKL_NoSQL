import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma.service.js';
import { SearchService } from './search.service.js';

type Handler = (requestBody: string) => {
  status?: number;
  body?: unknown;
  delayMs?: number;
};

async function startHttpService(handler: Handler): Promise<{
  server: Server;
  url: string;
}> {
  const server = createServer((request, response) => {
    let requestBody = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => (requestBody += chunk));
    request.on('end', () => {
      const result = handler(requestBody);
      setTimeout(() => {
        response.writeHead(result.status ?? 200, {
          'Content-Type': 'application/json',
        });
        response.end(JSON.stringify(result.body));
      }, result.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe('SearchService FastAPI runtime contract over real HTTP', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
    );
  });

  function service(url: string, timeoutMs = 1_000) {
    const transaction = vi.fn();
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const config = {
      get: (key: string) =>
        key === 'AI_SERVICE_URL'
          ? url
          : key === 'AI_SEARCH_TIMEOUT_MS'
            ? String(timeoutMs)
            : undefined,
    } as ConfigService;
    return { search: new SearchService(prisma, config), transaction };
  }

  it.each([
    {
      query: { type: 'text', text: 'headphones' },
      items: [],
      responseTimeMs: 1,
    },
    {
      query: { type: 'hybrid_text', text: 'headphones', debug: true },
      items: [],
      responseTimeMs: 1,
    },
    {
      query: { type: 'hybrid_text', text: 'headphones' },
      items: [{ productId: 1, rank: 1, score: 0.5, extra: true }],
      responseTimeMs: 1,
    },
  ])('rejects malformed HTTP 200 before PostgreSQL hydrate', async (body) => {
    const running = await startHttpService(() => ({ body }));
    servers.push(running.server);
    const { search, transaction } = service(running.url);

    await expect(search.hybrid({ query: 'headphones' })).rejects.toThrow(
      /Search Service response invalid/,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('aborts a slow real HTTP response at the configured timeout', async () => {
    const running = await startHttpService(() => ({
      delayMs: 250,
      body: {
        query: { type: 'hybrid_text', text: 'headphones' },
        items: [],
        responseTimeMs: 1,
      },
    }));
    servers.push(running.server);
    const { search, transaction } = service(running.url, 25);

    await expect(search.hybrid({ query: 'headphones' })).rejects.toThrow(
      /Search Service unreachable/,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});
