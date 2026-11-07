import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';

describe('Global E2E database target gate', () => {
  it.each([
    undefined, '', 'postgresql://u:secret@localhost:5432/klcn_ecommerce',
    'postgresql://u:secret@127.0.0.1:5432/klcn_ecommerce',
    'postgresql://u:secret@127.0.0.1:5549/klcn_ecommerce',
    'postgresql://u:secret@remote.invalid:5549/bckl_order_resolution_test_qa',
    'postgresql://u:secret@127.0.0.1:5549/bckl_order_resolution_test_qa?schema=other',
    'postgresql://u:secret@127.0.0.1:5549/bckl_order_resolution_test_qa?schema=public&schema=public',
    'postgresql://u:secret@127.0.0.1:5549/bckl_order_resolution_test_qa#fragment',
  ])('rejects unsafe or implicit target without leaking credentials: %s', raw => {
    expect(() => assertRuntimeQaTarget(raw, 'false')).toThrow(/explicit isolated QA/);
    try { assertRuntimeQaTarget(raw, 'false'); } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });
  it('accepts the common Attributes/Buyer dedicated QA target', () => {
    expect(() => assertRuntimeQaTarget('postgresql://postgres@127.0.0.1:5549/bckl_order_resolution_test_attributes_20261019_v321?schema=public', 'false')).not.toThrow();
  });
  it('keeps the disposable GitHub service target separate from local demo', () => {
    const raw = 'postgresql://postgres:postgres@localhost:5432/klcn_ecommerce?schema=public';
    expect(() => assertRuntimeQaTarget(raw, 'true')).not.toThrow();
    expect(() => assertRuntimeQaTarget(raw, undefined)).toThrow();
  });
});

describe('E2E setup fails before fixture imports and never loads local dotenv', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock('dotenv'); vi.resetModules(); });
  it('does not allow dotenv to replace an explicit QA target', async () => {
    vi.resetModules();
    const target = 'postgresql://postgres@127.0.0.1:5549/bckl_order_resolution_test_attributes_20261019_v321?schema=public';
    vi.stubEnv('DATABASE_URL', target);
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    const config = vi.fn(() => { process.env.DATABASE_URL = 'postgresql://localhost:5432/klcn_ecommerce'; });
    vi.doMock('dotenv', () => ({ config }));
    await import('./setup-env.js');
    expect(config).not.toHaveBeenCalled();
    expect(process.env.DATABASE_URL).toBe(target);
    expect(process.env.SEARCH_SYNC_ENABLED).toBe('false');
  });
  it.each([undefined, 'postgresql://localhost:5432/klcn_ecommerce'])('refuses an implicit or demo target at setup: %s', async raw => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', raw);
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    await expect(import('./setup-env.js')).rejects.toThrow(/explicit isolated QA/);
  });
});
