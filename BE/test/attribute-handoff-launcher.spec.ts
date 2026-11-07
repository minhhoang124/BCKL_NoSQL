import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
const launcher = fileURLToPath(
  new URL('../../scripts/run-attributes-handoff-qa.mjs', import.meta.url),
);
// Synthetic configuration, never a real credential or connection target.
const safe =
  'postgresql://qa:synthetic-password-only@127.0.0.1:5549/bckl_order_resolution_test_attributes_20261019_v1';
describe('Attributes handoff refuses unsafe configuration before connecting', () => {
  it.each([
    [safe.replace(':5549/', ':5432/'), []],
    [safe.replace('127.0.0.1', 'remote.example.test'), []],
    [
      safe.replace(
        'bckl_order_resolution_test_attributes_20261019_v1',
        'klcn_ecommerce',
      ),
      [],
    ],
    [safe + '?schema=private', []],
    [safe + '?schema=public&schema=public', []],
    [safe + '#fragment', []],
    [safe.replace('synthetic-password-only', 'short'), []],
    [safe.replace('synthetic-password-only', '%61%61%61%61'), []],
    [safe, ['--reset']],
  ])(
    'rejects target/arguments %# without exposing configuration',
    (url, args) => {
      const child = spawnSync(process.execPath, [launcher, ...args], {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          DATABASE_URL: url,
          JWT_ACCESS_SECRET: 'access-synthetic-only-secret-at-least32',
          JWT_REFRESH_SECRET: 'refresh-synthetic-only-secret-at-least32',
        },
      });
      expect(child.status).toBe(1);
      expect(child.error).toBeUndefined();
      expect(child.stdout).toBe('');
      expect(child.stderr).toContain('configuration withheld');
      expect(child.stderr).not.toContain(url);
      expect(child.stderr).not.toContain('synthetic-password-only');
    },
  );
});
