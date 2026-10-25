// Explicit, repeatable fixture provisioning; never loads dotenv or resets accounts.
import { pathToFileURL } from 'node:url';

export function accountStatusQaTarget(raw) {
  const url = new URL(raw ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '5549' ||
    ![
      '/bckl_order_resolution_test_accounts_20261024_v946',
      '/bckl_order_resolution_test_attributes_20261019_v947',
      '/bckl_order_resolution_test_attributes_20261019_v948',
    ].includes(url.pathname) ||
    url.hash ||
    [...url.searchParams].some(
      ([key, value]) => key !== 'schema' || value !== 'public',
    ) ||
    url.searchParams.getAll('schema').length > 1
  ) {
    throw Error(
      'Use the explicit Accounts QA database on 127.0.0.1:5549 only.',
    );
  }
  return url;
}

export async function provisionAccounts(prisma, passwordHash) {
  return prisma.$transaction(
    async (tx) => {
      // Serialize this fixture script only. Application writes use a different gate.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(190311, 2)`;
      const accounts = [];
      for (const [label, role, isActive] of [
        ['admin-a', 'ADMIN', true],
        ['admin-b', 'ADMIN', true],
        ['buyer', 'USER', true],
        ['seller', 'SELLER', true],
        ['inactive', 'USER', false],
      ]) {
        const email = `status-qa-${label}@example.invalid`;
        const select = {
          id: true,
          email: true,
          role: true,
          isActive: true,
          statusRevision: true,
          store: { select: { id: true, status: true } },
        };
        let account = await tx.user.findUnique({ where: { email }, select });
        const created = !account;
        if (!account)
          account = await tx.user.create({
            data: {
              email,
              passwordHash,
              fullName: `Status QA ${label}`,
              role,
              isActive,
              ...(role === 'SELLER'
                ? {
                    store: {
                      create: { name: 'Status QA Store', status: 'ACTIVE' },
                    },
                  }
                : {}),
            },
            select,
          });
        // No update/upsert: reruns preserve status, credentials, revision and audit.
        accounts.push({ label, created, ...account });
      }
      return accounts;
    },
    { timeout: 15000 },
  );
}

async function main() {
  const url = accountStatusQaTarget(process.env.DATABASE_URL);
  if (process.env.QA_ACCOUNT_STATUS_FIXTURE !== '1')
    throw Error('Explicit QA fixture opt-in required.');
  const password = process.env.QA_ACCOUNT_PASSWORD;
  if (!password || password.length < 12)
    throw Error('Supply a private QA password of at least 12 characters.');
  const [{ PrismaClient }, { PrismaPg }, { Pool }, { hash }] =
    await Promise.all([
      import('@prisma/client'),
      import('@prisma/adapter-pg'),
      import('pg'),
      import('bcryptjs'),
    ]);
  const pool = new Pool({ connectionString: url.toString() });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const [identity] = await prisma.$queryRaw`SELECT current_database() AS name,
      rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user`;
    if (
      identity.name !== url.pathname.slice(1) ||
      identity.rolsuper ||
      identity.rolcreatedb ||
      identity.rolcreaterole
    )
      throw Error('Use a non-privileged QA application role.');
    console.log(
      JSON.stringify(
        {
          accounts: await provisionAccounts(prisma, await hash(password, 12)),
          note: 'QA only. Existing accounts unchanged; password is supplied privately, never printed.',
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      'Accounts QA provisioning refused or failed. No credentials or raw database errors are printed.',
    );
    process.exitCode = 1;
  });
}
