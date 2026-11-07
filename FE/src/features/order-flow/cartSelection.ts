// URL carries identity only. Quantity/price/address always come from Backend.
export function parseCartSelection(search: string): { ids: number[]; error: string } {
  const values = new URLSearchParams(search).getAll('variantId');
  if (values.length > 50 || values.some(value => !/^[1-9]\d*$/.test(value) || Number(value) > 2147483647)) {
    return { ids: [], error: 'Danh sách món từ giỏ không hợp lệ (tối đa 50 mã Variant nguyên dương). Quay lại giỏ để chọn lại.' };
  }
  const ids = values.map(Number);
  if (new Set(ids).size !== ids.length) return { ids: [], error: 'Danh sách món từ giỏ có mã trùng. Quay lại giỏ để chọn lại.' };
  return { ids, error: '' };
}

export function checkoutSelectionUrl(ids: number[]): string {
  if (!ids.length) throw new Error('Cần chọn ít nhất một món trước khi sang Checkout.');
  const params = new URLSearchParams(ids.map(id => ['variantId', String(id)]));
  const selection = parseCartSelection(params.toString());
  if (selection.error) throw new Error(selection.error);
  return `/checkout?${params}`;
}
