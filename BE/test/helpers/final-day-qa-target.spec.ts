import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isFinalDayQaTarget } from './final-day-qa-target.js';
import { assertAttributeReadQaTarget } from './attribute-read-qa-target.js';

const name = 'bckl_order_resolution_test_final_20261030_1793351421879';
const target = (database = name, host = '127.0.0.1:5549', query = '') =>
  new URL(`postgresql://qa:synthetic@${host}/${database}${query}`);

describe('Dated final-day QA target remains isolated and canonical', () => {
  beforeEach(() => vi.stubEnv('GITHUB_ACTIONS', 'false'));
  afterEach(() => vi.unstubAllEnvs());
  it.each(['', '?schema=public'])(
    'accepts only the explicit timestamp target %s',
    (query) => {
      expect(isFinalDayQaTarget(target(name, undefined, query))).toBe(true);
      expect(() =>
        assertAttributeReadQaTarget(target(name, undefined, query).href),
      ).not.toThrow();
    },
  );
  it.each([
    'bckl_order_resolution_test_demo_20261028',
    'bckl_order_resolution_test_catalog_20261028',
    'klcn_ecommerce',
    'bckl_order_resolution_test_arbitrary',
    'bckl_order_resolution_test_final_20261031_1793351421879',
    'bckl_order_resolution_test_final_20261030_179335142187',
    'bckl_order_resolution_test_final_20261030_17933514218790',
    'bckl_order_resolution_test_final_20261030_179335142187a',
    name + '_typo',
    name + '/',
  ])('rejects protected, arbitrary or misspelled database %s', (database) => {
    const url = target(database);
    expect(isFinalDayQaTarget(url)).toBe(false);
    expect(() => assertAttributeReadQaTarget(url.href)).toThrow();
  });
  it.each([
    'remote.invalid:5549',
    'localhost:5549',
    '127.0.0.1:5432',
    '[::1]:5549',
  ])('rejects unexpected host/port %s', (host) => {
    expect(isFinalDayQaTarget(target(name, host))).toBe(false);
  });
  it.each([
    '?schema=other',
    '?schema=public&schema=public',
    '?schema=public&options=x',
    '?sslmode=disable',
    '?schema=public#fragment',
    '#fragment',
  ])('rejects override or fragment %s', (query) => {
    const url = target(name, undefined, query);
    expect(isFinalDayQaTarget(url)).toBe(false);
    expect(() => assertAttributeReadQaTarget(url.href)).toThrow();
  });
  it('rejects another protocol even when host and pathname match', () => {
    const url = new URL(`http://127.0.0.1:5549/${name}`);
    expect(isFinalDayQaTarget(url)).toBe(false);
  });
  it('does not use CI env to authorize an unsafe final-day URL', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    expect(isFinalDayQaTarget(target(name, 'remote.invalid:5549'))).toBe(false);
    expect(
      isFinalDayQaTarget(
        target(name, undefined, '?schema=public&schema=public'),
      ),
    ).toBe(false);
  });
  it('keeps the prior exact hardening and Attributes targets accepted by their original guard', () => {
    for (const database of [
      'bckl_order_resolution_test_hardening_20261029',
      'bckl_order_resolution_test_attributes_20261019_v975',
    ]) {
      expect(isFinalDayQaTarget(target(database))).toBe(false);
      expect(() =>
        assertAttributeReadQaTarget(target(database).href),
      ).not.toThrow();
    }
  });
});
