import { defineConfig } from 'vitest/config';

// Fixture dirs hold copied estate bytes; never collect or transform them.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/citations/fixtures/**'],
  },
});
