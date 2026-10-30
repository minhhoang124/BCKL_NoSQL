import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSearchMediaOrigin, normalizeSearchImageUrl } from './search-image-url-policy.js';

afterEach(() => vi.unstubAllEnvs());

describe('Search producer image URL policy', () => {
  it.each(['http://localhost:3001', 'http://127.0.0.1:3001/', 'http://[::1]:3001', 'https://media.example.test'])('resolves only managed relative uploads against configured origin %s', base => {
    const normalized = normalizeSearchImageUrl('/uploads/products/7/image.jpg', base);
    expect(normalized).toBe(new URL('/uploads/products/7/image.jpg', base).href);
    expect(new URL(normalized).origin).toBe(new URL(base).origin);
  });
  it('preserves valid UTF-8 encoded filenames without double encoding', () => {
    expect(normalizeSearchImageUrl('/uploads/abo/%E1%BA%A3nh%20s%E1%BA%A3n%20ph%E1%BA%A9m.png', 'https://media.example.test/'))
      .toBe('https://media.example.test/uploads/abo/%E1%BA%A3nh%20s%E1%BA%A3n%20ph%E1%BA%A9m.png');
  });
  it('allows a correctly escaped literal percent in a managed filename', () => {
    expect(normalizeSearchImageUrl('/uploads/100%25.png', 'http://localhost:3001')).toBe('http://localhost:3001/uploads/100%25.png');
  });
  it('supports raw UTF-8 filenames with encoded spaces without rejecting the decoded space', () => {
    expect(normalizeSearchImageUrl('/uploads/điện%20thoại.jpg', 'http://localhost:3001'))
      .toBe(new URL('/uploads/điện%20thoại.jpg', 'http://localhost:3001').href);
  });
  it.each([
    'https://cdn.example.test/a.jpg?X-Signature=AbC%2FDEF%3D&Expires=123',
    'HTTP://LOCALHOST:3001/uploads/a.jpg',
    'https://cdn.example.test/a.jpg?token=a%252Fb#fragment',
    'https://cdn.example.test/a/../b.jpg',
    'https://cdn.example.test/a.jpg?q=50%',
    'https://cdn.example.test/a.jpg?signature=%not-hex&raw=100%',
    'https://cdn.example.test/a%GG.jpg',
  ])('preserves valid absolute URLs byte-for-byte rather than rebasing or rewriting signatures', raw => {
    expect(normalizeSearchImageUrl(raw, 'https://media.example.test')).toBe(raw);
  });
  it.each([
    '', ' ', 'localhost:3001', 'ftp://backend', 'https://user:password@backend',
    'https://@backend', 'https://backend/path', 'https://backend/.',
    'https://backend//', 'https://backend?', 'https://backend#',
    'https://backend?x=1', 'https://backend/#token', 'https://backend\\evil',
    'https://backend\n',
  ])('rejects unsafe/non-origin media base %s', base => {
    expect(() => normalizeSearchImageUrl('/uploads/a.png', base)).toThrow(InternalServerErrorException);
  });
  it.each([
    '//evil.example.test/uploads/a.png', '/other/a.png', '/uploads/',
    'uploads/a.png', 'abo/images/a.jpg', 'C:\\images\\a.jpg', 'file:///a.jpg',
    '/uploads/../admin', '/uploads/./a.png', '/uploads/a/..',
    '/uploads/%2e%2e/admin', '/uploads/%2E/a.png', '/uploads/a%2fb.png',
    '/uploads/a%5Cb.png', '/uploads/..%252fadmin', '/uploads/%252e%252e/admin',
    '/uploads/%25252e%25252e/admin', '/uploads/a%255cb.png',
    '/uploads/a.png?secret=1', '/uploads/a.png#token',
    '/uploads/a%253fquery.png', '/uploads/a%2523fragment.png',
    '/uploads/a\\b.png', '/uploads/a\u0000.png', '/uploads/a%00.png',
    '/uploads/a%250a.png', '/uploads/a\n.png', '/uploads/a%.png',
    '/uploads/a%2.png', '/uploads/a%GG.png', '/uploads/a%FF.png',
  ])('rejects untrusted or ambiguous relative input %s', raw => {
    expect(() => normalizeSearchImageUrl(raw, 'http://localhost:3001')).toThrow(BadRequestException);
  });
  it('rejects deeply nested encodings instead of leaving traversal for another decoder', () => {
    let escaped = '%2e';
    for (let count = 0; count < 12; count += 1) escaped = escaped.replaceAll('%', '%25');
    expect(() => normalizeSearchImageUrl(`/uploads/${escaped}${escaped}/admin`, 'http://localhost:3001')).toThrow(BadRequestException);
  });
  it.each([
    'https://user:password@cdn.example.test/a.jpg', 'https://@cdn.example.test/a.jpg',
    'https://cdn.example.test/a\n.jpg', 'https://cdn.example.test\\@evil.test/a.jpg',
    'https://cdn.example.test/raw space.jpg', 'data:image/png;base64,AAA',
  ])('rejects unsafe absolute URLs without echoing credentials/URL values', raw => {
    try {
      normalizeSearchImageUrl(raw, 'http://localhost:3001');
      expect.unreachable('expected URL policy rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe('Đường dẫn ảnh tìm kiếm không hợp lệ.');
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'SEARCH_IMAGE_URL_INVALID' });
      expect((error as Error).message).not.toContain(raw);
    }
  });
  it('also validates configured base when the image is already absolute', () => {
    expect(() => normalizeSearchImageUrl('https://cdn.example.test/a.jpg', '')).toThrow(InternalServerErrorException);
  });
  it('reports invalid catalog paths as safe 400 errors, without the input', () => {
    const input = '/uploads/../private?token=PRIVATE-FIXTURE';
    try { normalizeSearchImageUrl(input, 'https://media.example.test');expect.unreachable(); }
    catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'SEARCH_IMAGE_URL_INVALID' });
      expect(JSON.stringify((error as BadRequestException).getResponse())).not.toContain('PRIVATE-FIXTURE');
    }
  });
  it('classifies invalid server media configuration as safe 500 rather than catalog 400', () => {
    const base = 'https://user:PRIVATE-FIXTURE@media.example.test';
    try { normalizeSearchImageUrl('/uploads/a.png', base);expect.unreachable(); }
    catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getStatus()).toBe(500);
      expect((error as InternalServerErrorException).getResponse()).toMatchObject({ code: 'SEARCH_MEDIA_ORIGIN_INVALID' });
      expect(JSON.stringify((error as InternalServerErrorException).getResponse())).not.toContain('PRIVATE-FIXTURE');
    }
  });
  it('rejects raw spaces while preserving encoded spaces in managed filenames', () => {
    expect(() => normalizeSearchImageUrl('/uploads/raw space.png', 'http://localhost:3001')).toThrow(BadRequestException);
    expect(normalizeSearchImageUrl('/uploads/raw%20space.png', 'http://localhost:3001')).toBe('http://localhost:3001/uploads/raw%20space.png');
  });
});

