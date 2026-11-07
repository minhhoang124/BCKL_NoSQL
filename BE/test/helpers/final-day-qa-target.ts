import { assertRuntimeQaTarget } from './runtime-qa-target.js';

/** Narrow dated final-day target, never a generic exemption from DB guards. */
export function isFinalDayQaTarget(url: URL): boolean {
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '5549' ||
    !/^\/bckl_order_resolution_test_final_20261030_[0-9]{13}$/.test(
      url.pathname,
    )
  )
    return false;
  try {
    // CI cannot authorize this local extension. Retain canonical protocol,
    // fragment, public-schema and query-override restrictions independently.
    assertRuntimeQaTarget(url.href, 'false');
    return true;
  } catch {
    return false;
  }
}
