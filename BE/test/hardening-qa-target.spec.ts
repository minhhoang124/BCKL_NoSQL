import { describe, expect, it } from 'vitest';
import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';
import { assertOrderResolutionQaTarget } from './helpers/order-resolution-qa-target.js';
import { assertAttributeReadQaTarget } from './helpers/attribute-read-qa-target.js';

describe('Hardening QA target boundaries', () => {
  const url = (name: string, host = '127.0.0.1:5549') =>
    `postgresql://qa:synthetic@${host}/${name}?schema=public`;
  it('allows the exact new hardening target without pretending to be CI', () => {
    const target = url('bckl_order_resolution_test_hardening_20261029');
    expect(() => assertRuntimeQaTarget(target)).not.toThrow();
    expect(() => assertOrderResolutionQaTarget(target)).not.toThrow();
    expect(() => assertAttributeReadQaTarget(target)).not.toThrow();
  });
  it.each([
    'bckl_order_resolution_test_demo_20261028',
    'bckl_order_resolution_test_catalog_20261028',
    'klcn_ecommerce_restored_20261028',
  ])('rejects protected restored/demo database %s', (name) => {
    for (const guard of [
      assertRuntimeQaTarget,
      assertOrderResolutionQaTarget,
      assertAttributeReadQaTarget,
    ])
      expect(() => guard(url(name))).toThrow();
  });
  it.each(['remote.invalid:5549', '127.0.0.1:5432'])(
    'rejects new target at unexpected host/port %s',
    (host) => {
      for (const guard of [
        assertRuntimeQaTarget,
        assertOrderResolutionQaTarget,
        assertAttributeReadQaTarget,
      ])
        expect(() =>
          guard(url('bckl_order_resolution_test_hardening_20261029', host)),
        ).toThrow();
    },
  );
  it('rejects query overrides and suffix typos in the exact Attributes allowlist', () => {
    const target = url('bckl_order_resolution_test_hardening_20261029');
    expect(() =>
      assertAttributeReadQaTarget(target + '&schema=public'),
    ).toThrow();
    expect(() =>
      assertAttributeReadQaTarget(target + '&sslmode=disable'),
    ).toThrow();
    expect(() =>
      assertAttributeReadQaTarget(
        url('bckl_order_resolution_test_hardening_20261029_typo'),
      ),
    ).toThrow();
  });
});
