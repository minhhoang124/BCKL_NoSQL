import { isFinalDayQaTarget } from './final-day-qa-target.js';

/** Allow only our dedicated local DB or GitHub's disposable PostgreSQL service. */
export function assertAttributeReadQaTarget(raw: string | undefined): URL {
  try {
    const url = new URL(raw ?? '');
    const local = isFinalDayQaTarget(url) ||
      url.hostname === '127.0.0.1' &&
      url.port === '5549' &&
      (url.pathname === '/bckl_order_resolution_test_hardening_20261029' ||
        /^\/bckl_order_resolution_test_attributes_20261019(?:_v[1-9]\d*)?$/.test(
          url.pathname,
        ));
    const ci =
      process.env.GITHUB_ACTIONS === 'true' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
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
    return url;
  } catch {
    throw new Error(
      'Dedicated Attributes QA database or disposable GitHub service required',
    );
  }
}
