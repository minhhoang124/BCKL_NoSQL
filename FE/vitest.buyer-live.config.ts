import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['qa/buyerRecovery.live.qa.ts'], environment: 'node',
    testTimeout: 15000, hookTimeout: 15000, fileParallelism: false },
});
