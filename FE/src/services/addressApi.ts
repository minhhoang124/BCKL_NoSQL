import { fetchApi } from './apiClient';
import type { Address, AddressInput, AddressList } from '../types/address';

export const addressApi = {
  list: (signal?: AbortSignal) => fetchApi<AddressList>('/me/addresses', { cache: 'no-store', signal }),
  create: (body: AddressInput) => fetchApi<Address>('/me/addresses', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: Partial<AddressInput>) => fetchApi<Address>(`/me/addresses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  setDefault: (id: number) => fetchApi<Address>(`/me/addresses/${id}/default`, { method: 'PUT', body: '{}' }),
  remove: async (id: number): Promise<void> => {
    await fetchApi(`/me/addresses/${id}`, { method: 'DELETE' });
  },
};
