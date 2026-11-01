import { Client } from 'pg';
import { isFinalDayQaTarget } from './final-day-qa-target.js';

/**
 * Fixture-only DDL channel for fault-injection triggers.
 *
 * The application/runtime role stays DML-only. Triggers needed by a test are
 * created and dropped through a separate connection that is accepted only for
 * the exact, dated, disposable final-day QA database. Never echoes credentials.
 */
export const FAULT_DDL_ROLE = 'bckl_local_migrator';

type Env = Record<string, string | undefined>;

export function resolveFaultDdlUrl(env: Env): string {
  let app: URL;
  try {
    app = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new Error('Fault DDL requires an explicit isolated DATABASE_URL');
  }
  const raw = env.QA_FIXTURE_DDL_URL;
  const finalDay = isFinalDayQaTarget(app);
  if (!raw) {
    if (finalDay)
      throw new Error(
        'Final-day QA database requires QA_FIXTURE_DDL_URL for fixture DDL; the runtime role must stay DML-only',
      );
    // Legacy path (GitHub CI service or older local QA DB): same role as before.
    return app.toString();
  }
  let ddl: URL;
  try {
    ddl = new URL(raw);
  } catch {
    throw new Error('Invalid QA_FIXTURE_DDL_URL');
  }
  if (
    env.GITHUB_ACTIONS === 'true' ||
    !finalDay ||
    ddl.protocol !== 'postgresql:' ||
    ddl.hostname !== app.hostname ||
    ddl.port !== app.port ||
    ddl.pathname !== app.pathname ||
    ddl.username !== FAULT_DDL_ROLE ||
    ddl.username === app.username ||
    ddl.hash ||
    [...ddl.searchParams].some(([k, v]) => k !== 'schema' || v !== 'public') ||
    ddl.searchParams.getAll('schema').length > 1
  )
    throw new Error(
      'QA_FIXTURE_DDL_URL must be the migrator for the same dated final-day QA database',
    );
  return ddl.toString();
}

export type FaultDdl = {
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
};

/** Lazy: suites that never inject a fault open no extra connection. */
export function createFaultDdl(env: Env = process.env): FaultDdl {
  let client: Client | undefined;
  let opening: Promise<Client> | undefined;
  const open = async (): Promise<Client> => {
    const url = resolveFaultDdlUrl(env);
    const c = new Client({
      connectionString: url,
      statement_timeout: 7000,
      connectionTimeoutMillis: 3000,
    });
    await c.connect();
    try {
      if (env.QA_FIXTURE_DDL_URL) {
        const row = (
          await c.query(
            `SELECT current_database() AS db, current_user AS usr, r.rolsuper
               FROM pg_roles r WHERE r.rolname = current_user`,
          )
        ).rows[0];
        if (
          !row ||
          row.usr !== FAULT_DDL_ROLE ||
          row.rolsuper ||
          '/' + row.db !== new URL(url).pathname
        )
          throw new Error('Unexpected fixture DDL identity');
      }
      await c.query("SET lock_timeout = '5s'");
    } catch (e) {
      await c.end().catch(() => undefined);
      throw e;
    }
    return c;
  };
  return {
    async exec(sql) {
      opening ??= open();
      client = await opening;
      await client.query(sql);
    },
    async close() {
      const c = client;
      client = undefined;
      opening = undefined;
      await c?.end().catch(() => undefined);
    },
  };
}
