import { describe, expect, it } from 'vitest';
import { loginReturnPath } from './loginReturnPath';

describe('loginReturnPath', () => {
  it('preserves valid internal pathname, search, and hash', () => {
    expect(
      loginReturnPath({
        pathname: '/chat',
        search: '?storeId=42&tab=messages',
        hash: '#composer',
      }),
    ).toBe('/chat?storeId=42&tab=messages#composer');
    expect(loginReturnPath({ pathname: '/products/99' })).toBe('/products/99');
    expect(loginReturnPath({ pathname: '/messages', search: '?storeId=42', hash: '#composer' }))
      .toBe('/messages?storeId=42#composer');
    expect(loginReturnPath({ pathname: '/search', search: '?q=tai%20nghe&next=https%3A%2F%2Fexample.invalid' }))
      .toBe('/search?q=tai%20nghe&next=https%3A%2F%2Fexample.invalid');
  });

  it('falls back to root for nullish, primitive, or malformed field types', () => {
    expect(loginReturnPath(null)).toBe('/');
    expect(loginReturnPath(undefined)).toBe('/');
    expect(loginReturnPath('/chat?storeId=1')).toBe('/');
    expect(loginReturnPath({ pathname: 123 })).toBe('/');
    expect(loginReturnPath({ pathname: '/chat', search: 123 })).toBe('/');
    expect(loginReturnPath({ pathname: '/chat', hash: {} })).toBe('/');
  });

  it('rejects open redirects, protocol-relative paths, backslashes, and control characters', () => {
    expect(loginReturnPath({ pathname: 'https://evil.example/phish' })).toBe('/');
    expect(loginReturnPath({ pathname: '//evil.example/phish' })).toBe('/');
    expect(loginReturnPath({ pathname: '/\\evil.example' })).toBe('/');
    expect(loginReturnPath({ pathname: '/%2fevil.example' })).toBe('/');
    expect(loginReturnPath({ pathname: '/%5cevil.example' })).toBe('/');
    expect(loginReturnPath({ pathname: '/chat\u0000' })).toBe('/');
    expect(loginReturnPath({ pathname: '/chat', search: '?next=\u000a//evil' })).toBe('/');
    expect(loginReturnPath({ pathname: '/chat?injected=1', search: '?storeId=2' })).toBe('/');
    expect(loginReturnPath({ pathname: '/chat', search: 'storeId=2' })).toBe('/');
    expect(loginReturnPath({ pathname: '/chat', search: '?a=1#frag' })).toBe('/');
    expect(loginReturnPath({ pathname: '/chat', hash: 'frag' })).toBe('/');
  });

  it('prevents redirect loops to /login and /register including trailing slashes and dot segments', () => {
    expect(loginReturnPath({ pathname: '/login' })).toBe('/');
    expect(loginReturnPath({ pathname: '/login/' })).toBe('/');
    expect(loginReturnPath({ pathname: '/LOGIN', search: '?from=/chat' })).toBe('/');
    expect(loginReturnPath({ pathname: '/register' })).toBe('/');
    expect(loginReturnPath({ pathname: '/register/' })).toBe('/');
    expect(loginReturnPath({ pathname: '/chat/../login/' })).toBe('/');
    expect(loginReturnPath({ pathname: '/%6cogin' })).toBe('/');
  });
});
