import { defineConfig } from 'vitest/config';

// W3c: the self-run runner suite spawns node / tsc / tsx children (real
// processes, real type checks). It runs as its own pass after the main suite
// (`npm test` runs both) with file parallelism off, so its CPU load never
// starves the timing-sensitive engine/runner tests of the main pass.
export default defineConfig({
  test: {
    include: ['src/runners/self-run/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/runners/**/fixtures/**'],
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
