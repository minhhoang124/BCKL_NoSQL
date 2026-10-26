import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qaUrl } from './aftersales-qa.mjs';
const url =
  'postgresql://bckl_qa_app_20261021:synthetic-only@127.0.0.1:5549/bckl_order_resolution_test_attributes_20261019_v950';
test('accepts exact isolated application-role target, with optional public schema', () => {
  assert.equal(qaUrl(url).port, '5549');
  assert.equal(qaUrl(url + '?schema=public').port, '5549');
});
for (const [name, value] of Object.entries({
  demoPort: url.replace(':5549', ':5432'),
  host: url.replace('127.0.0.1', 'localhost'),
  wrongDatabase: url.replace('_v950', '_v949'),
  privilegedRole: url.replace('bckl_qa_app_20261021', 'postgres'),
  hash: url + '#secret',
  unknownQuery: url + '?host=demo',
  duplicateQuery: url + '?schema=public&schema=public',
  wrongSchema: url + '?schema=private',
}))
  test(`refuses ${name} before connecting`, () =>
    assert.throws(() => qaUrl(value)));
