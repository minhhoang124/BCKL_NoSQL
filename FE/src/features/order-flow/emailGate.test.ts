import { describe, expect, it } from 'vitest';
import { ApiError } from '../../services/apiClient';
import { rejectedWithoutCommit } from './api';

describe('verified email checkout refusal', () => {
  it('only releases the intent for the exact server precondition refusal', () => {
    expect(rejectedWithoutCommit(new ApiError('Verify email', 412, 'EMAIL_VERIFICATION_REQUIRED'))).toBe(true);
    for (const [status, code] of [[500, 'EMAIL_VERIFICATION_REQUIRED'], [412, 'UNKNOWN'], [409, 'CHECKOUT_IN_PROGRESS'], [404, 'CHECKOUT_NOT_FOUND']] as const)
      expect(rejectedWithoutCommit(new ApiError('Unknown result', status, code))).toBe(false);
    expect(rejectedWithoutCommit(new Error('Connection lost'))).toBe(false);
  });
});
