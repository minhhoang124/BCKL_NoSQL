import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { ensureDemoUser } from '../prisma/seed-demo-user.mjs';

describe('demo seed account safety', () => {
  it('does not promote or change a USER that owns the demo admin email', async () => {
    const originalPasswordHash = await bcrypt.hash('UserPassword123!', 4);
    const existingUser = {
      id: 42,
      email: 'admin.demo@example.com',
      passwordHash: originalPasswordHash,
      fullName: 'Existing User',
      role: 'USER',
      isActive: true,
    };
    const userClient = {
      findUnique: vi.fn().mockResolvedValue(existingUser),
      create: vi.fn(),
    };

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
});
