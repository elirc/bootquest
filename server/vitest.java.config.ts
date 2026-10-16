import { defineConfig } from 'vitest/config';

// Spawns real javac + java (JDK 17 on PATH); serialized, generous timeouts.
export default defineConfig({
  test: {
    include: ['src/runners/java/runner.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
