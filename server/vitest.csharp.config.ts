import { defineConfig } from 'vitest/config';

// Spawns real dotnet builds; serialized, long timeouts (P2 measured ~105s).
export default defineConfig({
  test: {
    include: ['src/runners/csharp/runner.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
