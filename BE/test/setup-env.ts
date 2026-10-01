import path from 'node:path';
import { config } from 'dotenv';

// CI provides DATABASE_URL directly. Local runs fall back to the repository
// root .env, then BE/.env for an optional service-specific override.
config({ path: path.resolve(process.cwd(), '../.env'), quiet: true });
config({
  path: path.resolve(process.cwd(), '.env'),
  override: true,
  quiet: true,
});

// Tests dispatch explicitly with fixture-scoped queries. Never poll real outbox
// rows in the local demo database while an E2E application is running.
process.env.SEARCH_SYNC_ENABLED = 'false';
process.env.SEARCH_RECONCILIATION_ENABLED = 'false';
// Runtime repair is exercised explicitly by E2E tests. Disable the wall-clock
// cron so it cannot mutate shared fixtures between assertions.
process.env.PRODUCT_IMAGE_REPAIR_ENABLED = 'false';
