// W9 (ui-audit #4): ONE GET /tracks per app mount, shared by the sidebar and the campaign tabs
// (they used to fire two concurrent copies of the slowest read endpoint).
import { createContext, useContext, type ReactNode } from 'react';
import { useApi } from '../api/context';
import type { TracksResponse } from '../api/types';
import { useAsync, type AsyncState } from './useAsync';

type TracksState = AsyncState<TracksResponse> & { reload: () => void };

const TracksContext = createContext<TracksState | null>(null);

export function TracksProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const tracks = useAsync(() => api.getTracks(), [api]);
  return <TracksContext.Provider value={tracks}>{children}</TracksContext.Provider>;
}

/** The shared tracks request (must be under <TracksProvider>, which AppShell mounts). */
export function useTracks(): TracksState {
  const v = useContext(TracksContext);
  if (!v) throw new Error('useTracks() outside <TracksProvider>');
  return v;
}
