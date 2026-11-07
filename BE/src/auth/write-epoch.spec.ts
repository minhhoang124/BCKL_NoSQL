import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertCurrentWriteEpoch } from './write-epoch.js';

describe('Transactional write credential epoch', () => {
  it('accepts the verified epoch and keeps trusted internal calls compatible', () => {
    expect(() => assertCurrentWriteEpoch({ credentialVersion: 3 }, 3)).not.toThrow();
    expect(() => assertCurrentWriteEpoch({ credentialVersion: 3 })).not.toThrow();
  });
  it.each([0, -1, 1.2, NaN, Infinity, 2147483648, 1, 4])('rejects missing/invalid/revoked epoch %s without rebasing', expected => {
    expect(() => assertCurrentWriteEpoch({ credentialVersion: 3 }, expected)).toThrow(UnauthorizedException);
  });
  it('rejects missing actor when the HTTP epoch is present', () => {
    expect(() => assertCurrentWriteEpoch(null, 1)).toThrow(UnauthorizedException);
  });
});
