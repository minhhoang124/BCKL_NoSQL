import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Fresh queue scope, not deletion/backdating/filtering of a shared queue. */
export async function isolatedD07Database(source: string) {
  const url = new URL(source);
  const hardening =
    url.hostname === '127.0.0.1' &&
    url.port === '5549' &&
    url.pathname === '/bckl_order_resolution_test_hardening_20261029' &&
    url.username === 'bckl_local_migrator';
  const local =
    hardening ||
    (url.hostname === '127.0.0.1' &&
      url.port === '5549' &&
      [
        '/bckl_order_resolution_test_attributes_20261019_v950',
        '/bckl_order_resolution_test_attributes_20261019_v951',
        '/bckl_order_resolution_test_attributes_20261019_v953',
        '/bckl_order_resolution_test_attributes_20261019_v955',
        '/bckl_order_resolution_test_attributes_20261019_v957',
        '/bckl_order_resolution_test_attributes_20261019_v959',
        '/bckl_order_resolution_test_attributes_20261019_v961',
        '/bckl_order_resolution_test_attributes_20261019_v965',
        '/bckl_order_resolution_test_attributes_20261019_v967',
        '/bckl_order_resolution_test_attributes_20261019_v971',
        '/bckl_order_resolution_test_attributes_20261019_v973',
        '/bckl_order_resolution_test_attributes_20261019_v975',
      ].includes(url.pathname) &&
      url.username === 'bckl_qa_migrator_20261021');
  const ci =
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.CI === 'true' &&
    /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') &&
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    ((['', '5432'].includes(url.port) && url.pathname === '/klcn_ecommerce') ||
      (url.port === '5549' &&
        url.pathname === '/bckl_order_resolution_test_attributes_20261019'));
  if (
    (!local && !ci) ||
    url.protocol !== 'postgresql:' ||
    url.hash ||
    [...url.searchParams].some(([k, v]) => k !== 'schema' || v !== 'public') ||
    url.searchParams.getAll('schema').length > 1
  )
    throw Error('D07 private database requires exact isolated QA or GitHub CI');
  for (const file of ['../../.env', '../../../.env']) {
    try {
      await access(new URL(file, import.meta.url));
      throw Error('D07 refuses dotenv');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  const name =
    'bckl_order_resolution_test_d07_20261026_' +
    randomUUID().replaceAll('-', '').slice(0, 16);
  if (
    !/^bckl_order_resolution_test_d07_20261026_[0-9a-f]{16}$/.test(name) ||
    name.length > 63
  )
    throw Error('Invalid test identity');
  // New-machine runtime role intentionally has no CREATEDB. Provision child QA
  // databases with a separate, explicit role instead of elevating the app role.
  let provisioner = url;
  if (hardening) {
    try {
      provisioner = new URL(process.env.QA_DATABASE_PROVISIONER_URL ?? '');
    } catch {
      throw Error('Invalid explicit QA provisioner');
    }
  }
  if (
    hardening &&
    (provisioner.protocol !== 'postgresql:' ||
      provisioner.hostname !== url.hostname ||
      provisioner.port !== url.port ||
      provisioner.pathname !== url.pathname ||
      provisioner.username !== 'bckl_qa_provisioner_20261029' ||
      provisioner.hash ||
      [...provisioner.searchParams].some(
        ([k, v]) => k !== 'schema' || v !== 'public',
      ) ||
      provisioner.searchParams.getAll('schema').length > 1)
  )
    throw Error('Invalid explicit QA provisioner');
  const admin = new Client({ connectionString: provisioner.toString() });
  try {
    await admin.connect();
    const role = (
      await admin.query(
        'SELECT rolsuper,rolcreatedb,rolcreaterole,current_user AS actor FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    if (
      local &&
      (role.actor !== provisioner.username ||
        role.rolsuper ||
        role.rolcreaterole ||
        !role.rolcreatedb)
    )
      throw Error('Unexpected QA provisioner');
    await admin.query(
      `CREATE DATABASE "${name}"${hardening ? ' OWNER bckl_local_migrator' : ''}`,
    );
    await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
  } finally {
    await admin.end();
  }
  url.pathname = '/' + name;
  try {
    execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('../../node_modules/prisma/build/index.js', import.meta.url),
        ),
        'migrate',
        'deploy',
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: { ...process.env, DATABASE_URL: url.toString() },
        windowsHide: true,
        stdio: 'pipe',
        timeout: 20000,
      },
    );
  } catch {
    throw Error('D07 isolated migration failed; connection details withheld');
  }
  // Retain the DB for inspection, never DROP/reset or mutate another suite's queue.
  return { name, url: url.toString() };
}
