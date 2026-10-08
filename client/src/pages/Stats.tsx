import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import type { AttemptDetailResponse, CompetencyId, EvidenceRowDto } from '../api/types';
import { Chip, LoadState, PageHeader, Panel } from '../components/ui';
import { fmtInt } from '../lib/format';
import { buildHeatGrid } from '../lib/heatmap';
import { useAsync } from '../lib/useAsync';

const COMPETENCIES: { id: CompetencyId; label: string }[] = [
  { id: 'language-fluency', label: 'Language fluency' },
  { id: 'feature-delivery', label: 'Feature delivery' },
  { id: 'data-http', label: 'Data & HTTP' },
  { id: 'testing-verification', label: 'Testing & verification' },
  { id: 'agentic-engineering', label: 'Agentic engineering' },
  { id: 'code-reading', label: 'Code reading & maintenance' },
  { id: 'communication', label: 'Communication' },
];
const isCompetency = (v: string | null): v is CompetencyId => COMPETENCIES.some((c) => c.id === v);

/** Stats: tiles + G1 catch rate + the evidence browser. XP-over-time / pass rates are W7. */
export function StatsPage() {
  const api = useApi();
  const q = useAsync(() => api.getDashboard(), [api]);
  const grid = q.data ? buildHeatGrid(q.data.heatmap, q.data.today) : null;
  const days = q.data?.heatmap ?? [];
  const slateDays = days.filter((d) => d.status === 'slate').length;

  return (
    <>
      <PageHeader eyebrow="Stats" title="Progress & evidence" />
      {q.status !== 'ready' || !grid ? (
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
            {[
              ['XP over time', 'Weekly XP by track, stacked.'],
              ['Pass rates', 'First-try pass rate per unit kind and track.'],
            ].map(([title, body]) => (
              <Panel key={title} title={title}>
                <div className="placeholder">
                  <p>{body}</p>
                  <span className="muted small">Lands in W7.</span>
                </div>
              </Panel>
            ))}
            <CatchRatePanel />
            <EvidenceBrowser />
          </div>
        </div>
      )}
    </>
  );
}

function CatchRatePanel() {
  const api = useApi();
  const q = useAsync(() => api.getKataStats(), [api]);
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
        </div>
      )}
    </Panel>
  );
}

function EvidenceBrowser() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const raw = params.get('competency');
  const competency = isCompetency(raw) ? raw : undefined;
  const q = useAsync(() => api.listEvidence(competency ? { competency } : {}), [api, competency]);

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
          <p className="muted" data-testid="evidence-empty">
            No evidence rows{competency ? ' for this competency' : ''} yet.
          </p>
        ) : (
          <>
            <p className="muted small">
              {q.data.items.length} of {q.data.total} row(s), newest first. Evidence is append-only.
            </p>
            <ol className="evidence-list" data-testid="evidence-list">
              {q.data.items.map((e) => (
                <EvidenceItem key={e.id} e={e} />
              ))}
            </ol>
          </>
        )}
      </div>
    </Panel>
  );
}

function EvidenceItem({ e }: { e: EvidenceRowDto }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState<AttemptDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (attempt || e.attemptId === null) return;
    try {
      setAttempt(await api.getAttempt(e.attemptId));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const value = e.score !== null ? `score ${Math.round(e.score * 1000) / 10}%` : e.rating !== null ? `rating ${e.rating}` : null;
  return (
    <li id={`evidence-${e.id}`} className="evidence-row" data-competency={e.competency}>
      <div className="evidence-head">
        <code>#{e.id}</code>
        <Chip>{e.kind}</Chip>
        <span>{e.competency}</span>
        <Chip tone={e.assessor === 'pipeline' ? 'info' : 'neutral'}>{e.assessor}</Chip>
        {e.assistance !== 'none' && <Chip tone="warning">assisted ({e.assistance})</Chip>}
        {e.verified && <Chip tone="success">verified</Chip>}
        {value && <span className="muted">{value}</span>}
        <span className="muted small">{new Date(e.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</span>
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
