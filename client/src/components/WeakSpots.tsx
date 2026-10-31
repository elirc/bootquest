import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApi } from '../api/context';
import type { WeakGroupDto, WeakSignalKind, WeakSpotsResponse } from '../api/types';
import { fmtRelative, plural } from '../lib/format';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { TRACK_LABEL, TRACK_SHORT } from '../lib/view';
import { Chip, LoadState, Panel } from './ui';
import '../styles/weakspots.css';

/**
 * ab wave S3: "Weak spots" (GET /stats/weak). Everything listed is already released to the
 * learner (the server only lists a missed question once its review card is due, and key points
 * the learner marked missed after reading the key), so this view can quote what it lists.
 *   WeakSpotsPanel   the Stats page panel: every listed group (the server caps the list)
 *   WeakSpotsTeaser  the dashboard teaser: the top 3 (newest example each), rendered ONLY when there is data (an empty
 *                    "no weak spots" on day one would be false reassurance, council C1)
 */

export const TEASER_GROUPS = 3;

const KIND_LABEL: Record<WeakSignalKind, string> = {
  'quiz-miss': 'missed question',
  again: 'Again',
  fail: 'failed submit',
  'eb-missed': 'missed key point',
};

/** "2 missed questions · 1 Again · 3 failed submits" (only the non-zero sources, fixed order). */
export function sourceSummary(g: WeakGroupDto): string {
  const parts: string[] = [];
  if (g.bySource.quizMiss) parts.push(plural(g.bySource.quizMiss, 'missed question'));
  if (g.bySource.again) parts.push(plural(g.bySource.again, 'Again grade'));
  if (g.bySource.fail) parts.push(plural(g.bySource.fail, 'failed submit'));
  if (g.bySource.ebMissed) parts.push(plural(g.bySource.ebMissed, 'missed key point'));
  return parts.join(' · ');
}

function WeakGroupRow({ g, today, maxExamples }: { g: WeakGroupDto; today: string; maxExamples: number }) {
  return (
    <li className="weak-row" data-weak-group={g.group}>
      <div className="weak-head">
        <span className={`track-badge track-${g.trackId}`} title={TRACK_LABEL[g.trackId]}>
          {TRACK_SHORT[g.trackId]}
        </span>
        <span className="weak-name">{g.group}</span>
        <span className="weak-meta muted small">
          {sourceSummary(g)} · last {fmtRelative(today, g.lastAt)}
        </span>
      </div>
      {maxExamples > 0 && g.examples.length > 0 && (
        <ul className="weak-examples">
          {g.examples.slice(0, maxExamples).map((e) => (
            <li key={`${e.kind}:${e.unitId}:${e.ref ?? ''}`} data-weak-kind={e.kind}>
              <Chip tone={e.kind === 'fail' ? 'warning' : 'info'}>{KIND_LABEL[e.kind]}</Chip>{' '}
              <Link to={`/play/${e.unitId}`}>{e.label ?? e.unitTitle}</Link>
              {e.label !== null && <span className="muted small"> · {e.unitTitle}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function WeakSpotsList({ data, limit, maxExamples = Infinity }: { data: WeakSpotsResponse; limit?: number; maxExamples?: number }) {
  const groups = limit === undefined ? data.groups : data.groups.slice(0, limit);
  return (
    <ul className="weak-list">
      {groups.map((g) => (
        <WeakGroupRow key={g.group} g={g} today={data.today} maxExamples={maxExamples} />
      ))}
    </ul>
  );
}

/** Stats page panel (the page starts the request with its other panels, so the grid lays out once). */
export function WeakSpotsPanel({ q }: { q: AsyncState<WeakSpotsResponse> & { reload: () => void } }) {
  const more = q.data ? q.data.totalGroups - q.data.groups.length : 0;
  // the dashboard teaser links here (/stats#weak-spots): bring the panel into view once it is laid out
  const { hash } = useLocation();
  const ref = useRef<HTMLElement>(null);
  const ready = q.status === 'ready';
  useEffect(() => {
    if (hash === '#weak-spots' && ready) ref.current?.scrollIntoView?.({ block: 'start' });
  }, [hash, ready]);
  return (
    <section ref={ref} className="panel span-all weak-spots" aria-labelledby="p-weak" id="weak-spots">
      <header className="panel-head">
        <h2 className="panel-title" id="p-weak">
          Weak spots
        </h2>
        <div className="panel-aside">
          <span className="muted small">recent misses count more · only what you have already seen the answer to</span>
        </div>
      </header>
      <div data-testid="weak-spots">
        {q.status !== 'ready' ? (
          <LoadState error={q.error} onRetry={q.reload} minHeight={120} />
        ) : q.data.groups.length === 0 ? (
          <p className="muted small" data-testid="weak-empty">
            Nothing collected yet. Missed quiz questions (once their review card is due), Again grades in Review, failed drill submits you have not passed since, and explain-back key points you marked missed gather here, grouped by repo or drill module.
          </p>
        ) : (
          <>
            <WeakSpotsList data={q.data} />
            {more > 0 && <p className="muted small">{plural(more, 'more group')} with fewer recent misses not shown.</p>}
          </>
        )}
      </div>
    </section>
  );
}

/** Dashboard teaser: nothing at all while loading, on an error, or when there is no data. */
export function WeakSpotsTeaser() {
  const api = useApi();
  const q = useAsync(() => api.getWeakSpots(), [api]);
  if (q.status !== 'ready' || q.data.groups.length === 0) return null;
  return (
    <Panel
      title="Weak spots"
      labelledBy="p-weak-teaser"
      className="weak-teaser"
      aside={
        <Link to="/stats#weak-spots" className="small">
          All weak spots <span aria-hidden="true">→</span>
        </Link>
      }
    >
      <div data-testid="weak-teaser">
        <WeakSpotsList data={q.data} limit={TEASER_GROUPS} maxExamples={1} />
      </div>
    </Panel>
  );
}
