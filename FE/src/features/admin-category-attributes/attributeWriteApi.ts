import { ApiError, AuthSessionChangedError, fetchApi, getAuthSessionVersion, refreshSession } from '../../services/apiClient';
import type { ApiRequestOptions } from '../../services/apiClient';
import type { AttributeDefinition, AttributeOption } from './attributeReadApi';

export type DefinitionInput = {
  name: string; slug: string; dataType: AttributeDefinition['dataType'];
  isRequired: boolean; isFilterable: boolean; allowsCustom: boolean;
  sortOrder: number; isActive: boolean;
};
export type OptionInput = { value: string; slug: string; sortOrder: number; isActive: boolean };
export type PolicyConfirmation = { confirmPolicyChange?: true; reason?: string };
export type AttributeWriteResult = {
  definition: AttributeDefinition;
  option: AttributeOption | null;
  searchReconciliation: { jobId: string; status: 'PENDING' } | null;
};
export interface AttributeWriteApi {
  createDefinition(categoryId: number, input: DefinitionInput & PolicyConfirmation): Promise<AttributeWriteResult>;
  patchDefinition(categoryId: number, id: number, input: Partial<DefinitionInput> & { expectedRevision: number } & PolicyConfirmation): Promise<AttributeWriteResult>;
  createOption(categoryId: number, id: number, input: OptionInput & { expectedRevision: number }): Promise<AttributeWriteResult>;
  patchOption(categoryId: number, id: number, optionId: number, input: Partial<OptionInput> & { expectedRevision: number } & PolicyConfirmation): Promise<AttributeWriteResult>;
}
export type WriteRequester = (path: string, options: ApiRequestOptions) => Promise<unknown>;

const MAX = 2147483647;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const int = (value: unknown, min = 1): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= MAX;
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const exact = (value: Record<string, unknown>, fields: string[]) => Object.keys(value).sort().join(',') === [...fields].sort().join(',');
function invalid(): never { throw new ApiError('Phản hồi ghi Attributes không đúng cấu trúc; kết quả chưa rõ.', 502, 'INVALID_ATTRIBUTE_WRITE_RESPONSE'); }
function parseDefinition(value: unknown, categoryId: number): AttributeDefinition {
  if (!record(value) || !exact(value, ['id','categoryId','name','slug','dataType','isRequired','isFilterable','allowsCustom','sortOrder','isActive','revision','createdAt','updatedAt','usage']) ||
    !int(value.id) || value.categoryId !== categoryId || typeof value.name !== 'string' || typeof value.slug !== 'string' ||
    !['TEXT','NUMBER','BOOLEAN','SINGLE_SELECT'].includes(String(value.dataType)) || !['isRequired','isFilterable','allowsCustom','isActive'].every(key => typeof value[key] === 'boolean') ||
    !int(value.sortOrder, 0) || !int(value.revision) || !date(value.createdAt) || !date(value.updatedAt) || !record(value.usage) ||
    !exact(value.usage, ['referencedProductCount']) || !count(value.usage.referencedProductCount)) invalid();
  return value as unknown as AttributeDefinition;
}
function parseOption(value: unknown, definitionId: number): AttributeOption | null {
  if (value === null) return null;
  if (!record(value) || !exact(value, ['id','attributeDefinitionId','value','slug','sortOrder','isActive','referencedProductCount']) ||
    !int(value.id) || value.attributeDefinitionId !== definitionId || typeof value.value !== 'string' || typeof value.slug !== 'string' ||
    !int(value.sortOrder, 0) || typeof value.isActive !== 'boolean' || !count(value.referencedProductCount)) invalid();
  return value as unknown as AttributeOption;
}
type ExpectedWrite = { kind: 'definition' | 'option'; definitionId?: number; optionId?: number };
function parseResult(value: unknown, categoryId: number, expected: ExpectedWrite): AttributeWriteResult {
  if (!record(value) || !exact(value, ['definition','option','searchReconciliation'])) invalid();
  const definition = parseDefinition(value.definition, categoryId);
  const option = parseOption(value.option, definition.id);
  if (expected.definitionId !== undefined && definition.id !== expected.definitionId) invalid();
  if (expected.kind === 'definition') {
    if (option !== null) invalid();
  } else {
    if (definition.dataType !== 'SINGLE_SELECT' || option === null ||
      (expected.optionId !== undefined && option.id !== expected.optionId)) invalid();
  }
  const job = value.searchReconciliation;
  if (job !== null && (!record(job) || !exact(job, ['jobId','status']) || typeof job.jobId !== 'string' || !/^\d+$/.test(job.jobId) || job.status !== 'PENDING')) invalid();
  return { definition, option, searchReconciliation: job as AttributeWriteResult['searchReconciliation'] };
}
function id(value: number) { if (!int(value)) throw new ApiError('ID Attributes không hợp lệ.', 400); return value; }

export function isUnknownWriteOutcome(error: unknown) {
  return !(error instanceof AuthSessionChangedError) && (!(error instanceof ApiError) || error.status === undefined || error.status >= 500);
}

export function createAttributeWriteApi(request: WriteRequester = fetchApi, refresh: (version: number) => Promise<unknown> = refreshSession): AttributeWriteApi {
  async function write(path: string, categoryId: number, method: 'POST' | 'PATCH', body: object, expected: ExpectedWrite) {
    id(categoryId);
    const session = getAuthSessionVersion();
    const signal = AbortSignal.timeout(15000);
    try {
      const value = await request(path, { method, body: JSON.stringify(body), cache: 'no-store', retryOnUnauthorized: false, signal });
      if (getAuthSessionVersion() !== session) throw new AuthSessionChangedError();
      return parseResult(value, categoryId, expected);
    } catch (error) {
      if (getAuthSessionVersion() !== session) throw new AuthSessionChangedError();
      if (error instanceof ApiError && error.status === 401) {
        // Restore authentication only. Never replay a business write automatically.
        await refresh(session);
        if (getAuthSessionVersion() !== session) throw new AuthSessionChangedError();
        throw new ApiError('Đã khôi phục phiên đăng nhập. Nội dung chưa được gửi lại; kiểm tra và bấm Lưu khi sẵn sàng.', 401, 'ATTRIBUTE_SESSION_REFRESHED');
      }
      throw error;
    }
  }
  const base = (categoryId: number, definitionId?: number) => `/admin/categories/${id(categoryId)}/attributes${definitionId === undefined ? '' : `/${id(definitionId)}`}`;
  return {
    createDefinition: (categoryId, input) => write(base(categoryId), categoryId, 'POST', input, { kind: 'definition' }),
    patchDefinition: (categoryId, definitionId, input) => write(base(categoryId, definitionId), categoryId, 'PATCH', input, { kind: 'definition', definitionId }),
    createOption: (categoryId, definitionId, input) => write(`${base(categoryId, definitionId)}/options`, categoryId, 'POST', input, { kind: 'option', definitionId }),
    patchOption: (categoryId, definitionId, optionId, input) => write(`${base(categoryId, definitionId)}/options/${id(optionId)}`, categoryId, 'PATCH', input, { kind: 'option', definitionId, optionId }),
  };
}
