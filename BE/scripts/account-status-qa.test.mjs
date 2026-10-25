import assert from 'node:assert/strict';
import test from 'node:test';
import { accountStatusQaTarget } from './account-status-qa.mjs';

test('accepts exact isolated Accounts target with optional public schema', () => {
  for (const database of [
    'accounts_20261024_v946',
    'attributes_20261019_v947',
    'attributes_20261019_v948',
  ]) {
    const base = `postgresql://127.0.0.1:5549/bckl_order_resolution_test_${database}`;
    assert.equal(accountStatusQaTarget(base).port, '5549');
    assert.equal(accountStatusQaTarget(base + '?schema=public').port, '5549');
  }
});

test('refuses demo, arbitrary QA names and connection overrides before imports/connect', () => {
  const base =
    'postgresql://127.0.0.1:5549/bckl_order_resolution_test_accounts_20261024_v946';
  for (const target of [
    undefined,
    '',
    base.replace(':5549', ':5432'),
    base.replace('127.0.0.1', 'example.com'),
    base.replace('v946', 'v999'),
    base.replace('postgresql:', 'https:'),
    base + '#ignored',
    base + '?host=example.com',
    base + '?options=-csearch_path=public',
    base + '?schema=public&schema=public',
    base + '?schema=other',
  ]) {
    assert.throws(() => accountStatusQaTarget(target));
  }
});
