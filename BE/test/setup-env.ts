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
