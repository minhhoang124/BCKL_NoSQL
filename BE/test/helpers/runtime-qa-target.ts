/** Validate before imports/bootstrap can open a DB connection. Never echo credentials. */
export function assertRuntimeQaTarget(
  raw: string | undefined,
  githubActions?: string,
): void {
  try {
    const url = new URL(raw ?? '');
    const local =
      url.hostname === '127.0.0.1' &&
      url.port === '5549' &&
      /^\/bckl_order_resolution_test_[a-z0-9_]{1,40}$/.test(url.pathname) &&
      !/^\/bckl_order_resolution_test_(?:demo|catalog)(?:_|$)/.test(
        url.pathname,
      );
    const ci =
      githubActions === 'true' &&
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.port === '5432' &&
      url.pathname === '/klcn_ecommerce';
    if (
      url.protocol !== 'postgresql:' ||
      (!local && !ci) ||
      url.hash ||
      [...url.searchParams].some(
        ([key, value]) => key !== 'schema' || value !== 'public',
      ) ||
      url.searchParams.getAll('schema').length > 1
    )
      throw new Error();
  } catch {
    throw new Error(
      'E2E requires an explicit isolated QA DATABASE_URL; local/demo .env fallback is forbidden',
    );
  }
}
