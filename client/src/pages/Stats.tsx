import { useApi } from '../api/context';
import { LoadState, PageHeader, Panel } from '../components/ui';
import { fmtInt } from '../lib/format';
import { buildHeatGrid } from '../lib/heatmap';
import { useAsync } from '../lib/useAsync';

/** Placeholder: the real stats + evidence browser are W7. Shows what the current API can already answer. */
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
              ['Catch rate', 'Patch-kata defects caught vs missed.'],
            ].map(([title, body]) => (
              <Panel key={title} title={title}>
                <div className="placeholder">
                  <p>{body}</p>
                  <span className="muted small">Lands in W7.</span>
                </div>
              </Panel>
            ))}
            <Panel title="Evidence browser" className="span-all">
              <div className="placeholder" id="evidence">
                <p>Every immutable evidence row: competency, intention, observation, assistance, assessor, rating.</p>
                <span className="muted small">Lands in W7. Dashboard “last evidence” links point here.</span>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
