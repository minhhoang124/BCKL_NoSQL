import { describe, expect, it } from 'vitest';
import { accountStatusInput } from './account-status.input.js';
const valid = {
  isActive: false,
  expectedRevision: 1,
  reason: 'QA reason long enough',
};
describe('Strict Accounts status input', () => {
  it.each([
    null,
    [],
    {},
    true,
    'false',
    { isActive: false },
    { ...valid, extra: 1 },
    { ...valid, isActive: 'false' },
    { ...valid, expectedRevision: 0 },
    { ...valid, expectedRevision: -1 },
    { ...valid, expectedRevision: 1.5 },
    { ...valid, expectedRevision: '1' },
    { ...valid, expectedRevision: 2147483648 },
    { ...valid, reason: '' },
    { ...valid, reason: 'a'.repeat(501) },
    { ...valid, reason: 'QA\u0000 reason long enough' },
    { ...valid, reason: 'QA\u0085 reason long enough' },
    { ...valid, reason: 'QA\ud800 reason long enough' },
  ])('rejects invalid input %#', (body) =>
    expect(() => accountStatusInput(body)).toThrow(),
  );
  it('normalizes NFC and trims', () =>
    expect(
      accountStatusInput({
        ...valid,
        reason: '  Nguye\u0302\u0303n yêu cầu khóa tài khoản  ',
      }).reason,
    ).toBe('Nguyễn yêu cầu khóa tài khoản'));
  it('counts Unicode code points, not UTF16 units', () =>
    expect(
      accountStatusInput({ ...valid, reason: '😀'.repeat(500) }).reason,
    ).toHaveLength(1000));
  it('does not mutate caller input', () => {
    const body = { ...valid, reason: '  QA reason long enough  ' };
    accountStatusInput(body);
    expect(body.reason).toBe('  QA reason long enough  ');
  });
});
