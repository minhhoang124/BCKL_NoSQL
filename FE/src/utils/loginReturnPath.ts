/** Only return to a local route carried by the router, never an external URL. */
export function loginReturnPath(value: unknown): string {
  if (!value || typeof value !== 'object') return '/';
  const route = value as Record<string, unknown>;
  const pathname = route.pathname;
  const search = route.search ?? '';
  const hash = route.hash ?? '';
  if (typeof pathname !== 'string' || typeof search !== 'string' || typeof hash !== 'string') return '/';
  if (!pathname.startsWith('/') || pathname.startsWith('//') || /[?#]/.test(pathname) || /%(?:2f|5c|00|0[1-9a-f]|1[0-9a-f]|7f)/i.test(pathname)) return '/';
  if ([pathname, search, hash].some(part => /[\u0000-\u0020\u007f\\]/.test(part))) return '/';
  if ((search && (!search.startsWith('?') || search.includes('#'))) || (hash && !hash.startsWith('#'))) return '/';
  try {
    const origin = 'https://bckl.invalid';
    const parsed = new URL(pathname + search + hash, origin);
    const decodedPathname = decodeURIComponent(parsed.pathname);
    if (
      parsed.origin !== origin ||
      !parsed.pathname.startsWith('/') ||
      parsed.pathname.startsWith('//') ||
      !decodedPathname.startsWith('/') ||
      decodedPathname.startsWith('//') ||
      /[\u0000-\u0020\u007f\\]/.test(decodedPathname) ||
      /^\/(login|register)(\/|$)/i.test(parsed.pathname) ||
      /^\/(login|register)(\/|$)/i.test(decodedPathname)
    ) {
      return '/';
    }
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return '/';
  }
}
