import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AuthSessionRate } from './auth-session-rate.js';
import type { PrismaService } from '../prisma.service.js';

describe('Auth admission fails closed', () => {
  it('does not silently bypass limits on missing migration/DB outage', async () => {
    const db = {
      $transaction: vi
        .fn()
        .mockRejectedValue(new Error('synthetic database failure')),
    };
    const rate = new AuthSessionRate(
      db as unknown as PrismaService,
      new ConfigService({
        JWT_ACCESS_SECRET: 'SyntheticAuthAdmissionSecretAtLeast32Chars',
      }),
    );
    await expect(
      rate.consume('login', '127.0.0.1', 'qa@example.invalid'),
    ).rejects.toMatchObject({ status: 503 });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid configuration before using DB', async () => {
    const db = { $transaction: vi.fn() };
    const rate = new AuthSessionRate(
      db as unknown as PrismaService,
      new ConfigService({
        JWT_ACCESS_SECRET: 'SyntheticAuthAdmissionSecretAtLeast32Chars',
        AUTH_LOGIN_IP_PER_MINUTE: '0',
      }),
    );
    await expect(rate.consume('login', '127.0.0.1')).rejects.toMatchObject({
      status: 503,
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
