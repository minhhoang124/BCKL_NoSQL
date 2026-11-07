import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertAttributeReadQaTarget } from '../../test/helpers/attribute-read-qa-target.js';
import { assertOrderResolutionQaTarget } from '../../test/helpers/order-resolution-qa-target.js';

const workflow = readFileSync(
  new URL('../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);

function stepUrl(name: string): string {
  const step = workflow.split(`- name: ${name}`)[1]?.split(/\r?\n\s+- name:/)[0];
  const value = step?.match(/DATABASE_URL:\s+(\S+)/)?.[1];
  if (!value) throw new Error(`Missing isolated DATABASE_URL for ${name}`);
  return value;
}

afterEach(() => vi.unstubAllEnvs());

describe('Combined Attributes CI target safety', () => {
  for (const name of [
    'Prepare isolated Backend E2E database',
    'Run Backend E2E tests',
  ]) {
    it(`${name} is accepted by both strict guards without a CI bypass`, () => {
      vi.stubEnv('GITHUB_ACTIONS', 'false');
      const target = stepUrl(name);
      expect(() => assertOrderResolutionQaTarget(target)).not.toThrow();
      expect(() => assertAttributeReadQaTarget(target)).not.toThrow();
      const url = new URL(target);
      expect(url.hostname).toBe('127.0.0.1');
      expect(url.port).toBe('5549');
    });
  }

  it('migrates, seeds and tests the same disposable service database', () => {
    const prepare = stepUrl('Prepare isolated Backend E2E database');
    expect(stepUrl('Run Backend E2E tests')).toBe(prepare);
    const service = workflow
      .split('backend-e2e-postgres:')[1]
      ?.split(/\r?\n      postgres:/)[0];
    const database = new URL(prepare).pathname.slice(1);
    expect(service).toContain(`POSTGRES_DB: ${database}`);
    expect(service).toContain(`pg_isready -U postgres -d ${database}`);
    expect(service).toContain('127.0.0.1:5549:5432');
  });

  it('does not weaken either guard for a demo port, unrelated DB or URL override', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    for (const target of [
      'postgresql://postgres@127.0.0.1:5432/klcn_ecommerce',
      'postgresql://postgres@127.0.0.1:5549/demo',
      'postgresql://postgres@127.0.0.1:5549/bckl_order_resolution_test_attributes_20261019?host=remote',
    ]) {
      expect(() => assertOrderResolutionQaTarget(target)).toThrow();
      expect(() => assertAttributeReadQaTarget(target)).toThrow();
    }
  });
});
