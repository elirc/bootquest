import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import type { AltSetDueDto, RetestListItemDto } from '../api/types';
import { fmtShortDate, fmtWhen, plural } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { Chip, LoadState, Panel } from './ui';

/** Due first (oldest opening first), then the upcoming ones by opening time. */
const byUrgency = (a: RetestListItemDto, b: RetestListItemDto) => Number(b.due) - Number(a.due) || a.dueAt - b.dueAt;

/**
 * Dashboard "Due now" (fix/client-dash; ab wave S3): what is due that the review queue does not
 * hold, from GET /due — the changed-example retests (promotion leg c) and the alternate
 * explain-back sets whose 2-day rotation gap has passed. Open retests first, then the open
 * alternate sets, then the retests that open later. Fetches on its own, so its Retry reloads
 * this panel alone and never the rest of the dashboard.
 */
export function DueNowPanel() {
  const api = useApi();
  const q = useAsync(() => api.getDue(), [api]);
  const retests = [...(q.data?.retests ?? [])].sort(byUrgency);
  const altSets = q.data?.altSets ?? [];
  const openRetests = retests.filter((r) => r.due);
  const later = retests.filter((r) => !r.due);
  const hot = openRetests.length + altSets.length > 0;
  const nextAlt = q.data?.nextAltSetAt ?? null;
  return (
    <Panel
      title={
        <>
          Due now
          {openRetests.length > 0 && <span className="due-count"> · {plural(openRetests.length, 'retest')} open</span>}
          {altSets.length > 0 && <span className="due-count"> · {plural(altSets.length, 'alternate set')} open</span>}
        </>
      }
      labelledBy="p-due"
      className={`due-now${hot ? ' due-now-hot' : ''}`}
      aside={<span className="muted small">retests and alternate sets are not in the review queue</span>}
    >
      <div data-testid="due-now">
        {q.status !== 'ready' ? (
          // an error (with Retry), or the reload that Retry started: never "nothing due" while unknown
          <LoadState error={q.error} onRetry={q.reload} minHeight={64} />
        ) : retests.length === 0 && altSets.length === 0 ? (
          <p className="muted small due-empty" data-testid="due-empty">
            Nothing due. A passing explain-back (≥80% coverage) on an artifact with a seeded changed example schedules a retest at least 2 days later; units without a seeded variation rotate alternate question sets instead, and an alternate set is listed here once 2 days have passed since you answered a set of its group.
            {nextAlt !== null && <> The next alternate set opens {fmtWhen(nextAlt)}.</>}
          </p>
        ) : (
          <>
            <ul className="due-list">
              {openRetests.map((r) => (
                <RetestRow key={`r${r.reviewItemId}`} r={r} />
              ))}
              {altSets.map((a) => (
                <AltSetRow key={`a${a.unitId}`} a={a} />
              ))}
              {later.map((r) => (
                <RetestRow key={`r${r.reviewItemId}`} r={r} />
              ))}
            </ul>
            {nextAlt !== null && (
              <p className="muted small due-next" data-testid="due-next-alt">
                Next alternate set opens {fmtWhen(nextAlt)}.
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function RetestRow({ r }: { r: RetestListItemDto }) {
  return (
    <li className={`due-row${r.due ? ' due-row-open' : ''}`} data-retest={r.unitId} data-due={r.due}>
      {r.due ? <Chip tone="accent">open now</Chip> : <Chip tone="info">opens {fmtShortDate(r.dueAt)}</Chip>}
      <Link to={`/play/${r.unitId}`} className="due-title">
        {r.due ? 'Take the retest: ' : 'Retest: '}
        {r.title}
      </Link>
      <span className="due-meta muted small">
        {r.due ? `opened ${fmtWhen(r.dueAt)}` : `opens ${fmtWhen(r.dueAt)}`} · changed example of{' '}
        <Link to={`/play/${r.artifactUnitId}`}>artifact unit #{r.artifactUnitId}</Link> · solo, no help
      </span>
    </li>
  );
}

function AltSetRow({ a }: { a: AltSetDueDto }) {
  return (
    <li className="due-row due-row-open" data-altset={a.unitId}>
      <Chip tone="accent">open now</Chip>
      <Link to={`/play/${a.unitId}`} className="due-title">
        Alternate set: {a.title}
      </Link>
      <span className="due-meta muted small">
        set {a.label} · opened {fmtWhen(a.openedAt)} · fresh questions on material you explained at least 2 days ago · answer before you look
      </span>
    </li>
  );
}
