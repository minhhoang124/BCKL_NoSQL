import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isolatedD07Database } from './isolated-d07-database.js';
const exact =
  'postgresql://bckl_qa_migrator_20261021:fixture-only@127.0.0.1:5549/bckl_order_resolution_test_attributes_20261019_v950';
describe('D07 isolated database safety boundary (no connections)', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_ACTIONS', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it.each([
    exact.replace(':5549', ':5432'),
    exact.replace('127.0.0.1', 'localhost'),
    exact.replace('_v950', '_v949'),
    exact.replace('bckl_qa_migrator_20261021', 'postgres'),
    exact + '#wrong',
    exact + '?schema=public&schema=public',
    exact + '?schema=private',
  ])('rejects wrong target before provisioning: %s', async (url) => {
    await expect(isolatedD07Database(url)).rejects.toThrow(
      'D07 private database requires exact isolated QA or GitHub CI',
    );
  });
});
