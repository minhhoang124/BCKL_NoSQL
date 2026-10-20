import { ApiError, AuthSessionChangedError, fetchApi, getAuthSessionVersion } from '../../services/apiClient';
import type { ApiRequestOptions } from '../../services/apiClient';

export type AccountRole = 'USER' | 'SELLER' | 'ADMIN';
export type StoreStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'CLOSED';
export interface AdminAccount {
  id: number; email: string; fullName: string | null; role: AccountRole; isActive: boolean;
  createdAt: string; updatedAt: string; store: { id: number; name: string; status: StoreStatus } | null;
}
export interface AccountQuery { limit?: number; afterId?: number; q?: string; role?: AccountRole; isActive?: boolean }
export interface AccountPage { items: AdminAccount[]; nextCursor: number | null }
export interface AccountReadApi { list(query?: AccountQuery, signal?: AbortSignal): Promise<AccountPage> }
export type AccountRequester = (path: string, options: ApiRequestOptions) => Promise<unknown>;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, fields: string) => Object.keys(value).sort().join(',') === fields.split(',').sort().join(',');
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
export function normalizeAccountSearch(value: string): string {
  if (typeof value !== 'string') throw new ApiError('Từ khóa không hợp lệ.', 400);
  const normalized = value.normalize('NFC').trim();
  if ([...normalized].length > 120 || [...normalized].some(char => {
    const code = char.codePointAt(0)!; return code < 32 || (code >= 127 && code <= 159);
  })) throw new ApiError('Từ khóa tối đa 120 ký tự Unicode, không có ký tự điều khiển.', 400);
  return normalized;
}
function queryString(query: AccountQuery) {
  if (Object.keys(query).some(key => !['limit', 'afterId', 'q', 'role', 'isActive'].includes(key)) ||
    !integer(query.limit ?? 50) || (query.limit ?? 50) > 100 ||
    (query.afterId !== undefined && !integer(query.afterId)) ||
    (query.role !== undefined && !['USER', 'SELLER', 'ADMIN'].includes(query.role)) ||
    (query.isActive !== undefined && typeof query.isActive !== 'boolean')) throw new ApiError('Bộ lọc tài khoản không hợp lệ.', 400);
  const params = new URLSearchParams({ limit: String(query.limit ?? 50) });
  if (query.afterId !== undefined) params.set('afterId', String(query.afterId));
  if (query.role !== undefined) params.set('role', query.role);
  if (query.isActive !== undefined) params.set('isActive', String(query.isActive));
  if (query.q !== undefined) { const q = normalizeAccountSearch(query.q); if (q) params.set('q', q); }
  return `?${params}`;
}
function invalid(): never { throw new ApiError('Dữ liệu Accounts không đúng cấu trúc; chưa thể hiển thị.', 502); }
function readAccount(value: unknown): AdminAccount {
  if (!object(value) || !exact(value, 'id,email,fullName,role,isActive,createdAt,updatedAt,store') ||
    !integer(value.id) || !text(value.email) || !(value.fullName === null || typeof value.fullName === 'string') ||
    !['USER', 'SELLER', 'ADMIN'].includes(value.role as string) || typeof value.isActive !== 'boolean' || !date(value.createdAt) || !date(value.updatedAt)) invalid();
  const store = value.store;
  if (store !== null && (!object(store) || !exact(store, 'id,name,status') || !integer(store.id) || !text(store.name) ||
    !['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'CLOSED'].includes(store.status as string))) invalid();
  // Return the explicit projection, never extra fields attached by an injected transport.
  return { id: value.id, email: value.email, fullName: value.fullName as string | null, role: value.role as AccountRole,
    isActive: value.isActive, createdAt: value.createdAt as string, updatedAt: value.updatedAt as string,
    store: store === null ? null : { id: (store as Record<string, unknown>).id as number, name: (store as Record<string, unknown>).name as string, status: (store as Record<string, unknown>).status as StoreStatus } };
}
export function createAccountReadApi(request: AccountRequester = fetchApi): AccountReadApi {
  return { async list(query = {}, signal) {
    const path = '/admin/accounts' + queryString(query);
    const version = getAuthSessionVersion();
    const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
    combined.throwIfAborted();
    try {
      const response = await request(path, { method: 'GET', cache: 'no-store', retryOnUnauthorized: false, signal: combined });
      combined.throwIfAborted();
      if (version !== getAuthSessionVersion()) throw new AuthSessionChangedError();
      if (!object(response) || !exact(response, 'items,nextCursor') || !Array.isArray(response.items) ||
        response.items.length > (query.limit ?? 50) || (response.nextCursor !== null && !integer(response.nextCursor))) invalid();
      const items = response.items.map(readAccount);
      let previous = query.afterId ?? 0;
      for (const row of items) {
        if (row.id <= previous || (query.role !== undefined && row.role !== query.role) ||
          (query.isActive !== undefined && row.isActive !== query.isActive)) invalid();
        previous = row.id;
      }
      if (response.nextCursor !== null && (items.length !== (query.limit ?? 50) || response.nextCursor !== previous)) invalid();
      return { items, nextCursor: response.nextCursor as number | null };
    } catch (error) {
      if (version !== getAuthSessionVersion()) throw new AuthSessionChangedError();
      throw error;
    }
  } };
}