describe('default Search media origin from server configuration', () => {
  beforeEach(() => vi.stubEnv('NODE_ENV', 'development'));
  it('uses local Backend default only when PUBLIC_URL is absent', () => {
    vi.stubEnv('BACKEND_PUBLIC_URL', undefined);vi.stubEnv('BACKEND_PORT', undefined);
    expect(defaultSearchMediaOrigin()).toBe('http://localhost:3001');
    vi.stubEnv('BACKEND_PORT', '3456');
    expect(defaultSearchMediaOrigin()).toBe('http://localhost:3456');
  });
  it('prefers explicit configured media origin', () => {
    vi.stubEnv('BACKEND_PUBLIC_URL', 'https://media.example.test/');vi.stubEnv('BACKEND_PORT', '3456');
    expect(defaultSearchMediaOrigin()).toBe('https://media.example.test/');
  });
  it('does not silently fall back from explicitly empty PUBLIC_URL', () => {
    vi.stubEnv('BACKEND_PUBLIC_URL', '');vi.stubEnv('BACKEND_PORT', '3456');
    expect(() => defaultSearchMediaOrigin()).toThrow(InternalServerErrorException);
  });
  it('rejects invalid fallback port syntax instead of inferring another host/path', () => {
    vi.stubEnv('BACKEND_PUBLIC_URL', undefined);vi.stubEnv('BACKEND_PORT', '3001/evil');
    expect(() => defaultSearchMediaOrigin()).toThrow(InternalServerErrorException);
  });
  it('requires an explicit media origin in production instead of implicit localhost', () => {
    vi.stubEnv('NODE_ENV', 'production');vi.stubEnv('BACKEND_PUBLIC_URL', undefined);vi.stubEnv('BACKEND_PORT', '3456');
    expect(() => defaultSearchMediaOrigin()).toThrow(InternalServerErrorException);
  });
  it('accepts an explicit valid production media origin and never uses fallback port', () => {
    vi.stubEnv('NODE_ENV', 'production');vi.stubEnv('BACKEND_PUBLIC_URL', 'https://media.example.test');vi.stubEnv('BACKEND_PORT', '3456');
    expect(defaultSearchMediaOrigin()).toBe('https://media.example.test');
  });
});
