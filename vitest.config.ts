import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup-isolated-config.ts'],
    testTimeout: 30000, // 30 seconds for embedding/indexing tests
  },
});
