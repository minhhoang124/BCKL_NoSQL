import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

const unsafeCharacters = /[\u0000-\u0020\u007f\\]/;
const controlOrBackslash = /[\u0000-\u001f\u007f\\]/;
const invalidEscape = /%(?![0-9a-f]{2})/i;
const encodedPathSyntax = /%(?:2e|2f|5c)/i;
const encodedByte = /%[0-9a-f]{2}/i;

function invalidImage(): never {
  // Never echo catalog URLs, signed queries or credentials in an API/log error.
  throw new BadRequestException({
    code: 'SEARCH_IMAGE_URL_INVALID',
    message: 'Đường dẫn ảnh tìm kiếm không hợp lệ.',
  });
}

function invalidOrigin(): never {
  throw new InternalServerErrorException({
    code: 'SEARCH_MEDIA_ORIGIN_INVALID',
    message: 'Cấu hình địa chỉ ảnh tìm kiếm không hợp lệ.',
  });
}

function httpUrl(raw: string, reject: () => never = invalidImage): URL {
  if (
    typeof raw !== 'string' ||
    unsafeCharacters.test(raw) ||
    !/^https?:\/\//i.test(raw)
  ) reject();
  const authority = raw.match(/^https?:\/\/([^/?#]*)/i)?.[1];
  if (!authority || authority.includes('@')) reject();
  let parsed: URL;
  try { parsed = new URL(raw); } catch { reject(); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) reject();
  return parsed;
}

function mediaBase(raw: string): URL {
  // Validate the raw syntax too: URL() normalizes /./ and empty ?/# away.
  if (typeof raw !== 'string' || !/^https?:\/\/[^/?#]+\/?$/i.test(raw)) invalidOrigin();
  const parsed = httpUrl(raw, invalidOrigin);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) invalidOrigin();
  return parsed;
}

/** Server configuration only; an explicitly empty value fails closed. */
export function defaultSearchMediaOrigin(): string {
  if (process.env.BACKEND_PUBLIC_URL === undefined && process.env.NODE_ENV === 'production') invalidOrigin();
  const configured = process.env.BACKEND_PUBLIC_URL ??
    `http://localhost:${process.env.BACKEND_PORT ?? 3001}`;
  mediaBase(configured);
  return configured;
}

function assertManagedPath(value: string): void {
  if (
    !value.startsWith('/uploads/') ||
    value.length === '/uploads/'.length ||
    controlOrBackslash.test(value) ||
    value.includes('?') || value.includes('#') ||
    value.split('/').some(segment => segment === '.' || segment === '..')
  ) invalidImage();
}

/**
 * Normalize only managed root-relative media paths when creating NEW events.
 * Absolute URLs remain byte-for-byte unchanged; AI still enforces its host
 * allowlist and download limits. Never use this to rewrite an existing event.
 * Raw ASCII whitespace/control/backslashes are deliberately rejected. Encoded
 * spaces in managed filenames are supported. Absolute query bytes, including
 * literal percent signs accepted by URL(), are never decoded or rewritten.
 */
export function normalizeSearchImageUrl(raw: string, mediaOrigin: string): string {
  const base = mediaBase(mediaOrigin);
  if (typeof raw !== 'string' || unsafeCharacters.test(raw)) invalidImage();
  if (/^https?:\/\//i.test(raw)) {
    httpUrl(raw);
    return raw;
  }
  if (invalidEscape.test(raw)) invalidImage();
  let decoded = raw;
  let complete = false;
  // Nested escaping shrinks at every pass. Bound the work and reject deeper
  // nesting rather than allowing a later decoder to reveal path syntax.
  for (let pass = 0; pass < 8; pass += 1) {
    assertManagedPath(decoded);
    if (encodedPathSyntax.test(decoded)) invalidImage();
    if (!encodedByte.test(decoded)) { complete = true; break; }
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { invalidImage(); }
    if (next === decoded) { complete = true; break; }
    decoded = next;
  }
  if (!complete) invalidImage();
  let resolved: URL;
  try { resolved = new URL(raw, base.origin); } catch { invalidImage(); }
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith('/uploads/') || resolved.search || resolved.hash) invalidImage();
  return resolved.href;
}
