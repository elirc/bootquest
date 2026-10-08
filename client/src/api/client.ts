// THE single import-site switch between the mock and the real API.
// W1b: replace the mock line with `export const api: BootQuestApi = createHttpApi('/api');`
// (and add the /api proxy in vite.config.ts). Nothing else in the app imports mock.ts.

import { mockApi } from './mock';
import type { BootQuestApi } from './types';
// import { createHttpApi } from './http';

export type * from './types';
export const api: BootQuestApi = mockApi;
export const API_MODE: 'mock' | 'http' = 'mock';
