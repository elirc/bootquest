import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { IDENTITY_RANDOM, gateShuffle } from '../lib/gate';

// W10: full-app findBy / waitFor flows flaked at Testing Library's 1s default window while ten
// agents shared this laptop's CPU (same reason as vite.config's testTimeout). A longer window
// only delays a FAILING wait; no assertion is weakened and passing waits return immediately.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  // the player keeps code drafts and last-attempt pointers in localStorage: no test sees another's
  try {
    window.localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

// f52 wave B: a Fundamentals gate shuffles its questions and choices on every try. Suites that step
// through a gate address "Q1 choice 2" in served terms, so the order is pinned to the identity here;
// the shuffle's own tests (lib/gate.test.ts, pages/gate-failpath.test.tsx) install a seeded source.
beforeEach(() => {
  gateShuffle.random = IDENTITY_RANDOM;
});
