import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['test/helpers/buyer-recovery-live-host.qa.ts'],
    setupFiles: ['./test/setup-env.ts'],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 90000, // Child Vitest startup + 15 HTTP scenarios, not a transaction timeout.
  },
});
