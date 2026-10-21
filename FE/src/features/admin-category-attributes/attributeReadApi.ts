import { ApiError, AuthSessionChangedError, fetchApi, getAuthSessionVersion } from '../../services/apiClient';
import type { ApiRequestOptions } from '../../services/apiClient';

// Backend DTOs, deliberately separate from sampleKey-based editor examples.
export interface AttributeDefinition {
  id: number; categoryId: number; name: string; slug: string;
  dataType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT';
  isRequired: boolean; isFilterable: boolean; allowsCustom: boolean;
  sortOrder: number; isActive: boolean; revision: number;
  createdAt: string; updatedAt: string; usage: { referencedProductCount: number };
}
export interface AttributeOption {
  id: number; attributeDefinitionId: number; value: string; slug: string;
  sortOrder: number; isActive: boolean; referencedProductCount: number;
}
export interface ReadPage<T> { items: T[]; nextCursor: number | null }
export interface OptionPage extends ReadPage<AttributeOption> { definitionRevision: number }
export interface ReadQuery { limit?: number; afterId?: number; isActive?: boolean }
export interface AttributeReadApi {
  list(categoryId: number, query?: ReadQuery, signal?: AbortSignal): Promise<ReadPage<AttributeDefinition>>;
  detail(categoryId: number, id: number, signal?: AbortSignal): Promise<AttributeDefinition>;
  options(categoryId: number, id: number, query?: ReadQuery, signal?: AbortSignal): Promise<OptionPage>;
}
export type ReadRequester = (path: string, options: ApiRequestOptions) => Promise<unknown>;
const MAX = 2147483647;
const int = (v: unknown, min = 1): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= MAX;
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string) => Object.keys(v).sort().join(',') === expected.split(',').sort().join(',');
const string = (v: unknown) => typeof v === 'string' && v.length > 0;
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
function invalid(): never { throw new ApiError('Dữ liệu thuộc tính không đúng cấu trúc; chưa thể hiển thị.', 502); }
function definition(v: unknown, categoryId: number): AttributeDefinition {
  if (!record(v) || !keys(v, 'id,categoryId,name,slug,dataType,isRequired,isFilterable,allowsCustom,sortOrder,isActive,revision,createdAt,updatedAt,usage') ||
    !int(v.id) || v.categoryId !== categoryId || !string(v.name) || !string(v.slug) ||
    !['TEXT', 'NUMBER', 'BOOLEAN', 'SINGLE_SELECT'].includes(v.dataType as string) ||
    !['isRequired', 'isFilterable', 'allowsCustom', 'isActive'].every(k => typeof v[k] === 'boolean') ||
    !int(v.sortOrder, 0) || !int(v.revision) || !date(v.createdAt) || !date(v.updatedAt) ||
    !record(v.usage) || !keys(v.usage, 'referencedProductCount') || !count(v.usage.referencedProductCount)) invalid();
  return v as unknown as AttributeDefinition;
}
function option(v: unknown, id: number): AttributeOption {
  if (!record(v) || !keys(v, 'id,attributeDefinitionId,value,slug,sortOrder,isActive,referencedProductCount') ||
    !int(v.id) || v.attributeDefinitionId !== id || !string(v.value) || !string(v.slug) ||
    !int(v.sortOrder, 0) || typeof v.isActive !== 'boolean' || !count(v.referencedProductCount)) invalid();
  return v as unknown as AttributeOption;
}
function queryString(query: ReadQuery) {
  if (Object.keys(query).some(k => !['limit', 'afterId', 'isActive'].includes(k)) ||
    !int(query.limit ?? 50) || (query.limit ?? 50) > 100 ||
    (query.afterId !== undefined && !int(query.afterId)) ||
    (query.isActive !== undefined && typeof query.isActive !== 'boolean')) throw new ApiError('Tham số tải thuộc tính không hợp lệ.', 400);
  const search = new URLSearchParams({ limit: String(query.limit ?? 50) });
  if (query.afterId !== undefined) search.set('afterId', String(query.afterId));
  if (query.isActive !== undefined) search.set('isActive', String(query.isActive));
  return `?${search}`;
}
function page<T extends { id: number; isActive: boolean }>(v: unknown, query: ReadQuery, parse: (row: unknown) => T, options = false): ReadPage<T> {
  if (!record(v) || !keys(v, options ? 'items,nextCursor,definitionRevision' : 'items,nextCursor') || !Array.isArray(v.items) ||
    v.items.length > (query.limit ?? 50) || (v.nextCursor !== null && !int(v.nextCursor))) invalid();
  const items = v.items.map(parse);
  let previous = query.afterId ?? 0;
  for (const row of items) {
    if (row.id <= previous || (query.isActive !== undefined && row.isActive !== query.isActive)) invalid();
    previous = row.id;
  }
  if (v.nextCursor !== null && (items.length !== (query.limit ?? 50) || v.nextCursor !== previous)) invalid();
  return { items, nextCursor: v.nextCursor as number | null };
}
export function createAttributeReadApi(request: ReadRequester = fetchApi): AttributeReadApi {
  async function get(path: string, signal?: AbortSignal) {
    const session = getAuthSessionVersion();
    const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
    combined.throwIfAborted();
    try {
      const value = await request(path, { method: 'GET', cache: 'no-store', retryOnUnauthorized: false, signal: combined });
      combined.throwIfAborted();
      if (getAuthSessionVersion() !== session) throw new AuthSessionChangedError();
      return value;
    } catch (error) {
      if (getAuthSessionVersion() !== session) throw new AuthSessionChangedError();
      throw error;
    }
  }
  function base(categoryId: number, id?: number) {
    if (!int(categoryId) || (id !== undefined && !int(id))) throw new ApiError('ID thuộc tính hoặc ngành hàng không hợp lệ.', 400);
    return `/admin/categories/${categoryId}/attributes${id === undefined ? '' : `/${id}`}`;
  }
  return {
    async list(categoryId, query = {}, signal) {
      const value = await get(base(categoryId) + queryString(query), signal);
      return page(value, query, row => definition(row, categoryId));
    },
    async detail(categoryId, id, signal) {
      const value = definition(await get(base(categoryId, id), signal), categoryId);
      if (value.id !== id) invalid();
      return value;
    },
    async options(categoryId, id, query = {}, signal) {
      const value = await get(base(categoryId, id) + '/options' + queryString(query), signal);
      const result = page(value, query, row => option(row, id), true);
      if (!record(value) || !int(value.definitionRevision)) invalid();
      return { ...result, definitionRevision: value.definitionRevision };
    },
  };
}
