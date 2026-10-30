// The Campaign page's "Practice units" browser: every unit on a track (GET /api/tracks/:id/units),
// grouped by repo / module, filterable by title, repo and kind. Grouping and filtering are pure
// (lib/trackunits.ts); this file only renders them.
//
// Honesty: renders ONLY TrackUnitsResponse fields (title, kind, difficulty, state, revealed) and
// never fetches a unit's detail. A locked unit is never a link.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApi } from '../api/context';
import type { TrackId, UnitSummary } from '../api/types';
import { Icon } from '../components/Icon';
import { Chip, LoadState } from '../components/ui';
import { NO_FILTER, SECTION_LABEL, groupTotals, groupUnits, sectionCounts, type UnitFilter, type UnitSection } from '../lib/trackunits';
import { useAsync } from '../lib/useAsync';
import { useDebouncedValue } from '../lib/useDebouncedValue';

type Variant = 'primary' | 'secondary';

export function TrackUnitsSection({ trackId, variant }: { trackId: TrackId; variant: Variant }): JSX.Element {
  // keyed by track: switching tracks starts from a fresh fetch, cleared filters and (secondary) collapsed
  return <TrackUnitsBody key={trackId} trackId={trackId} variant={variant} />;
}

function TrackUnitsBody({ trackId, variant }: { trackId: TrackId; variant: Variant }) {
  const api = useApi();
  const res = useAsync(() => api.getTrackUnits(trackId), [api, trackId]);
  const headingId = useId();
  // `#units` (the dashboard's "Browse all" link) arrives with the browser already open
  const deepLinked = useLocation().hash === '#units';
  const [open, setOpen] = useState(deepLinked);
  const units = res.status === 'ready' ? res.data.units : undefined;
  const expanded = variant === 'primary' || open;
  const sectionRef = useRef<HTMLElement>(null);
  const arrived = useRef(false);
  const ready = res.status === 'ready';
  // the browser cannot jump to #units itself (the section renders after the campaign loads), and
  // its header is focused only once the units are there to read
  useEffect(() => {
    if (!deepLinked || !ready || arrived.current) return;
    arrived.current = true;
    const sec = sectionRef.current;
    if (!sec) return;
    sec.scrollIntoView?.({ block: 'start' });
    // the secondary header's toggle button, else the primary heading (tabIndex -1)
    (sec.querySelector<HTMLElement>('.tu-head button') ?? sec.querySelector<HTMLElement>('h2'))?.focus({ preventScroll: true });
  }, [deepLinked, ready]);

  return (
    <section className="track-units" id="units" ref={sectionRef} data-testid="track-units" aria-labelledby={headingId}>
      {variant === 'primary' ? (
        <h2 id={headingId} tabIndex={-1}>
          Practice units
        </h2>
      ) : (
        <h2 className="tu-head" id={headingId}>
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            Practice units{units ? ` (${units.length})` : ''}
          </button>
        </h2>
      )}
      {res.status !== 'ready' ? (
        // while COLLAPSED, a plain loading state must not flash a tall block under the header;
        // errors still render collapsed so the Retry affordance (and header count) can recover
        (expanded || res.status === 'error') && <LoadState error={res.error} onRetry={res.reload} minHeight={expanded ? 240 : undefined} />
      ) : (
        expanded && <UnitBrowser units={res.data.units} />
      )}
    </section>
  );
}

const SECTIONS: readonly (UnitSection | 'all')[] = ['all', 'drill', 'explain-back', 'other'];

function UnitBrowser({ units }: { units: UnitSummary[] }) {
  const [filter, setFilter] = useState<UnitFilter>(NO_FILTER);
  const groups = useMemo(() => groupUnits(units, filter), [units, filter]);
  const counts = useMemo(() => sectionCounts(units), [units]);
  // headers show each group's UNFILTERED done/total (so they agree with the count line below),
  // plus how many of the group are shown when a filter hides some
  const totals = useMemo(() => groupTotals(units), [units]);
  const done = useMemo(() => units.filter((u) => u.state === 'done').length, [units]);
  const shown = groups.reduce((n, g) => n + g.units.length, 0);
  const countText = `Showing ${shown} of ${units.length} units · ${done} done`;
  // the screen-reader announcement waits for a pause in typing (the visible line updates at once)
  const announced = useDebouncedValue(countText, 500);
  const set = (over: Partial<UnitFilter>) => setFilter((f) => ({ ...f, ...over }));

  if (units.length === 0) {
    return <p data-testid="track-units-empty">No practice units are seeded on this track yet.</p>;
  }

  return (
    <>
      <div className="tu-toolbar">
        <input
          type="search"
          className="tu-search"
          aria-label="Filter units"
          placeholder="Filter by title or repo…"
          value={filter.query}
          onChange={(e) => set({ query: e.target.value })}
        />
        <div className="tu-kinds" role="group" aria-label="Filter by kind">
          {SECTIONS.filter((s) => s !== 'other' || counts.other > 0).map((s) => (
            <button key={s} type="button" className="btn btn-sm" aria-pressed={filter.section === s} onClick={() => set({ section: s })}>
              {s === 'all' ? 'All' : SECTION_LABEL[s]} ({counts[s]})
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm" aria-pressed={filter.hideDone} onClick={() => set({ hideDone: !filter.hideDone })}>
          Hide done
        </button>
      </div>
      <p className="tu-count muted small" data-testid="track-units-count">
        {countText}
      </p>
      {/* the live region: filter results are announced once the count settles, not per keystroke */}
      <p className="sr-only" role="status" data-testid="track-units-status">
        {announced}
      </p>
      {groups.length === 0 ? (
        <div className="tu-nomatch" data-testid="track-units-nomatch">
          <p>No units match.</p>
          <button type="button" className="btn btn-sm" onClick={() => setFilter(NO_FILTER)}>
            Clear filters
          </button>
        </div>
      ) : (
        groups.map((g) => {
          const t = totals.get(g.label)!;
          return (
            <section className="tu-group" key={g.label}>
              <h3>
                {g.label}{' '}
                <span className="muted">{`${t.done}/${t.total} done${g.units.length < t.total ? ` · ${g.units.length} shown` : ''}`}</span>
              </h3>
              <ul className="tu-list">
                {g.units.map((u) => (
                  <li key={u.id}>
                    <UnitRow unit={u} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}

function UnitRow({ unit: u }: { unit: UnitSummary }) {
  const body = (
    <>
      <span className="tu-title">{u.title}</span>
      <span className="tu-chips">
        {u.state === 'done' && <Chip tone="success">done</Chip>}
        {u.revealed && <Chip>revealed</Chip>}
        {u.kind === 'drill' && u.difficulty !== null && <span className="tu-diff muted small">d{u.difficulty}</span>}
      </span>
    </>
  );
  if (u.state === 'locked') {
    return (
      <div className="tu-row" data-step data-state="locked" data-unit={u.id} tabIndex={-1} aria-disabled="true">
        <Icon name="lock" size={12} />
        {body}
        <span className="sr-only">, Locked</span>
      </div>
    );
  }
  return (
    <Link to={`/play/${u.id}`} className="tu-row" data-step data-state={u.state} data-unit={u.id}>
      {body}
    </Link>
  );
}
