import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import type {
  AttemptDetailResponse,
  CampaignProgressResponse,
  CheckType,
  CompetencyId,
  EvidenceRowDto,
  KataStatsResponse,
  PassRatesResponse,
  ReviewStatsResponse,
  XpStatsResponse,
} from '../api/types';
import { BarChart, DataTable, Legend, RateChart, ShareBar, type BarDatum, type ChartSeries } from '../components/StatsCharts';
import { Chip, LoadState, PageHeader, Panel, ProgressBar } from '../components/ui';
import { fmtRate, longDate, monthStarts, shortDate, weekdayLabel } from '../lib/chart';
import { fmtInt, fmtStamp } from '../lib/format';
import { buildHeatGrid } from '../lib/heatmap';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { COMPETENCY_IDS, COMPETENCY_LABEL, isCompetencyId, progressLabel, progressTitle, TRACK_LABEL } from '../lib/view';

// fix/client-dash: the competency list comes from lib/view (held to shared/src/enums.ts), not a re-list here
const COMPETENCIES: { id: CompetencyId; label: string }[] = COMPETENCY_IDS.map((id) => ({ id, label: COMPETENCY_LABEL[id] }));

/** One panel's request state, loaded by the page (release, UI-FINAL CLS leftover). */
type Loaded<T> = AsyncState<T> & { reload: () => void };

/**
 * Stats: tiles, XP over time, pass rates, review forecast + retention, campaign progress, G1 catch rate, evidence.
 *
 * Release (UI-FINAL leftover, CLS 0.0067 on /stats): every panel used to fetch on its own and grow from its skeleton
 * when its data landed, pushing the panels below it down one by one. The page now starts every panel request at once
 * and lays the panels out only when each has SETTLED (data or error), so the grid appears in its final shape; the
 * evidence list is the last block on the page, so its own load cannot push anything. A panel's Retry still reloads
 * that panel alone (an input-driven change, not a layout shift).
 */
