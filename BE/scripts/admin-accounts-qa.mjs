// Explicit opt-in QA only. Never load a repository .env or print credentials.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { hash } from 'bcryptjs';

let url;
try { url = new URL(process.env.DATABASE_URL ?? ''); } catch { /* rejected below */ }
if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5549' ||
    !/^\/bckl_order_resolution_test_[a-z0-9_]+$/.test(url.pathname) ||
    url.search || url.hash) {
  throw new Error('Use an isolated QA database on loopback port 5549 only.');
}
const password = process.env.QA_ACCOUNT_PASSWORD;
if (!password || password.length < 12) throw new Error('Set QA_ACCOUNT_PASSWORD (at least 12 characters), do not publish it.');
const pool = new Pool({ connectionString: url.href });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
try {
  const passwordHash = await hash(password, 12);
  const result = await prisma.$transaction(async (tx) => {
    const rows = [];
    for (const [name, role, active] of [
      ['admin-a', 'ADMIN', true], ['admin-b', 'ADMIN', true],
      ['buyer', 'USER', true], ['seller', 'SELLER', true],
      ['inactive', 'USER', false],
    ]) {
      const email = `accounts-qa-${name}@example.invalid`;
      let user = await tx.user.findUnique({ where: { email }, select: { id: true, email: true, role: true, isActive: true } });
      if (!user) user = await tx.user.create({
        data: {
          email, passwordHash, role, isActive: active, fullName: `Accounts QA ${name}`,
          ...(role === 'SELLER' ? { store: { create: { name: 'Accounts QA Store', status: 'ACTIVE' } } } : {}),
        },
        select: { id: true, email: true, role: true, isActive: true },
      });
      // Existing rows/passwords are preserved; this script is not an account reset tool.
      rows.push(user);
    }
    return rows;
  });
  console.log(JSON.stringify({ accounts: result, note: 'Existing passwords unchanged. Read-only Accounts QA, not status hardening acceptance.' }, null, 2));
} catch {
  console.error('QA fixture failed; no credentials or raw database errors are printed.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await pool.end();
}
