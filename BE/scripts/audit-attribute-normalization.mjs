#!/usr/bin/env node
// Run `pnpm --dir BE build` first. Uses the SAME compiled normalizer as writes.
// Intentionally no dotenv fallback, no connection to dev/demo/remote databases.
import pg from 'pg';
import {
  assertAttributeAuditQaTarget,
  readAttributeNormalizationAudit,
} from '../dist/catalog/attribute-normalization-audit.js';

let pool;
try {
  const connectionString = assertAttributeAuditQaTarget(
    process.env.DATABASE_URL,
  );
  pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 3000,
    query_timeout: 6000,
    application_name: 'attribute-normalization-preflight',
  });
  const report = await readAttributeNormalizationAudit(pool);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.eligibleForNormalizedUniqueness ? 0 : 2;
} catch {
  // Do not echo pg errors, URLs, passwords, raw attribute labels or SQL.
  console.error(
    'ATTRIBUTE_NORMALIZATION_AUDIT_FAILED: build first and use an explicit dedicated QA DATABASE_URL; no data was repaired.',
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
