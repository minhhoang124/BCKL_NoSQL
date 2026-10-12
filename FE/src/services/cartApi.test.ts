import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cartApi } from './cartApi';
import { fetchApi } from './apiClient';

vi.mock('./apiClient', () => ({ fetchApi: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe('Cart API adapter', () => {
  it('uses no-store GET and absolute PUT quantity', async () => {
    vi.mocked(fetchApi).mockResolvedValue({});
    const signal = new AbortController().signal;
    await cartApi.list(signal);
    await cartApi.put(125, 2);
    expect(fetchApi).toHaveBeenNthCalledWith(1, '/cart', { cache: 'no-store', signal });
    expect(fetchApi).toHaveBeenNthCalledWith(2, '/cart/items/125', { method: 'PUT', body: '{"quantity":2}' });
  });

  it('deletes with no request body', async () => {
    vi.mocked(fetchApi).mockResolvedValue(undefined);
    await cartApi.remove(125);
    expect(fetchApi).toHaveBeenCalledWith('/cart/items/125', { method: 'DELETE' });
  });
});
