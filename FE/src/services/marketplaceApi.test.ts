import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatPrice, marketplaceApi } from './marketplaceApi';

afterEach(() => vi.restoreAllMocks());

describe('marketplaceApi', () => {
  it('serializes server-side public filters, cursor and explicit false', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));
    await marketplaceApi.publicProducts({ limit: 24, categoryId: 2, storeId: 3, brandId: 4, inStock: false, afterId: 100 });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '24', categoryId: '2', storeId: '3', brandId: '4', inStock: 'false', afterId: '100' });
  });

  it.each([undefined, null, '', 'bad', 'Infinity', '0'])('does not display an invalid price: %s', (price) => {
    expect(formatPrice(price)).toBe('Liên hệ');
  });
  it('sends the hybrid search contract to Backend', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [], responseTimeMs: 4 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await marketplaceApi.search({ query: 'tai nghe', topK: 20, candidateK: 100 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/search\/hybrid$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'tai nghe', topK: 20, candidateK: 100 }),
      }),
    );
  });

  it('keeps multipart uploads free of a forced JSON content type', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 12 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const body = new FormData();
    body.set('file', new Blob(['image'], { type: 'image/png' }), 'demo.png');

    await marketplaceApi.addImage(12, body);

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.body).toBe(body);
    expect(new Headers(request.headers).has('Content-Type')).toBe(false);
  });
});
