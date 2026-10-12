import { fetchApi } from './apiClient';
import type { CartResponse } from '../types/cart';

export const cartApi = {
  list: (signal?: AbortSignal) => fetchApi<CartResponse>('/cart', { cache: 'no-store', signal }),
  put: (variantId: number, quantity: number) => fetchApi<CartResponse>(`/cart/items/${variantId}`, {
    method: 'PUT', body: JSON.stringify({ quantity }),
  }),
  remove: async (variantId: number): Promise<void> => {
    await fetchApi(`/cart/items/${variantId}`, { method: 'DELETE' });
  },
};
