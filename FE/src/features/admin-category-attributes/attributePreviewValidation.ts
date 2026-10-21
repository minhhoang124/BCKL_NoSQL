// Local presentation checks only, not an HTTP DTO, authorization or DB constraint.
export function previewFieldErrors(name: string, slug: string, order: string) {
  return {
    name: name.trim().length < 2 || name.trim().length > 120 ? 'Tên/giá trị cần 2–120 ký tự sau khi bỏ khoảng trắng hai đầu.' : '',
    slug: slug.length < 2 || slug.length > 140 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
      ? 'Slug cần 2–140 ký tự: chữ thường, số và gạch nối; không có khoảng trắng.' : '',
    order: !/^\d+$/.test(order) || Number(order) > 2147483647 ? 'Thứ tự cần là số nguyên từ 0 đến 2147483647.' : '',
  };
}

export function previewReason(raw: string, required: boolean) {
  const normalized = raw.normalize('NFC').trim();
  const count = [...normalized].length;
  // Validate controls in the original text too: trim must not hide forbidden input.
  const hasControl = [...raw].some((char) => {
    const code = char.codePointAt(0)!;
    return (code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159);
  });
  const error = hasControl ? 'Không dùng ký tự điều khiển ngoài xuống dòng và tab.'
    : !normalized && required ? 'Thay đổi chính sách này cần lý do.'
    : normalized && (count < 10 || count > 500) ? 'Lý do cần 10–500 ký tự Unicode sau NFC và bỏ khoảng trắng hai đầu.' : '';
  return { normalized, count, error };
}

export interface PreviewChange { field: string; before: string; after: string }
export interface AttributeConfirmation {
  label: string;
  revision?: number;
  policy: boolean;
  changes: PreviewChange[];
}

export function previewChanges(before: Record<string, string>, after: Record<string, string>): PreviewChange[] {
  return Object.keys(after).filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field] ?? 'Chưa tạo', after: after[field] }));
}
