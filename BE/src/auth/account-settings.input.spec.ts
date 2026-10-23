import { describe, expect, it } from 'vitest';
import { passwordInput, profileInput } from './account-settings.input.js';
import { credentialMatches } from './credential-version.js';
describe('Account settings strict input and credential versions', () => {
  it('normalizes name but preserves comparison snapshot exactly', () => {
    expect(
      profileInput({
        fullName: '  Nguye\u0302n Va\u0306n A ',
        expectedFullName: null,
      }),
    ).toEqual({ fullName: 'Nguyên Văn A', expectedFullName: null });
  });
  it.each([
    null,
    [],
    {},
    { fullName: 'Hi' },
    { fullName: 'Hi', expectedFullName: null, role: 'ADMIN' },
    { fullName: 12, expectedFullName: null },
    { fullName: 'a\nb', expectedFullName: null },
    { fullName: 'ab\u200b', expectedFullName: null },
    { fullName: ' '.repeat(30), expectedFullName: null },
  ])('rejects invalid profile %#', (value) =>
    expect(() => profileInput(value)).toThrow(),
  );
  it('does not trim passwords', () =>
    expect(
      passwordInput({ currentPassword: ' old ', newPassword: ' new pass ' }),
    ).toEqual({ currentPassword: ' old ', newPassword: ' new pass ' }));
  it.each([
    {},
    { currentPassword: '', newPassword: '12345678' },
    { currentPassword: 'a', newPassword: 'short' },
    { currentPassword: 'a', newPassword: 'é'.repeat(37) },
    { currentPassword: 'a', newPassword: '1234567\0' },
    { currentPassword: 'a', newPassword: '12345678', userId: 2 },
  ])('rejects invalid password %#', (value) =>
    expect(() => passwordInput(value)).toThrow(),
  );
  it('allows exactly72 UTF8 bytes', () =>
    expect(
      passwordInput({ currentPassword: 'x', newPassword: 'é'.repeat(36) })
        .newPassword,
    ).toHaveLength(36));
  it.each([
    [undefined, 1, true],
    [undefined, 2, false],
    [1, 1, true],
    [1, 2, false],
    [2, 2, true],
    ['2', 2, false],
    [null, 1, false],
    [NaN, 1, false],
    [0, 1, false],
    [1.1, 1, false],
  ])('checks claim %s against %s', (claim, current, expected) =>
    expect(credentialMatches(claim, current as number)).toBe(expected),
  );
});
