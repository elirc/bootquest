// W9 (ui-audit #4): ONE GET /tracks per app mount, shared by the sidebar and the campaign tabs
// (they used to fire two concurrent copies of the slowest read endpoint).
// W10: the counts and lock state go stale after progress, so the provider also exposes
// refresh(): a BACKGROUND re-read (stale-while-revalidate). The rows already on screen stay
// until the new response replaces them in place: no placeholder flash, no layout shift.
// Requests never overlap: a refresh() while one is in flight queues exactly one follow-up
// (the in-flight read may predate the change that asked for it); refresh({ join: true })
// instead shares the in-flight read (for "make sure it is fresh" callers such as a page mount).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../api/context';
import type { TracksResponse } from '../api/types';
import type { AsyncState } from './useAsync';

export type RefreshOptions = { join?: boolean };

type TracksState = AsyncState<TracksResponse> & {
  /** Retry after an error (shows the placeholder rows again while it loads). */
  reload: () => void;
  /** Re-read /tracks in the background, keeping the current rows until the answer lands. */
  refresh: (opts?: RefreshOptions) => void;
};

const TracksContext = createContext<TracksState | null>(null);

const LOADING: AsyncState<TracksResponse> = { status: 'loading', data: undefined, error: undefined };

export function TracksProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [state, setState] = useState<AsyncState<TracksResponse>>(LOADING);
  const live = useRef(true);
  const inflight = useRef(false);
  const again = useRef(false);
  const fetchRef = useRef<() => void>(() => undefined);

  fetchRef.current = () => {
    inflight.current = true;
    api
      .getTracks()
      .then(
        (data) => {
          if (live.current) setState({ status: 'ready', data, error: undefined });
        },
        (err: unknown) => {
          // a failed BACKGROUND refresh keeps the rows the learner already sees
          if (live.current)
            setState((s) => (s.status === 'ready' ? s : { status: 'error', data: undefined, error: err instanceof Error ? err : new Error(String(err)) }));
        },
      )
      .finally(() => {
        inflight.current = false;
        if (again.current && live.current) {
          again.current = false;
          fetchRef.current();
        }
      });
  };

  const refresh = useCallback((opts?: RefreshOptions) => {
    if (inflight.current) {
      if (!opts?.join) again.current = true;
      return;
    }
    fetchRef.current();
  }, []);

  const reload = useCallback(() => {
    setState((s) => (s.status === 'error' ? LOADING : s));
    refresh({ join: true });
  }, [refresh]);

  useEffect(() => {
    live.current = true;
    // join: React StrictMode re-runs this effect; the first read is still the fresh one
    refresh({ join: true });
    return () => {
      live.current = false;
    };
  }, [api, refresh]);

  return <TracksContext.Provider value={{ ...state, reload, refresh }}>{children}</TracksContext.Provider>;
}

/** The shared tracks request (must be under <TracksProvider>, which AppShell mounts). */
export function useTracks(): TracksState {
  const v = useContext(TracksContext);
  if (!v) throw new Error('useTracks() outside <TracksProvider>');
  return v;
}

const noop = () => undefined;

/**
 * refresh() for panes that record progress. Outside a provider (a pane rendered on its own)
 * it is a no-op, so a pane does not have to know whether the sidebar is mounted.
 */
export function useTracksRefresh(): (opts?: RefreshOptions) => void {
  return useContext(TracksContext)?.refresh ?? noop;
}
