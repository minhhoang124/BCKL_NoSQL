import { assertRuntimeQaTarget } from './helpers/runtime-qa-target.js';

// No .env fallback or override: a local service file may point at the demo DB.
// Abort the entire suite before collecting tests or opening fixture connections.
assertRuntimeQaTarget(process.env.DATABASE_URL, process.env.GITHUB_ACTIONS);

// Tests dispatch explicitly with fixture-scoped queries. Never poll real outbox
// rows in the local demo database while an E2E application is running.
process.env.SEARCH_SYNC_ENABLED = 'false';
process.env.SEARCH_RECONCILIATION_ENABLED = 'false';
// Runtime repair is exercised explicitly by E2E tests. Disable the wall-clock
// cron so it cannot mutate shared fixtures between assertions.
process.env.PRODUCT_IMAGE_REPAIR_ENABLED = 'false';
process.env.ORDER_AUTO_COMPLETE_ENABLED = 'false';
