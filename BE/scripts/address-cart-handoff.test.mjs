import assert from 'node:assert/strict';
import test from 'node:test';
import { safeDatabase, safePort, safeOrigin } from './address-cart-handoff.mjs';

test('allows only explicitly named loopback handoff databases', () => {
  assert.equal(
    safeDatabase('postgresql://localhost:5432/bckl_hien_address_cart_20261010'),
    'bckl_hien_address_cart_20261010',
  );
  assert.equal(
    safeDatabase('postgres://127.0.0.1/bckl_hien_address_cart_20261010_a'),
    'bckl_hien_address_cart_20261010_a',
  );
});
test('refuses pg connection-string overrides even on an allowed host', () => {
  for (const suffix of [
    '?host=example.com',
    '?database=klcn_ecommerce',
    '?port=9999',
    '?options=unsafe',
    '#ignored',
  ]) {
    assert.throws(() =>
      safeDatabase(
        `postgres://localhost/bckl_hien_address_cart_20261010${suffix}`,
      ),
    );
  }
  assert.equal(
    safeDatabase(
      'postgres://localhost/bckl_hien_address_cart_20261010?schema=public',
    ),
    'bckl_hien_address_cart_20261010',
  );
});
test('permits only unprivileged integer ports', () => {
  assert.equal(safePort('3012'), 3012);
  for (const port of [
    '0',
    '80',
    '65536',
    '-3011',
    '3011.5',
    'NaN',
    '3011/evil',
  ])
    assert.throws(() => safePort(port));
});
test('private config cannot bind or fetch arbitrary origins', () => {
  assert.equal(safeOrigin('http://127.0.0.1:3012'), 'http://127.0.0.1:3012');
  for (const origin of [
    'http://example.com:3011',
    'http://0.0.0.0:3011',
    'https://127.0.0.1:3011',
    'http://user:pass@127.0.0.1:3011',
    'http://127.0.0.1:3011/path',
    'http://127.0.0.1:3011?x=1',
    'http://127.0.0.1:80',
  ])
    assert.throws(() => safeOrigin(origin));
});
for (const url of [
  '',
  'postgres://localhost/klcn_ecommerce',
  'postgres://localhost/bckl_order_flow_20261010_a',
  'postgres://example.com/bckl_hien_address_cart_20261010',
  'postgres://localhost/bckl_hien_address_cart_20261010_other/path',
  'https://localhost/bckl_hien_address_cart_20261010',
]) {
  test(`rejects non-handoff target ${url || '(empty)'}`, () =>
    assert.throws(() => safeDatabase(url)));
}
