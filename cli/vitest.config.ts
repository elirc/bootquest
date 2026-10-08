import { defineConfig } from 'vitest/config';

// The e2e suite boots the real server (pack load + grader cold start), so it
// gets generous timeouts; unit suites stay fast.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
