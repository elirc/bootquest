// f52 wave B (app ruling 1): progressive hints in the code pane, between the toolbar and the results.
//
//   needs-fail   a muted line: hints open after one failed Submit
//   available    one button; taking a hint needs no confirm (the button itself states the cost)
//   exhausted    the taken hints stay, plus where to go next (Reveal, 0 XP)
//   total 0 / not-hintable / locked / an unreadable state: nothing at all
//
// The server owns every rule (GET /units/:id/hints); a refused POST (the state moved under the
// button) is not an error for the learner: the bar just re-reads the state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context';
import type { HintsResponse } from '../../api/types';
import { InlineProse } from '../../lib/prose';

/** percent of the pass XP left after one more hint (server: 25% per hint, floor 50%) */
export const xpPctAfterNextHint = (h: Pick<HintsResponse, 'xpPct'>): number => Math.max(50, h.xpPct - 25);

/** "(75% · 1 hint)": what a hinted pass says beside its XP; '' for an unhinted one */
export function hintedXpNote(h: Pick<HintsResponse, 'xpPct' | 'taken'> | null): string {
  if (!h || h.taken.length === 0) return '';
  return `(${h.xpPct}% · ${h.taken.length} hint${h.taken.length === 1 ? '' : 's'})`;
}

export function HintBar({
  unitId,
  refreshKey,
  onState,
}: {
  unitId: number;
  /** bump to re-read the state (every recorded submit can open or close the next hint) */
  refreshKey: number;
  /** the latest state the bar holds (null while unknown) */
  onState?: (h: HintsResponse | null) => void;
}) {
  const api = useApi();
  const [hints, setHints] = useState<HintsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const seq = useRef(0);
  const report = useRef(onState);
  report.current = onState;

  const apply = useCallback((h: HintsResponse | null) => {
    setHints(h);
    report.current?.(h);
  }, []);

  const load = useCallback(() => {
    const mine = ++seq.current;
    return api.getHints(unitId).then(
      (h) => {
        if (live.current && seq.current === mine) apply(h);
      },
      () => {
        // an unreadable hint state shows nothing; it never blocks the drill
        if (live.current && seq.current === mine) apply(null);
      },
    );
  }, [api, unitId, apply]);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load, refreshKey]);

  const take = async () => {
    if (busy) return;
    setBusy(true);
    const mine = ++seq.current;
    try {
      const r = await api.takeHint(unitId);
      const { hint: _served, ...state } = r;
      if (live.current && seq.current === mine) apply(state);
    } catch {
      // refused (already passed, nothing left, no failed submit on record…): show what is true now
      await load();
    } finally {
      if (live.current) setBusy(false);
    }
  };

  if (!hints || hints.total === 0) return null;
  const reason = hints.lockedReason;
  if (reason === 'not-hintable' || reason === 'locked') return null;
  const taken = hints.taken;
  // a passed unit keeps the hints that were taken on the way, and offers nothing more
  if (reason === 'passed' && taken.length === 0) return null;
  return (
    <div className="hint-bar" data-testid="hint-bar" data-state={hints.nextAvailable ? 'available' : (reason ?? 'available')} aria-live="polite">
      {taken.length > 0 && (
        <ol className="hint-list" data-testid="hint-list" aria-label="Hints taken">
          {taken.map((t, i) => (
            <li key={i}>
              <InlineProse text={t} />
            </li>
          ))}
        </ol>
      )}
      {hints.nextAvailable ? (
        <button type="button" className="btn btn-sm" onClick={() => void take()} disabled={busy} data-testid="hint-take">
          Show hint {taken.length + 1} of {hints.total} · pass XP drops to {xpPctAfterNextHint(hints)}%
        </button>
      ) : reason === 'needs-fail' ? (
        <p className="muted small" data-testid="hint-needs-fail">
          Hints unlock after one failed Submit. Run doesn&apos;t count; a failed Submit costs nothing.
        </p>
      ) : reason === 'exhausted' ? (
        <p className="muted small" data-testid="hint-exhausted">
          No more hints. Reveal solution is the last resort (0 XP).
        </p>
      ) : null}
    </div>
  );
}
