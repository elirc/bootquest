// THE single import-site switch between the mock and the real API.
// Default: the real Express API at /api (vite dev proxies it to 127.0.0.1:4178).
// Standalone demo without a server: `npm run dev:mock` (vite --mode mock).

import { createHttpApi } from './http';
import { mockApi } from './mock';
import type { BootQuestApi } from './types';

export type * from './types';
export const API_MODE: 'mock' | 'http' = import.meta.env.MODE === 'mock' ? 'mock' : 'http';
export const api: BootQuestApi = API_MODE === 'mock' ? mockApi : createHttpApi('/api');
