import { defineConfig } from 'vitest/config';

// The csharp runner suite needs dotnet + ~105s; it runs via `npm run
// test:csharp` (vitest.csharp.config.ts), not in the default suite.
// Fixture dirs hold upstream bytes (incl. a real u03.test.ts) that must
// never be collected or transformed.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.mjs'],
    exclude: [
      '**/node_modules/**',
      'src/runners/**/fixtures/**',
      'src/runners/csharp/runner.test.ts',
    ],
  },
});
