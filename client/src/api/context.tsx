import { createContext, useContext, type ReactNode } from 'react';
import { api as defaultApi } from './client';
import type { BootQuestApi } from './types';

const ApiContext = createContext<BootQuestApi>(defaultApi);

/** Tests inject a fresh `createMockApi()`; the app uses the instance chosen in ./client.ts. */
export function ApiProvider({ api, children }: { api?: BootQuestApi; children: ReactNode }) {
  return <ApiContext.Provider value={api ?? defaultApi}>{children}</ApiContext.Provider>;
}

export const useApi = (): BootQuestApi => useContext(ApiContext);
