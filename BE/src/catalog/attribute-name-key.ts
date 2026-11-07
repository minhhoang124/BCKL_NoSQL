/** Contract #65: an advisory/application key, never a substitute for DB UNIQUE. */
export function normalizedAttributeNameKey(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('vi-VN');
}
