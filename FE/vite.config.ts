/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ['./src/test/setup-timeouts.ts'],
    // Must exceed the 5s Testing Library wait ceiling; passing tests are unaffected.
    testTimeout: 20000,
  },
})
