/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client binds to the server contract in shared/src/api.ts. The alias resolves it the
// same way in an isolated checkout and in the npm-workspace repo (where the workspace
// symlink would also resolve it). The client only ever imports TYPES from it, so no
// shared/zod code ends up in the bundle.
const sharedApi = fileURLToPath(new URL('../shared/src/api.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@bootquest/shared/api': sharedApi },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Pinned to IPv4: the API server probes/listens on 127.0.0.1 only (w1b-review #13c).
    // W10: BOOTQUEST_PORT (the server's own port variable) retargets the proxy, so a parallel
    // audit rig can run on its own ports; the default stays 4178.
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.BOOTQUEST_PORT ?? '4178'}` } },
    // Imported packs carry reference solutions and answer keys: the dev server must never
    // serve them via /@fs/ (w2-review i1). Setting `deny` replaces Vite's defaults, so they
    // are restated here.
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/content/packs/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // full-app user-event flows (typing whole answers) exceeded vitest's 5s default under
    // multi-agent CPU load on this laptop; no assertion depends on timing
    testTimeout: 30_000,
  },
});
