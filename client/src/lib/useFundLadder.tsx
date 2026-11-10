// f52 wave B (app ruling 4): ONE read of a track's Fundamentals ladder per player page, shared by
// the course rail (under the header) and the next step (after a pass). The player re-reads it after
// every recorded submit, so both reflect the pass that just landed.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../api/context';
import type { FundamentalsResponseExt, TrackId } from '../api/types';

export interface FundLadderState {
  track: TrackId | null;
  /** the last ladder read; null before the first read lands, when it failed, or without a track */
  ladder: FundamentalsResponseExt | null;
  /** the first read has finished (either way) */
  settled: boolean;
  /** a read is in flight */
  loading: boolean;
  /** read again (after a submit); a failed re-read keeps the previous ladder */
  refresh: () => void;
}

export function useFundLadder(track: TrackId | null): FundLadderState {
  const api = useApi();
  const [state, setState] = useState<{ track: TrackId | null; ladder: FundamentalsResponseExt | null; settled: boolean; loading: boolean }>({
    track,
    ladder: null,
    settled: track === null,
    loading: track !== null,
  });
  const seq = useRef(0);
  const live = useRef(true);

  const load = useCallback(() => {
    if (track === null) return;
    const mine = ++seq.current;
    setState((s) => (s.track === track ? { ...s, loading: true } : { track, ladder: null, settled: false, loading: true }));
    api.getFundamentals(track).then(
      (ladder) => {
        if (live.current && seq.current === mine) setState({ track, ladder, settled: true, loading: false });
      },
      () => {
        // a ladder that cannot be read is never an error for the learner: consumers fall back
        if (live.current && seq.current === mine) setState((s) => ({ ...s, settled: true, loading: false }));
      },
    );
  }, [api, track]);

  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);

  // a state left over from another track is never served
  const current = state.track === track ? state : { track, ladder: null, settled: track === null, loading: track !== null };
  return useMemo(
    () => ({ track, ladder: current.ladder, settled: current.settled, loading: current.loading, refresh: load }),
    [track, current.ladder, current.settled, current.loading, load],
  );
}

const FundLadderContext = createContext<FundLadderState | null>(null);

/** Reads the ladder of `track` once for everything below it (no track: nothing is read). */
export function FundLadderProvider({ track, children }: { track: TrackId | null; children: ReactNode }) {
  const state = useFundLadder(track);
  return <FundLadderContext.Provider value={state}>{children}</FundLadderContext.Provider>;
}

/** The shared ladder of the player page, or null outside one. */
export function useSharedFundLadder(): FundLadderState | null {
  return useContext(FundLadderContext);
}

const NOOP = (): void => undefined;
/** `refresh` of the shared ladder (a no-op outside a player page or off the ladder). */
export function useFundLadderRefresh(): () => void {
  return useContext(FundLadderContext)?.refresh ?? NOOP;
}
