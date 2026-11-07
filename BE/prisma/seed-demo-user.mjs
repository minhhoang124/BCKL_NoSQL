import bcrypt from 'bcryptjs';

export async function ensureDemoUser({
  userClient,
  email,
  expectedRole,
  fullName,
  demoPassword,
  passwordHash,
}) {
  const existingUser = await userClient.findUnique({ where: { email } });

  if (!existingUser) {
    return userClient.create({
      data: {
        email,
        passwordHash,
        fullName,
        role: expectedRole,
      },
    });
  }

  const passwordMatches = await bcrypt.compare(
    demoPassword,
    existingUser.passwordHash,
  );

  if (
    existingUser.role !== expectedRole ||
    !existingUser.isActive ||
    !passwordMatches
  ) {
    throw new Error(
      `Refusing to modify existing account ${email}: it is not the expected active demo ${expectedRole} account`,
    );
  }

  return existingUser;
}
