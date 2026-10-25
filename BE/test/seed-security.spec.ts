import bcrypt from 'bcryptjs';
import type { Prisma, User } from '@prisma/client';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ensureDemoUser } from '../prisma/seed-demo-user.mjs';
import type { DemoUserClient } from '../prisma/seed-demo-user.mjs';

function demoUser(passwordHash: string): User {
  return {
    id: 42,
    email: 'admin.demo@example.com',
    passwordHash,
    credentialVersion: 1,
    statusRevision: 1,
    fullName: 'Existing User',
    role: 'ADMIN',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function clientReturning(
  user: User | null,
  createdUser?: User,
): DemoUserClient {
  return {
    findUnique: vi.fn<DemoUserClient['findUnique']>().mockResolvedValue(user),
    create: vi
      .fn<DemoUserClient['create']>()
      .mockResolvedValue(createdUser ?? demoUser('unused')),
  };
}

describe('demo seed account safety', () => {
  it('does not promote or change a USER that owns the demo admin email', async () => {
    const originalPasswordHash = await bcrypt.hash('UserPassword123!', 4);
    const existingUser: User = {
      ...demoUser(originalPasswordHash),
      role: 'USER',
    };
    const userClient = clientReturning(existingUser);

    await expect(
      ensureDemoUser({
        userClient,
        email: existingUser.email,
        expectedRole: 'ADMIN',
        fullName: 'Demo Admin',
        demoPassword: 'Demo123!',
        passwordHash: await bcrypt.hash('Demo123!', 4),
      }),
    ).rejects.toThrow('Refusing to modify existing account');

    expect(userClient.create).not.toHaveBeenCalled();
    expect(existingUser.role).toBe('USER');
    expect(existingUser.passwordHash).toBe(originalPasswordHash);
  });

  it('creates a missing demo account with the supplied data and returns the User', async () => {
    const passwordHash = await bcrypt.hash('Demo123!', 4);
    const createdUser = demoUser(passwordHash);
    const userClient = clientReturning(null, createdUser);
    const result = await ensureDemoUser({
      userClient,
      email: createdUser.email,
      expectedRole: 'ADMIN',
      fullName: 'Demo Admin',
      demoPassword: 'Demo123!',
      passwordHash,
    });

    expectTypeOf(result).toEqualTypeOf<User>();
    expectTypeOf<
      Pick<Prisma.TransactionClient['user'], 'findUnique' | 'create'>
    >().toExtend<DemoUserClient>();
    expect(result).toBe(createdUser);
    expect(userClient.findUnique).toHaveBeenCalledWith({
      where: { email: createdUser.email },
    });
    expect(userClient.create).toHaveBeenCalledExactlyOnceWith({
      data: {
        email: createdUser.email,
        passwordHash,
        fullName: 'Demo Admin',
        role: 'ADMIN',
      },
    });
  });

  it('returns an existing valid demo account without rewriting it', async () => {
    const existingUser = demoUser(await bcrypt.hash('Demo123!', 4));
    const original = { ...existingUser };
    const userClient = clientReturning(existingUser);

    const result = await ensureDemoUser({
      userClient,
      email: existingUser.email,
      expectedRole: 'ADMIN',
      fullName: 'A different demo name',
      demoPassword: 'Demo123!',
      passwordHash: await bcrypt.hash('Demo123!', 4),
    });

    expect(result).toBe(existingUser);
    expect(existingUser).toEqual(original);
    expect(userClient.create).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'password-mismatch'] as const)(
    'refuses an existing %s account without modifying it',
    async (scenario) => {
      const existingUser = demoUser(
        await bcrypt.hash(
          scenario === 'password-mismatch' ? 'Other123!' : 'Demo123!',
          4,
        ),
      );
      if (scenario === 'inactive') existingUser.isActive = false;
      const original = { ...existingUser };
      const userClient = clientReturning(existingUser);

      await expect(
        ensureDemoUser({
          userClient,
          email: existingUser.email,
          expectedRole: 'ADMIN',
          fullName: 'Demo Admin',
          demoPassword: 'Demo123!',
          passwordHash: await bcrypt.hash('Demo123!', 4),
        }),
      ).rejects.toThrow('Refusing to modify existing account');

      expect(userClient.create).not.toHaveBeenCalled();
      expect(existingUser).toEqual(original);
    },
  );
});
