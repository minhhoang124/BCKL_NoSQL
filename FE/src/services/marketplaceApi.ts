import { API_URL, fetchApi } from './apiClient';
import type { AttributeDefinition, AttributeInput, Brand, Category, Page, Product, SearchResponse, Store, StoreStatus } from '../types/marketplace';

export const formatPrice = (value?: string | null) =>
  value?.trim() && Number.isFinite(Number(value)) && Number(value) > 0
    ? `${Number(value).toLocaleString('vi-VN')} ₫`
    : 'Liên hệ';

export const mediaUrl = (url?: string) => {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};
export const marketplaceApi = {
  categories: () => fetchApi<Category[]>('/categories'),
  brands: () => fetchApi<Brand[]>('/brands'),
  publicProducts: (filters: { limit?: number; afterId?: number; categoryId?: number; storeId?: number; brandId?: number; inStock?: boolean } = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) params.set(key, String(value));
    }
    return fetchApi<Page<Product>>(`/products${params.size ? `?${params}` : ''}`);
  },
  publicProduct: (id: number) => fetchApi<Product>(`/products/${id}`),
  search: (body: Record<string, unknown>) => fetchApi<SearchResponse>('/search/hybrid', { method: 'POST', body: JSON.stringify(body) }),

  myStore: () => fetchApi<Store>('/seller/store'),
  createStore: (body: { name: string; description?: string }) => fetchApi<Store>('/seller/store', { method: 'POST', body: JSON.stringify(body) }),
  updateStore: (body: { name?: string; description?: string | null }) => fetchApi<Store>('/seller/store', { method: 'PATCH', body: JSON.stringify(body) }),
  resubmitStore: () => fetchApi<Store>('/seller/store/resubmit', { method: 'POST' }),
  myProducts: () => fetchApi<Product[]>('/seller/products'),
  myProduct: (id: number) => fetchApi<Product>(`/seller/products/${id}`),
  categoryAttributes: (id: number) => fetchApi<{ id: number; attributeDefinitions: AttributeDefinition[] }>(`/categories/${id}/attributes`),
  addOptionGroup: (id: number, body: { name: string; position: number }) => fetchApi(`/seller/products/${id}/option-groups`, { method: 'POST', body: JSON.stringify(body) }),
  addOptionValue: (id: number, groupId: number, body: { value: string; position: number }) => fetchApi(`/seller/products/${id}/option-groups/${groupId}/values`, { method: 'POST', body: JSON.stringify(body) }),
  saveAttribute: (id: number, definitionId: number, body: AttributeInput) => fetchApi(`/seller/products/${id}/attributes/${definitionId}`, { method: 'PUT', body: JSON.stringify(body) }),
  createProduct: (body: Record<string, unknown>) => fetchApi<Product>('/seller/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: number, body: Record<string, unknown>) => fetchApi<Product>(`/seller/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  addImage: (id: number, body: FormData) => fetchApi<Product>(`/seller/products/${id}/images`, { method: 'POST', body }),
  addVariant: (id: number, body: Record<string, unknown>) => fetchApi<Product>(`/seller/products/${id}/variants`, { method: 'POST', body: JSON.stringify(body) }),
  shipping: (id: number, body: Record<string, unknown>) => fetchApi<Product>(`/seller/products/${id}/shipping-profile`, { method: 'PATCH', body: JSON.stringify(body) }),
  submitProduct: (id: number) => fetchApi<Product>(`/seller/products/${id}/submit`, { method: 'POST' }),
  visibility: (id: number, version: number, sellerStatus: 'ACTIVE' | 'HIDDEN') => fetchApi<Product>(`/seller/products/${id}/visibility`, { method: 'PATCH', body: JSON.stringify({ version, sellerStatus }) }),

  adminStores: () => fetchApi<Store[]>('/admin/stores'),
  reviewStore: (id: number, status: StoreStatus, reason: string) => fetchApi<Store>(`/admin/stores/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }),
  reviewQueue: () => fetchApi<Page<Product>>('/admin/products/review-queue?limit=50'),
  reviewProduct: (id: number) => fetchApi<Product>(`/admin/products/${id}`),
  moderateProduct: (id: number, action: 'approve' | 'reject' | 'freeze', version: number, reason?: string) => fetchApi<Product>(`/admin/products/${id}/${action}`, { method: 'POST', body: JSON.stringify(reason === undefined ? { version } : { version, reason }) }),
};
