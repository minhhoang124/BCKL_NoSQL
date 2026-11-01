import { describe, expect, it } from 'vitest';
import { resolveFaultDdlUrl } from './qa-fault-ddl.js';

const db = 'bckl_order_resolution_test_final_20261030_1793440000000';
const app = `postgresql://bckl_local_app:fixture-only@127.0.0.1:5549/${db}`;
const ddl = `postgresql://bckl_local_migrator:fixture-only@127.0.0.1:5549/${db}`;
const base = { DATABASE_URL: app, GITHUB_ACTIONS: 'false' };

describe('QA fault DDL channel (no connections)', () => {
  it('accepts the migrator of the same dated final-day database', () => {
    expect(resolveFaultDdlUrl({ ...base, QA_FIXTURE_DDL_URL: ddl })).toBe(ddl);
  });
  it('fails closed on a final-day database without an explicit DDL url', () => {
    expect(() => resolveFaultDdlUrl(base)).toThrow(/QA_FIXTURE_DDL_URL/);
  });
  it('keeps legacy behaviour for non final-day targets without the variable', () => {
    const legacy = 'postgresql://u:p@127.0.0.1:5549/bckl_order_resolution_test_x';
    expect(resolveFaultDdlUrl({ DATABASE_URL: legacy })).toBe(legacy);
  });
  it.each([
    ['other role', ddl.replace('bckl_local_migrator', 'postgres')],
    ['app role', ddl.replace('bckl_local_migrator', 'bckl_local_app')],
    ['other database', ddl.replace('1793440000000', '1793440000001')],
    ['other port', ddl.replace(':5549', ':5432')],
    ['other host', ddl.replace('127.0.0.1', 'localhost')],
    ['fragment', ddl + '#x'],
    ['foreign schema', ddl + '?schema=private'],
    ['duplicate schema', ddl + '?schema=public&schema=public'],
    ['non-postgres scheme', ddl.replace('postgresql:', 'http:')],
    ['garbage', 'not a url'],
  ])('rejects %s', (_n, url) => {
    expect(() => resolveFaultDdlUrl({ ...base, QA_FIXTURE_DDL_URL: url })).toThrow();
  });
  it('rejects an override for a non final-day or demo database', () => {
    for (const name of ['bckl_order_resolution_test_demo', 'bckl_demo', 'klcn_ecommerce'])
      expect(() =>
        resolveFaultDdlUrl({
          DATABASE_URL: app.replace(db, name),
          QA_FIXTURE_DDL_URL: ddl.replace(db, name),
          GITHUB_ACTIONS: 'false',
        }),
      ).toThrow();
  });
  it('never honours the override in GitHub Actions', () => {
    expect(() =>
      resolveFaultDdlUrl({ ...base, GITHUB_ACTIONS: 'true', QA_FIXTURE_DDL_URL: ddl }),
    ).toThrow();
  });
  it('does not echo credentials in errors', () => {
    try {
      resolveFaultDdlUrl({ ...base, QA_FIXTURE_DDL_URL: ddl.replace('migrator', 'x') });
    } catch (e) {
      expect(String(e)).not.toContain('fixture-only');
    }
  });
});
