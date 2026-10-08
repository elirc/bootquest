import { defineConfig } from 'vitest/config';

// Fixture dirs hold copied estate bytes; never collect or transform them.
export default defineConfig({
  test: {
    // factory tests execute the real runner; vitest's 5s default flakes
    // under multi-agent load on this laptop (same raise as the server config)
    testTimeout: 60_000,
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/citations/fixtures/**', 'src/factory/fixtures/**'],
  },
});
