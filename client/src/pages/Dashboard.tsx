import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import type { CompetencyRow, Dashboard as DashboardData, SlateItem, TrackId } from '../api/types';
import { Heatmap } from '../components/Heatmap';
import { Icon } from '../components/Icon';
import { Kbd, LoadState, PageHeader, Panel, ProgressBar, RatingPips } from '../components/ui';
import { fmtInt, fmtRelative } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { FREEZE_TOKENS_MAX, TRACK_LABEL, dayOfMs, isTrackId } from '../lib/view';

export function DashboardPage() {
  const api = useApi();
  const q = useAsync(() => api.getDashboard(), [api]);
  return (
    <>
      <PageHeader
        eyebrow={q.data ? new Date(`${q.data.today}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : ' '}
        title="Dashboard"
      />
      {q.status === 'ready' ? <DashboardBody d={q.data} /> : <LoadState error={q.error} onRetry={q.reload} minHeight={720} />}
    </>
  );
}

function DashboardBody({ d }: { d: DashboardData }) {
  const items = d.slate.items;
  const slateDone = items.filter((s) => s.done).length;
  // No xpToday on the wire (W-7): today's heatmap row is the server's own number for it.
  const xpToday = d.heatmap.find((h) => h.day === d.today)?.xp ?? 0;
  const tokens = Math.min(d.streak.tokens, FREEZE_TOKENS_MAX);
  return (
    <div className="dash">
      <div className="tiles">
        <section className="tile" aria-labelledby="t-streak">
          <h2 className="tile-label" id="t-streak">
            <Icon name="flame" /> Streak
          </h2>
          <div className="tile-value">
            {d.streak.current}
            <span className="tile-unit">days</span>
          </div>
          <div className="tile-meta">
            <span className="freeze" aria-label={`${d.streak.tokens} of ${FREEZE_TOKENS_MAX} freeze tokens banked`}>
              {Array.from({ length: FREEZE_TOKENS_MAX }, (_, i) => (
                <span key={i} className={`freeze-token${i < tokens ? ' freeze-on' : ''}`}>
                  <Icon name="snow" size={14} />
                </span>
              ))}
            </span>
            <span title="Slate-days banked toward the next freeze token">
              {d.streak.slateDaysBanked} banked · best {d.streak.longest}
            </span>
          </div>
        </section>

        <section className="tile" aria-labelledby="t-level">
          <h2 className="tile-label" id="t-level">
            <Icon name="bolt" /> Level
          </h2>
          <div className="tile-value">
            {d.xp.level}
            <span className="tile-unit">{fmtInt(d.xp.total)} XP</span>
          </div>
          <ProgressBar value={d.xp.intoLevel} max={d.xp.levelSpan} label={`Progress to level ${d.xp.level + 1}`} />
          <div className="tile-meta">
            <span>
              {fmtInt(d.xp.intoLevel)} / {fmtInt(d.xp.levelSpan)} to L{d.xp.level + 1}
            </span>
            <span className="pos">+{xpToday} today</span>
          </div>
        </section>

        <section className="tile" aria-labelledby="t-review">
          <h2 className="tile-label" id="t-review">
            <Icon name="cards" /> Review queue
          </h2>
          <div className="tile-value">
            {d.reviewQueue.due}
            <span className="tile-unit">due</span>
          </div>
          <div className="tile-meta">
            {d.reviewQueue.due > 0 ? (
              <Link to="/review" className="btn btn-sm btn-primary">
                Start review <Kbd>g</Kbd>
                <Kbd>r</Kbd>
              </Link>
            ) : (
              <span className="pos">Queue clear</span>
            )}
          </div>
        </section>

        <section className="tile" aria-labelledby="t-slate">
          <h2 className="tile-label" id="t-slate">
            <Icon name="check" /> Today's slate
          </h2>
          <div className="tile-value">
            {slateDone}
            <span className="tile-unit">/ {items.length} cleared</span>
          </div>
          <ProgressBar value={slateDone} max={items.length} label="Slate items cleared" tone="success" />
          <div className="tile-meta">
            <span>{d.streak.todayComplete ? 'Slate complete — today counts' : 'Clear the slate (or earn 20 XP) to keep the streak'}</span>
          </div>
        </section>
      </div>

      <div className="dash-row">
        <Panel title="Activity" labelledBy="p-activity" className="dash-heat" aside={<span className="muted">last {d.heatmap.length} days</span>}>
          <Heatmap days={d.heatmap} today={d.today} />
        </Panel>
        <Panel title="Today's slate" labelledBy="p-slate" className="dash-slate">
          <ul className="slate">
            {items.map((s) => (
              <SlateRow key={s.slot} s={s} />
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Competencies" labelledBy="p-comp" aside={<span className="muted">rated 1–5 · never averaged · promotion legs land in W6</span>}>
        <CompetencyTable rows={d.competencies} today={d.today} />
      </Panel>

      <Panel title="Next up" labelledBy="p-next">
        <ul className="nextup">
          {d.nextUp.map((n) => (
            <li key={n.trackId}>
              {n.unit ? (
                <Link to={`/play/${n.unit.id}`} className="nextup-card">
                  <span className={`track-badge track-${n.trackId}`}>{TRACK_LABEL[n.trackId]}</span>
                  <span className="nextup-title">{n.unit.title}</span>
                  <span className="nextup-meta">{n.unit.kind}</span>
                </Link>
              ) : (
                <div className="nextup-card nextup-locked" aria-disabled="true">
                  <span className="track-badge">{TRACK_LABEL[n.trackId]}</span>
                  <span className="nextup-title">Nothing available</span>
                  <span className="nextup-meta">locked, or every unit is done</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function slateView(s: SlateItem): { label: string; href: string } {
  switch (s.kind) {
    case 'drill-set': {
      const track = s.track && isTrackId(s.track) ? (s.track as TrackId) : null;
      const label = `${track ? TRACK_LABEL[track] : (s.track ?? '')} drill set${s.size ? ` (${s.size} drills)` : ''}`.trim();
      return { label, href: track ? `/campaign/${track}` : '/campaign' };
    }
    case 'campaign-step':
      return { label: 'Campaign step', href: '/campaign' };
    case 'review-clear':
      return { label: 'Clear the review queue', href: '/review' };
  }
}

function SlateRow({ s }: { s: SlateItem }) {
  const { label, href } = slateView(s);
  return (
    <li className={`slate-row${s.done ? ' slate-done' : ''}`} data-slot={s.slot}>
      <span className={`slate-check${s.done ? ' on' : ''}`} aria-hidden="true">
        {s.done && <Icon name="check" size={12} />}
      </span>
      <Link to={href} className="slate-label">
        {label}
        <span className="sr-only">{s.done ? ' (done)' : ' (open)'}</span>
      </Link>
      <span className="slate-count" aria-hidden="true">
        {s.done ? 'done' : 'open'}
      </span>
    </li>
  );
}

export function CompetencyTable({ rows, today }: { rows: CompetencyRow[]; today: string }) {
  return (
    <div className="table-wrap">
      <table className="table comp-table">
        <thead>
          <tr>
            <th scope="col">Competency</th>
            <th scope="col">Rating</th>
            <th scope="col">Last evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-competency={r.id}>
              <th scope="row">{r.name}</th>
              <td>
                <RatingPips rating={r.rating} />
              </td>
              <td className="evidence-cell">
                {r.lastEvidence ? (
                  <Link to={`/stats#evidence-${r.lastEvidence.id}`} className="evidence-link">
                    <span className="evidence-summary">
                      {r.lastEvidence.kind} · #{r.lastEvidence.id}
                    </span>
                    <span className="evidence-meta">{fmtRelative(today, dayOfMs(r.lastEvidence.createdAt))}</span>
                  </Link>
                ) : (
                  <span className="evidence-missing">
                    <Icon name="warn" size={14} /> Evidence missing
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
