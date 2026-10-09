import type { Prisma, Role, User } from '@prisma/client';

// The seed runs as native JavaScript. This sidecar describes its actual Prisma
// inputs and result so TypeScript callers cannot silently treat it as any.
export interface DemoUserClient {
  findUnique(
    args: Pick<Prisma.UserFindUniqueArgs, 'where'>,
  ): PromiseLike<User | null>;
  create(args: Pick<Prisma.UserCreateArgs, 'data'>): PromiseLike<User>;
}

export interface EnsureDemoUserOptions {
  userClient: DemoUserClient;
  email: string;
  expectedRole: Role;
  fullName: string;
  demoPassword: string;
  passwordHash: string;
}

export function ensureDemoUser(options: EnsureDemoUserOptions): Promise<User>;