export function StatsPage() {
  const api = useApi();
  const q = useAsync(() => api.getDashboard(), [api]);
  const xp = useAsync(() => api.getXpStats(), [api]);
  const rates = useAsync(() => api.getPassRates(), [api]);
  const reviews = useAsync(() => api.getReviewStats(), [api]);
  const campaign = useAsync(() => api.getCampaignProgress(), [api]);
  const katas = useAsync(() => api.getKataStats(), [api]);
  // settled once = laid out for good (a later Retry puts that one panel back into loading, in place)
  const [panelsSettled, setPanelsSettled] = useState(false);
  const allSettled = [xp, rates, reviews, campaign, katas].every((x) => x.status !== 'loading');
  if (allSettled && !panelsSettled) setPanelsSettled(true);
  const grid = q.data ? buildHeatGrid(q.data.heatmap, q.data.today) : null;
  const days = q.data?.heatmap ?? [];
  const slateDays = days.filter((d) => d.status === 'slate').length;

  return (
    <>
      <PageHeader eyebrow="Stats" title="Progress & evidence" />
      {q.status !== 'ready' || !grid || !panelsSettled ? (
        <LoadState error={q.error} onRetry={q.reload} minHeight={400} />
      ) : (
        <div className="stats">
          <div className="tiles">
            <div className="tile">
              <h2 className="tile-label">XP, last {days.length} days</h2>
              <div className="tile-value">{fmtInt(grid.totalXp)}</div>
            </div>
            <div className="tile">
              <h2 className="tile-label">Active days</h2>
              <div className="tile-value">
                {grid.activeDays}
                <span className="tile-unit">/ {days.length}</span>
              </div>
            </div>
            <div className="tile">
              <h2 className="tile-label">Slate days</h2>
              <div className="tile-value">{slateDays}</div>
            </div>
            <div className="tile">
              <h2 className="tile-label">Avg XP / active day</h2>
              <div className="tile-value">{grid.activeDays ? Math.round(grid.totalXp / grid.activeDays) : 0}</div>
            </div>
          </div>
          <div className="stats-grid">
            <XpPanel q={xp} />
            <PassRatePanel q={rates} />
            <ReviewPanel q={reviews} />
            <CampaignProgressPanel q={campaign} />
            <CatchRatePanel q={katas} />
            <EvidenceBrowser />
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- XP over time

/** Bottom-first stack order; colour follows the track (tokens), "no track" (review XP) is the neutral base. */
const XP_SERIES: readonly (ChartSeries & { id: keyof XpStatsResponse['days'][number]['byTrack'] })[] = [
  { id: 'none', label: 'Reviews & other', className: 'series-none' },
  { id: 'js', label: TRACK_LABEL.js, className: 'series-js' },
  { id: 'csharp', label: TRACK_LABEL.csharp, className: 'series-csharp' },
  { id: 'agentic', label: TRACK_LABEL.agentic, className: 'series-agentic' },
  { id: 'java', label: TRACK_LABEL.java, className: 'series-java' },
];

type XpRange = 'days' | 'weeks';

function XpPanel({ q }: { q: Loaded<XpStatsResponse> }) {
  const [range, setRange] = useState<XpRange>('days');
  return (
    <Panel
      title="XP over time"
      className="span-all"
      aside={
        <span className="seg" role="group" aria-label="XP range">
          {(
            [
              ['days', 'Last 90 days'],
              ['weeks', 'All time (weekly)'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={`seg-opt${range === id ? ' on' : ''}`} aria-pressed={range === id} onClick={() => setRange(id)}>
              {label}
            </button>
          ))}
        </span>
      }
    >
      {q.status !== 'ready' ? <LoadState error={q.error} onRetry={q.reload} minHeight={262} /> : <XpChart data={q.data} range={range} />}
    </Panel>
  );
}

function XpChart({ data, range }: { data: XpStatsResponse; range: XpRange }) {
  if (data.totals.allTime === 0) {
    return (
      <div className="chart-empty" data-testid="xp-empty">
        <p>No XP earned yet.</p>
        <p className="muted small">Bars appear after your first verified pass, reading self-attest or review.</p>
      </div>
    );
  }
  const weekly = range === 'weeks';
  const rows: BarDatum[] = weekly
    ? data.weeks.map((w) => ({ key: w.weekStart, label: `Week of ${longDate(w.weekStart)}`, values: w.byTrack }))
    : data.days.map((d) => ({ key: d.day, label: longDate(d.day), values: d.byTrack }));
  const used = XP_SERIES.filter((s) => rows.some((r) => (r.values[s.id] ?? 0) > 0));
  const total = weekly ? data.totals.allTime : data.totals.lastDays;
  const keys = rows.map((r) => r.key);
  const summary = weekly
    ? `Weekly XP since the week of ${longDate(keys[0]!)}: ${fmtInt(total)} XP across ${rows.length} week${rows.length === 1 ? '' : 's'}.`
    : `Daily XP, last ${rows.length} days: ${fmtInt(total)} XP on ${rows.filter((r) => Object.values(r.values).some((v) => v > 0)).length} active days.`;
  return (
    <div data-testid={`xp-chart-${range}`}>
      <p className="chart-sub muted small">
        {weekly ? (
          <>
            <span className="num">{fmtInt(total)}</span> XP all time, {rows.length} week{rows.length === 1 ? '' : 's'} (Monday starts)
          </>
        ) : (
          <>
            <span className="num">{fmtInt(total)}</span> XP in the last {rows.length} days · <span className="num">{fmtInt(data.totals.allTime)}</span> XP all time
          </>
        )}
      </p>
      {weekly || data.totals.lastDays > 0 ? (
        <BarChart data={rows} series={used} xLabels={monthStarts(keys, weekly)} unit="XP" summary={summary} highlightLast={false} />
      ) : (
        <div className="chart-empty" data-testid="xp-empty-window">
          <p>No XP in the last {rows.length} days.</p>
          <p className="muted small">Switch to all time to see earlier weeks.</p>
        </div>
      )}
      <Legend series={used} />
      <DataTable
        caption={summary}
        head={[weekly ? 'Week of' : 'Day', 'Total', ...used.map((s) => s.label)]}
        rows={rows
          .filter((r) => weekly || Object.values(r.values).some((v) => v > 0))
          .map((r) => [weekly ? longDate(r.key) : r.label, fmtInt(Object.values(r.values).reduce((a, b) => a + b, 0)), ...used.map((s) => fmtInt(r.values[s.id] ?? 0))])}
      />
    </div>
  );
}

// ---------------------------------------------------------------- pass rates

const CHECK_LABEL: Partial<Record<CheckType, string>> = {
  'drill-js': 'JS drills',
  'drill-cs': 'C# drills',
  'drill-java': 'Java drills',
  quiz: 'Quizzes',
  'predict-output': 'Predict output',
  'guided-step': 'Guided steps',
  http: 'HTTP labs',
  repo: 'Repo tasks',
  'study-quiz': 'Study quizzes',
  'node-test-file': 'Program units',
  'self-run': 'Self-run',
  'vitest-project': 'Vitest projects',
};

function PassRatePanel({ q }: { q: Loaded<PassRatesResponse> }) {
  return (
    <Panel title="Pass rates" className="span-2">
      {q.status !== 'ready' ? <LoadState error={q.error} onRetry={q.reload} minHeight={220} /> : <PassRates data={q.data} />}
    </Panel>
  );
}

function PassRates({ data }: { data: PassRatesResponse }) {
  if (data.overall.attempts === 0) {
    return (
      <div className="chart-empty" data-testid="pass-empty">
        <p>No graded attempts yet.</p>
        <p className="muted small">Rates appear after your first machine-checked submit.</p>
      </div>
    );
  }
  const o = data.overall;
  const trackRows = data.byTrack.map((r) => ({ key: r.trackId, label: TRACK_LABEL[r.trackId], ...r }));
  const typeRows = data.byCheckType.map((r) => ({ key: r.checkType, label: CHECK_LABEL[r.checkType] ?? r.checkType, ...r }));
  return (
    <div data-testid="pass-rates">
      <p className="chart-sub small">
        <span className="num">{fmtRate(o.passRate)}</span> of <span className="num">{fmtInt(o.attempts)}</span> graded submits passed ·{' '}
        <span className="num">{fmtRate(o.firstTryRate)}</span> of <span className="num">{fmtInt(o.units)}</span> units passed on the first try, solo
        {o.guidedPasses > 0 && (
          <span data-testid="pass-guided">
            {' '}
            · <span className="num">{fmtInt(o.guidedPasses)}</span> pass{o.guidedPasses === 1 ? '' : 'es'} after a reveal not counted
          </span>
        )}
      </p>
      <ul className="chart-legend" aria-label="Legend">
        <li>
          <svg width="10" height="10" aria-hidden="true">
            <rect className="series-pass" width="10" height="10" rx="2" />
          </svg>
          Pass rate (passes without a reveal / graded submits)
        </li>
        <li>
          <svg width="10" height="10" aria-hidden="true">
            <rect className="series-first" width="10" height="10" rx="2" />
          </svg>
          First try, solo (units / units tried)
        </li>
      </ul>
      <div className="rate-groups">
        <div>
          <h3 className="chart-h">By track</h3>
          <RateChart rows={trackRows} summary={`Pass rate by track: ${trackRows.map((r) => `${r.label} ${fmtRate(r.passRate)}`).join(', ')}.`} />
        </div>
        <div>
          <h3 className="chart-h">By check type</h3>
          <RateChart rows={typeRows} summary={`Pass rate by check type: ${typeRows.map((r) => `${r.label} ${fmtRate(r.passRate)}`).join(', ')}.`} />
        </div>
      </div>
      <DataTable
        caption="Pass rates by track and check type"
        head={['Group', 'Pass rate', 'Passes / submits', 'Passed after reveal (not counted)', 'First try', 'First-try units']}
        rows={[...trackRows, ...typeRows].map((r) => [
          r.label,
          fmtRate(r.passRate),
          `${r.passes}/${r.attempts}`,
          fmtInt(r.guidedPasses),
          fmtRate(r.firstTryRate),
          `${r.firstTryPasses}/${r.units}`,
        ])}
      />
      <p className="muted small">
        A graded submit is a machine-checked submit; reading self-attests, written answers and self-scored explain-backs or katas are not counted. A submit made after you revealed the solution is a graded submit but never a pass, so copying the
        revealed answer cannot raise the rate. First try =
        the unit&apos;s earliest graded submit passed with no self-assist and no reveal.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- reviews

const RATING_PARTS = [
  { id: 'again', label: 'Again', className: 'series-again' },
  { id: 'hard', label: 'Hard', className: 'series-hard' },
  { id: 'good', label: 'Good', className: 'series-good' },
  { id: 'easy', label: 'Easy', className: 'series-easy' },
] as const;

function ReviewPanel({ q }: { q: Loaded<ReviewStatsResponse> }) {
  return <Panel title="Reviews">{q.status !== 'ready' ? <LoadState error={q.error} onRetry={q.reload} minHeight={220} /> : <ReviewStats data={q.data} />}</Panel>;
}

function ReviewStats({ data }: { data: ReviewStatsResponse }) {
  const ret = data.retention;
  const rows: BarDatum[] = data.forecast.map((d, i) => ({
    key: d.day,
    label: i === 0 ? `Today (${shortDate(d.day)})` : longDate(d.day),
    values: { due: d.due },
  }));
  const ahead = data.forecast.reduce((s, d) => s + d.due, 0);
  // W11: every day gets its weekday (a wide "Today" in the same row pushed tomorrow's label out);
  // "Today" sits on its own row under the first bar
  const labels = data.forecast.map((d, i) => ({ i, text: weekdayLabel(d.day).slice(0, 2) }));
  const todayLabel = data.forecast.length > 0 ? [{ i: 0, text: 'Today' }] : [];
  const ratingsTotal = data.ratings.again + data.ratings.hard + data.ratings.good + data.ratings.easy;
  return (
    <div data-testid="review-stats">
      <dl className="mini-stats">
        <div>
          <dt>Due now</dt>
          <dd className="num">{fmtInt(data.dueNow)}</dd>
        </div>
        <div>
          <dt>Retention, 30d</dt>
          <dd className="num">{fmtRate(ret.window.rate)}</dd>
        </div>
        <div>
          <dt>All time</dt>
          <dd className="num">{fmtRate(ret.allTime.rate)}</dd>
        </div>
      </dl>
      <h3 className="chart-h">Due, next {data.forecast.length} days</h3>
      {data.cards === 0 ? (
        <div className="chart-empty" data-testid="review-empty">
          <p>No review cards yet.</p>
          <p className="muted small">Cards are enrolled by study quests (missed questions, flashcards).</p>
        </div>
      ) : (
        <>
          <BarChart
            data={rows}
            series={[{ id: 'due', label: 'Due', className: 'series-due' }]}
            xLabels={labels}
            subLabels={todayLabel}
            height={163}
            unit="due"
            valueLabels
            summary={`Review cards due over the next ${data.forecast.length} days: ${fmtInt(ahead)}, of which ${fmtInt(data.forecast[0]?.due ?? 0)} today.`}
            describe={(d) => `${d.label}: ${fmtInt(d.values.due ?? 0)} card${d.values.due === 1 ? '' : 's'} due`}
          />
          <p className="muted small">
            Today includes <span className="num">{fmtInt(data.overdue)}</span> overdue · <span className="num">{fmtInt(data.later)}</span> due later · <span className="num">{fmtInt(data.cards)}</span> cards
          </p>
          {/* W11: the forecast's own table sits under the forecast (it used to follow the Grades block) */}
          <DataTable caption="Review cards due per day" head={['Day', 'Due']} rows={rows.map((r) => [r.label, fmtInt(r.values.due ?? 0)])} />
        </>
      )}
      <h3 className="chart-h">Grades</h3>
      {ratingsTotal === 0 ? (
        <p className="muted small" data-testid="retention-empty">
          No reviews graded yet: retention is shown after the first one.
        </p>
      ) : (
        <ShareBar
          parts={RATING_PARTS.map((p) => ({ ...p, value: data.ratings[p.id] }))}
          summary={`Review grades: ${RATING_PARTS.map((p) => `${p.label} ${data.ratings[p.id]}`).join(', ')}.`}
        />
      )}
      <p className="muted small">Retention = graded reviews not marked Again ({fmtInt(ret.window.recalled)}/{fmtInt(ret.window.reviews)} in the last 30 days).</p>
    </div>
  );
}

// ---------------------------------------------------------------- campaign progress

function CampaignProgressPanel({ q }: { q: Loaded<CampaignProgressResponse> }) {
  return (
    <Panel title="Campaign progress" className="span-2">
      {q.status !== 'ready' ? <LoadState error={q.error} onRetry={q.reload} minHeight={200} /> : <CampaignProgress data={q.data} />}
    </Panel>
  );
}

function CampaignProgress({ data }: { data: CampaignProgressResponse }) {
  return (
    <div className="camp-progress" data-testid="campaign-progress">
      {data.tracks.map((t) => (
        <section key={t.trackId} className={`camp-track${t.locked ? ' track-locked' : ''}`} aria-label={`${t.name} progress`}>
          <header className="camp-track-head">
            <h3 className="chart-h">{t.name}</h3>
            <span className="num" title={progressTitle(t.progress)}>
              {t.locked ? 'Locked' : progressLabel(t.progress)}
            </span>
          </header>
          {t.acts.length === 0 ? (
            <p className="muted small">
              No campaign acts seeded{t.progress.basis === 'practice' ? ` · practice ${t.progress.practiceDone}/${t.progress.practiceTotal} units` : ''}.
            </p>
          ) : (
            <ol className="camp-acts">
              {t.acts.map((a) => (
                <li key={a.actNo} className={a.unlocked ? '' : 'camp-act-locked'}>
                  <span className="camp-act-name">
                    Act {a.actNo}: {a.title}
                    {!a.unlocked && !t.locked && <span className="muted"> (locked)</span>}
                  </span>
                  <ProgressBar value={a.coreDone} max={Math.max(1, a.coreTotal)} label={`${t.name} act ${a.actNo} core progress`} tone="success" />
                  <span className="camp-act-num small">
                    core <span className="num">{a.coreDone}/{a.coreTotal}</span>
                    {a.corePending > 0 && <span className="muted"> · {a.corePending} content pending</span>}
                    {a.readingTotal > 0 && (
                      <span className="muted">
                        {' '}
                        · reading {a.readingDone}/{a.readingTotal}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}

function CatchRatePanel({ q }: { q: Loaded<KataStatsResponse> }) {
  return (
    <Panel title="Catch rate (G1)">
      {q.status !== 'ready' ? (
        <LoadState error={q.error} onRetry={q.reload} minHeight={120} />
      ) : (
        <div className="catch-rate" data-testid="catch-rate">
          <div className="tile-value">
            {q.data.defectsCaught}
            <span className="tile-unit">/ {q.data.defectsTotal} seeded defects caught</span>
          </div>
          <p>
            {q.data.catchRate === null ? 'No kata self-scored yet.' : `${Math.round(q.data.catchRate * 1000) / 10}% across ${q.data.katasScored} kata(s).`}{' '}
            {q.data.gate.met ? <Chip tone="success">G1 gate met</Chip> : <Chip>G1 gate not met</Chip>}
          </p>
          <p className="muted small">{q.data.gate.rule}</p>
          {q.data.assistedCount > 0 && (
            <p className="muted small" data-testid="kata-assisted">
              {q.data.assistedCount} assisted / guided kata{q.data.assistedCount === 1 ? '' : 's'} not counted toward G1 (solo work only).
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

function EvidenceBrowser() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const raw = params.get('competency');
  const competency = isCompetencyId(raw) ? raw : undefined;
  const q = useAsync(() => api.listEvidence(competency ? { competency } : {}), [api, competency]);
  // fix/client-dash: `#evidence-<id>` (the dashboard's last-evidence link, a demotion notice)
  // scrolls to that row and marks it. The browser cannot do it: the row renders after the list loads.
  const { hash } = useLocation();
  const hashId = /^#evidence-(\d+)$/.exec(hash)?.[1];
  const targetId = hashId !== undefined ? Number(hashId) : null;
  const rows = q.status === 'ready' ? q.data.items : null;
  const targetFound = targetId !== null && rows !== null && rows.some((e) => e.id === targetId);
  // a hash target the loaded list does not hold: its note is what the learner must see (the page
  // would otherwise sit at the top with no explanation, the stats panels above it in the way)
  const targetMissing = targetId !== null && rows !== null && !targetFound;
  const missingNote = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!targetFound) return;
    const el = document.getElementById(`evidence-${targetId}`);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'center' });
  }, [targetFound, targetId]);
  useEffect(() => {
    if (targetMissing) missingNote.current?.scrollIntoView?.({ block: 'center' });
  }, [targetMissing, targetId]);
  const missing = targetMissing && (
    <p className="muted small" data-testid="evidence-target-missing" ref={missingNote} role="note">
      Evidence #{targetId} is not in this list{competency ? ' (it is filtered by competency)' : ''}.
    </p>
  );

  return (
    <Panel
      title="Evidence browser"
      className="span-all"
      aside={
        <label className="evidence-filter">
          <span className="muted small">Competency </span>
          <select
            value={competency ?? ''}
            aria-label="Filter by competency"
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('competency', e.target.value);
              else next.delete('competency');
              setParams(next);
            }}
          >
            <option value="">All competencies</option>
            {COMPETENCIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <div id="evidence">
        {q.status !== 'ready' ? (
          <LoadState error={q.error} onRetry={q.reload} minHeight={160} />
        ) : q.data.items.length === 0 ? (
          <>
            {missing}
            <p className="muted" data-testid="evidence-empty">
              No evidence rows{competency ? ' for this competency' : ''} yet.
            </p>
          </>
        ) : (
          <>
            <p className="muted small">
              {q.data.items.length} of {q.data.total} row(s), newest first. Evidence is append-only.
            </p>
            {missing}
            <ol className="evidence-list" data-testid="evidence-list">
              {q.data.items.map((e) => (
                <EvidenceItem key={e.id} e={e} hit={e.id === targetId} />
              ))}
            </ol>
          </>
        )}
      </div>
    </Panel>
  );
}

function EvidenceItem({ e, hit }: { e: EvidenceRowDto; hit: boolean }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState<AttemptDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (attempt || e.attemptId === null) return;
    // fix/client-dash: every open is a fresh try; a failed load no longer sticks to later opens
    setError(null);
    try {
      setAttempt(await api.getAttempt(e.attemptId));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const value = e.score !== null ? `score ${Math.round(e.score * 1000) / 10}%` : e.rating !== null ? `rating ${e.rating}` : null;
  return (
    <li
      id={`evidence-${e.id}`}
      className={`evidence-row${hit ? ' evidence-row-hit' : ''}`}
      data-competency={e.competency}
      {...(hit ? { 'data-highlight': 'true', tabIndex: -1 } : {})}
    >
      <div className="evidence-head">
        <code>#{e.id}</code>
        <Chip>{e.kind}</Chip>
        <span>{e.competency}</span>
        <Chip tone={e.assessor === 'pipeline' ? 'info' : 'neutral'}>{e.assessor}</Chip>
        {e.assistance !== 'none' && <Chip tone="warning">assisted ({e.assistance})</Chip>}
        {e.verified && <Chip tone="success">verified</Chip>}
        {value && <span className="muted">{value}</span>}
        <span className="muted small">{fmtStamp(e.createdAt)}</span>
      </div>
      <p className="evidence-obs">
        {e.observation}
        {e.unitTitle && <span className="muted"> · {e.unitTitle}</span>}
      </p>
      {e.attemptId !== null && (
        <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => void toggle()}>
          attempt #{e.attemptId}
        </button>
      )}
      {open && (
        <div className="attempt-detail" data-testid={`attempt-${e.attemptId}`}>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : !attempt ? (
            <p className="muted small">Loading…</p>
          ) : (
            <>
              <p>
                {attempt.unitTitle} ({attempt.unitKind}) · {attempt.mode} · outcome <code>{attempt.outcome}</code>
                {attempt.runs.length > 0 && <> · runs: {attempt.runs.map((r) => `${r.verdict}${r.durationMs !== null ? ` ${r.durationMs}ms` : ''}`).join(', ')}</>}
              </p>
              <pre className="code-block">{JSON.stringify(attempt.answer, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </li>
  );
}
