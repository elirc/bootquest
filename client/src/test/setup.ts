import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// W10: full-app findBy / waitFor flows flaked at Testing Library's 1s default window while ten
// agents shared this laptop's CPU (same reason as vite.config's testTimeout). A longer window
// only delays a FAILING wait; no assertion is weakened and passing waits return immediately.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());
