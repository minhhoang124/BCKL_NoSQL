import { ApiError, fetchApi } from '../../services/apiClient';

export interface AdminBrand { id: number; name: string; slug: string; isActive: boolean }
export interface BrandPatch { name?: string; slug?: string }
export interface BrandWrite extends AdminBrand { searchReconciliation: { jobId: string; status: string } | null }
export interface BrandApi {
  list(signal: AbortSignal): Promise<AdminBrand[]>;
  update(id: number, patch: BrandPatch, signal: AbortSignal): Promise<BrandWrite>;
}

export function validateBrandDraft(name: string, slug: string): string | null {
  if (name.trim().length < 2 || name.trim().length > 120) return 'Tên thương hiệu cần từ 2 đến 120 ký tự.';
  if (slug.length < 2 || slug.length > 140 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    return 'Slug cần 2–140 ký tự: chữ thường, số và dấu gạch nối giữa các phần.';
  return null;
}

function readBrand(value: unknown): AdminBrand {
  if (!value || typeof value !== 'object') throw new ApiError('Phản hồi thương hiệu không hợp lệ.');
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.id) || (row.id as number) <= 0 || typeof row.name !== 'string' || typeof row.slug !== 'string' || typeof row.isActive !== 'boolean')
    throw new ApiError('Phản hồi thương hiệu không hợp lệ.');
  return { id: row.id as number, name: row.name, slug: row.slug, isActive: row.isActive };
}

export const brandApi: BrandApi = {
  async list(signal) {
    const data: unknown = await fetchApi('/admin/brands', { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    if (!Array.isArray(data)) throw new ApiError('Danh sách thương hiệu không hợp lệ.');
    const rows = data.map(readBrand);
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new ApiError('Danh sách có ID trùng.');
    return rows;
  },
  async update(id, patch, signal) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError('ID thương hiệu không hợp lệ.');
    if (Object.keys(patch).some(key => key !== 'name' && key !== 'slug') || (patch.name === undefined && patch.slug === undefined))
      throw new ApiError('Chỉ cập nhật tên hoặc slug thương hiệu.');
    if (patch.name !== undefined && (typeof patch.name !== 'string' || patch.name.trim().length < 2 || patch.name.trim().length > 120))
      throw new ApiError('Tên thương hiệu không hợp lệ.');
    if (patch.slug !== undefined && (typeof patch.slug !== 'string' || patch.slug.length < 2 || patch.slug.length > 140 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(patch.slug)))
      throw new ApiError('Slug không hợp lệ.');
    const body = { ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.slug !== undefined ? { slug: patch.slug } : {}) };
    const raw: unknown = await fetchApi(`/admin/brands/${id}`, {
      method: 'PATCH', body: JSON.stringify(body), retryOnUnauthorized: false,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    const row = readBrand(raw);
    if (row.id !== id) throw new ApiError('Phản hồi không khớp thương hiệu đang sửa.');
    if ((body.name !== undefined && row.name !== body.name) || (body.slug !== undefined && row.slug !== body.slug))
      throw new ApiError('Phản hồi chưa xác nhận đúng nội dung đã gửi.');
    const job = (raw as Record<string, unknown>).searchReconciliation;
    if (job !== null && (!job || typeof job !== 'object' || typeof (job as Record<string, unknown>).jobId !== 'string' || typeof (job as Record<string, unknown>).status !== 'string'))
      throw new ApiError('Thiếu hoặc sai trạng thái công việc đồng bộ.');
    return { ...row, searchReconciliation: job as BrandWrite['searchReconciliation'] };
  },
};
