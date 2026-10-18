/** Test-only guard. Call BEFORE bootstrap/fixture writes. Does not connect/reset DB. */
export function assertOrderResolutionQaTarget(raw: string | undefined): void {
  try {
    const url = new URL(raw ?? '');
    if (url.protocol !== 'postgresql:' ||
        !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5549' ||
        !/^\/bckl_order_resolution_test_[a-z0-9_]{1,40}$/.test(url.pathname) ||
        url.hash || [...url.searchParams].some(([k,v]) => k !== 'schema' || v !== 'public') ||
        url.searchParams.getAll('schema').length > 1)
      throw new Error('invalid target');
  } catch {
    // Never echo a URL containing database credentials into test/CI logs.
    throw new Error('Dedicated loopback order-resolution test database on port 5549 required');
  }
}
