// W9 (ui-audit #4): ONE GET /tracks per app mount, shared by the sidebar and the campaign tabs
// (they used to fire two concurrent copies of the slowest read endpoint).
// Campaign 2 B2 (ui-audit #26): the sidebar % must follow a quest the learner just cleared. GET /tracks
// is the slowest read (campaign state over every quest + every unit row), so it is NOT re-read on every
// navigation: a successful progress-changing mutation (submit, self-attest, explain-back / kata self-score,
// review grade) marks the list stale, and the NEXT navigation re-reads it SILENTLY (the last good list
// stays on screen, no skeleton, no layout shift). Navigations without progress cost no request.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiProvider, useApi } from '../api/context';
import type { BootQuestApi, TracksResponse } from '../api/types';
import { useAsync, type AsyncState } from './useAsync';

type TracksState = AsyncState<TracksResponse> & { reload: () => void };

const TracksContext = createContext<TracksState | null>(null);

/** The mutations whose success can change a track's progress (core quests done / practice units done). */
export const PROGRESS_MUTATIONS = ['submitUnit', 'selfAttest', 'selfScoreExplainBack', 'selfScoreKata', 'gradeReview'] as const satisfies readonly (keyof BootQuestApi)[];

/** `api` with every progress mutation calling `onProgress` after it SUCCEEDS (a rejected call signals nothing). */
export function withProgressSignal(api: BootQuestApi, onProgress: () => void): BootQuestApi {
  const out: BootQuestApi = { ...api };
  for (const m of PROGRESS_MUTATIONS) {
    const fn = api[m] as (...a: unknown[]) => Promise<unknown>;
    (out as unknown as Record<string, unknown>)[m] = async (...a: unknown[]) => {
      const r = await fn(...a);
      onProgress();
      return r;
    };
  }
  return out;
}

export function TracksProvider({ children }: { children: ReactNode }) {
  const base = useApi();
  const { pathname } = useLocation();
  const stale = useRef(false);
  const api = useMemo(() => withProgressSignal(base, () => (stale.current = true)), [base]);
  const tracks = useAsync(() => api.getTracks(), [api]);
  const [fresh, setFresh] = useState<TracksResponse | null>(null);

  // a (re)load supersedes any earlier silent refresh
  useEffect(() => setFresh(null), [tracks.data]);

  useEffect(() => {
    if (!stale.current) return; // nothing changed progress since the last read: no request
    stale.current = false;
    let live = true;
    api.getTracks().then(
      (d) => live && setFresh(d),
      () => {
        stale.current = true; // a failed silent refresh keeps the last good list and retries on the next navigation
      },
    );
    return () => {
      live = false;
    };
  }, [api, pathname]);

  const value: TracksState = tracks.status === 'ready' && fresh ? { ...tracks, data: fresh } : tracks;
  return (
    <ApiProvider api={api}>
      <TracksContext.Provider value={value}>{children}</TracksContext.Provider>
    </ApiProvider>
  );
}

/** The shared tracks request (must be under <TracksProvider>, which AppShell mounts). */
export function useTracks(): TracksState {
  const v = useContext(TracksContext);
  if (!v) throw new Error('useTracks() outside <TracksProvider>');
  return v;
}
