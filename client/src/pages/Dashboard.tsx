import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import type { CompetencyRow, Dashboard as DashboardData, PromotionLegState, SlateItem, TrackId } from '../api/types';
import { Heatmap } from '../components/Heatmap';
import { Icon } from '../components/Icon';
import { Chip, Kbd, LoadState, PageHeader, Panel, ProgressBar, RatingPips } from '../components/ui';
import { fmtInt, fmtRelative, fmtShortDate } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const TRACK_LABEL: Record<TrackId, string> = { js: 'JS/TS', csharp: 'C#/.NET', agentic: 'Agentic', java: 'Java' };

export function DashboardPage() {
  const api = useApi();
  const q = useAsync(() => api.getDashboard(), [api]);
  return (
    <>
      <PageHeader
        eyebrow={q.data ? new Date(`${q.data.today}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : ' '}
        title="Dashboard"
      />
      {q.status === 'ready' ? <DashboardBody d={q.data} /> : <LoadState error={q.error} onRetry={q.reload} minHeight={720} />}
    </>
  );
}

function DashboardBody({ d }: { d: DashboardData }) {
  const slateDone = d.slate.filter((s) => s.done >= s.total).length;
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
            <span className="freeze" aria-label={`${d.streak.freezeTokens} of ${d.streak.freezeTokensMax} freeze tokens banked`}>
              {Array.from({ length: d.streak.freezeTokensMax }, (_, i) => (
                <span key={i} className={`freeze-token${i < d.streak.freezeTokens ? ' freeze-on' : ''}`}>
                  <Icon name="snow" size={14} />
                </span>
              ))}
            </span>
            <span title={`Next freeze token after ${d.streak.slateDaysToNextToken} more slate-days`}>
              +1 in {d.streak.slateDaysToNextToken}d · best {d.streak.longest}
            </span>
          </div>
        </section>

        <section className="tile" aria-labelledby="t-level">
          <h2 className="tile-label" id="t-level">
            <Icon name="bolt" /> Level
          </h2>
          <div className="tile-value">
            {d.level.level}
            <span className="tile-unit">{fmtInt(d.level.xpTotal)} XP</span>
          </div>
          <ProgressBar value={d.level.xpIntoLevel} max={d.level.xpLevelSpan} label={`Progress to level ${d.level.level + 1}`} />
          <div className="tile-meta">
            <span>
              {fmtInt(d.level.xpIntoLevel)} / {fmtInt(d.level.xpLevelSpan)} to L{d.level.level + 1}
            </span>
            <span className="pos">+{d.level.xpToday} today</span>
          </div>
        </section>

        <section className="tile" aria-labelledby="t-review">
          <h2 className="tile-label" id="t-review">
            <Icon name="cards" /> Review queue
          </h2>
          <div className="tile-value">
            {d.reviewDue}
            <span className="tile-unit">due</span>
          </div>
          <div className="tile-meta">
            {d.reviewDue > 0 ? (
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
            <span className="tile-unit">/ {d.slate.length} cleared</span>
          </div>
          <ProgressBar value={slateDone} max={d.slate.length} label="Slate items cleared" tone="success" />
          <div className="tile-meta">
            <span>{d.streak.todayCounts ? 'Today already counts for the streak' : 'Earn 20 XP to keep the streak'}</span>
          </div>
        </section>
      </div>

      <div className="dash-row">
        <Panel title="Activity" labelledBy="p-activity" className="dash-heat" aside={<span className="muted">last {d.heatmap.length} days</span>}>
          <Heatmap days={d.heatmap} today={d.today} />
        </Panel>
        <Panel title="Today's slate" labelledBy="p-slate" className="dash-slate">
          <ul className="slate">
            {d.slate.map((s) => (
              <SlateRow key={s.id} s={s} />
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Competencies"
        labelledBy="p-comp"
        aside={<span className="muted">rated 1–5 · never averaged · promotion = artifact + explain-back + retest</span>}
      >
        <CompetencyTable rows={d.competencies} today={d.today} />
      </Panel>

      <Panel title="Next up" labelledBy="p-next">
        <ul className="nextup">
          {d.nextUp.map((n) => (
            <li key={n.trackId}>
              <Link to={n.href} className="nextup-card">
                <span className={`track-badge track-${n.trackId}`}>{TRACK_LABEL[n.trackId]}</span>
                <span className="nextup-title">{n.title}</span>
                <span className="nextup-meta">
                  {n.actTitle} · {n.kind}
                </span>
              </Link>
            </li>
          ))}
          <li>
            <div className="nextup-card nextup-locked" aria-disabled="true">
              <span className="track-badge">Java</span>
              <span className="nextup-title">
                <Icon name="lock" size={14} /> Locked track
              </span>
              <span className="nextup-meta">Schema-ready; content after V1</span>
            </div>
          </li>
        </ul>
      </Panel>
    </div>
  );
}

function SlateRow({ s }: { s: SlateItem }) {
  const done = s.done >= s.total;
  return (
    <li className={`slate-row${done ? ' slate-done' : ''}`}>
      <span className={`slate-check${done ? ' on' : ''}`} aria-hidden="true">
        {done && <Icon name="check" size={12} />}
      </span>
      <Link to={s.href} className="slate-label">
        {s.label}
        <span className="sr-only">{done ? ' (done)' : ` (${s.done} of ${s.total})`}</span>
      </Link>
      <span className="slate-count" aria-hidden="true">
        {s.done}/{s.total}
      </span>
    </li>
  );
}

const LEG_TEXT: Record<PromotionLegState, string> = { done: 'done', pending: 'pending', scheduled: 'scheduled', failed: 'failed' };
const LEG_TONE: Record<PromotionLegState, string> = { done: 'success', pending: 'neutral', scheduled: 'info', failed: 'danger' };

function Leg({ name, state, detail }: { name: string; state: PromotionLegState; detail?: string | null }) {
  return (
    <Chip tone={LEG_TONE[state]}>
      <span className="leg-name">{name}</span> {detail ?? LEG_TEXT[state]}
    </Chip>
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
            <th scope="col">Promotion</th>
            <th scope="col">Last evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-competency={r.id}>
              <th scope="row">{r.label}</th>
              <td>
                <RatingPips rating={r.rating} target={r.promotion?.targetRating} />
              </td>
              <td>
                {r.promotion ? (
                  <span className="legs">
                    <Leg name="Artifact" state={r.promotion.artifact} />
                    <Leg
                      name="Explain"
                      state={r.promotion.explainBack}
                      detail={r.promotion.explainBackCoverage !== null ? `${Math.round(r.promotion.explainBackCoverage * 100)}%` : null}
                    />
                    <Leg
                      name="Retest"
                      state={r.promotion.retest}
                      detail={r.promotion.retestDueAt ? fmtShortDate(r.promotion.retestDueAt) : null}
                    />
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="evidence-cell">
                {r.lastEvidence ? (
                  <Link to={`/stats#evidence-${r.lastEvidence.id}`} className="evidence-link" title={r.lastEvidence.summary}>
                    <span className="evidence-summary">{r.lastEvidence.summary}</span>
                    <span className="evidence-meta">
                      {fmtRelative(today, r.lastEvidence.at)} · {r.lastEvidence.assessor}
                      {r.lastEvidence.assisted && <Chip tone="warning">assisted</Chip>}
                    </span>
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
