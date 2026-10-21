import { describe, expect, it } from 'vitest';
import { previewChanges, previewFieldErrors, previewReason } from './attributePreviewValidation';

describe('Local-only attribute validation per merged #65', () => {
  it.each([10, 500])('accepts %i Unicode code points including astral characters', (length) => {
    expect(previewReason(`  ${'😀'.repeat(length)}  `, true)).toEqual({ normalized: '😀'.repeat(length), count: length, error: '' });
  });
  it.each([1, 9, 501])('rejects %i code points without truncation', (length) => {
    const result = previewReason('😀'.repeat(length), true);
    expect(result.error).not.toBe(''); expect(result.count).toBe(length);
    expect(result.normalized).toBe('😀'.repeat(length));
  });
  it('uses NFC before counting and permits newline/tab', () => {
    const raw = 'a\u0301'.repeat(10);
    expect(previewReason(raw, true)).toEqual({ normalized: 'á'.repeat(10), count: 10, error: '' });
    expect(previewReason('Lý do\nđổi\tcấu hình', true).error).toBe('');
  });
  it.each(['\u0000', '\u000b', '\u000d', '\u001f', '\u007f', '\u0085', '\u009f'])('rejects control code %j even if trim would hide it', (control) => {
    expect(previewReason(`${control}Lý do kiểm thử hợp lệ`, true).error).toContain('điều khiển');
  });
  it('distinguishes optional blank reason from mandatory policy reason', () => {
    expect(previewReason('  \n\t', false).error).toBe('');
    expect(previewReason('  \n\t', true).error).not.toBe('');
    expect(previewReason('Ngắn', false).error).not.toBe('');
  });
  it.each(['-1', '1.5', '1e2', '2147483648', '', 'Infinity'])('rejects invalid order %s', (order) => {
    expect(previewFieldErrors('Tên hợp lệ', 'ten-hop-le', order).order).not.toBe('');
  });
  it('accepts bounds and keeps accents in names', () => {
    expect(Object.values(previewFieldErrors(' Kết nối ', 'ket-noi', '2147483647')).every((value) => value === '')).toBe(true);
    expect(previewChanges({ Tên: 'Màu' }, { Tên: 'Mau' })).toHaveLength(1);
    expect(previewChanges({ Tên: 'Màu' }, { Tên: 'Màu' })).toEqual([]);
  });
});
