import { defineConfig } from '@prisma/config';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(__dirname, '../.env') });
config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  earlyAccess: true,
  migrations: {
    seed: 'node prisma/seed.mjs',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
