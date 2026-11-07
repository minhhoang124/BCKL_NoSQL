import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['test/helpers/admin-attribute-handoff.qa.ts'],
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 20000,
    hookTimeout: 15000,
  },
});
