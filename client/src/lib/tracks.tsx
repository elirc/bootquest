// W9 (ui-audit #4): ONE GET /tracks per app mount, shared by the sidebar and the campaign tabs
// (they used to fire two concurrent copies of the slowest read endpoint).
// Campaign 2 B2 (ui-audit #26): after each in-app navigation the list is re-read SILENTLY (the last
// good list stays on screen, no skeleton, no layout shift), so the sidebar % follows a quest the
// learner just cleared instead of staying at its mount-time value.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useApi } from '../api/context';
import type { TracksResponse } from '../api/types';
import { useAsync, type AsyncState } from './useAsync';

type TracksState = AsyncState<TracksResponse> & { reload: () => void };

const TracksContext = createContext<TracksState | null>(null);

export function TracksProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { pathname } = useLocation();
  const tracks = useAsync(() => api.getTracks(), [api]);
  const [fresh, setFresh] = useState<TracksResponse | null>(null);
  const mounted = useRef(false);

  // a (re)load supersedes any earlier silent refresh
  useEffect(() => setFresh(null), [tracks.data]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    let live = true;
    api.getTracks().then(
      (d) => live && setFresh(d),
      () => undefined, // a failed silent refresh keeps the last good list
    );
    return () => {
      live = false;
    };
  }, [api, pathname]);

  const value: TracksState = tracks.status === 'ready' && fresh ? { ...tracks, data: fresh } : tracks;
  return <TracksContext.Provider value={value}>{children}</TracksContext.Provider>;
}

/** The shared tracks request (must be under <TracksProvider>, which AppShell mounts). */
export function useTracks(): TracksState {
  const v = useContext(TracksContext);
  if (!v) throw new Error('useTracks() outside <TracksProvider>');
  return v;
}
