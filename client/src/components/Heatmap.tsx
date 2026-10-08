import { useMemo, useState } from 'react';
import type { HeatmapDay } from '../api/types';
import { buildHeatGrid, describeCell, type HeatCell } from '../lib/heatmap';
import { fmtInt } from '../lib/format';

const ROW_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

export function Heatmap({ days, today }: { days: HeatmapDay[]; today: string }) {
  const grid = useMemo(() => buildHeatGrid(days, today), [days, today]);
  const [hover, setHover] = useState<HeatCell | null>(null);
  const todayCell = grid.weeks.flat().find((c) => c?.isToday) ?? null;
  const shown = hover ?? todayCell;
  const count = (s: HeatmapDay['status']) => days.filter((d) => d.status === s).length;

  return (
    <figure className="heatmap" aria-label={`Activity over the last ${days.length} days: ${fmtInt(grid.totalXp)} XP across ${grid.activeDays} active days`}>
      <div className="heatmap-top">
      <div className="heatmap-body" aria-hidden="true">
        <div className="heatmap-rows">
          <span />
          {ROW_LABELS.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
        <div className="heatmap-main">
          <div className="heatmap-months" style={{ gridTemplateColumns: `repeat(${grid.weeks.length}, var(--cell))` }}>
            {grid.months.map((m) => (
              <span key={`${m.label}-${m.col}`} style={{ gridColumn: m.col + 1 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="heatmap-grid" style={{ gridTemplateColumns: `repeat(${grid.weeks.length}, var(--cell))` }} onMouseLeave={() => setHover(null)}>
            {grid.weeks.flatMap((week, w) =>
              week.map((c, d) =>
                c ? (
                  <span
                    key={c.date}
                    className={`hm-cell hm-${c.status === 'frozen' ? 'freeze' : c.bucket}${c.isToday ? ' hm-today' : ''}`}
                    data-date={c.date}
                    data-bucket={c.bucket}
                    title={describeCell(c)}
                    onMouseEnter={() => setHover(c)}
                  />
                ) : (
                  <span key={`pad-${w}-${d}`} className="hm-cell hm-pad" />
                ),
              ),
            )}
          </div>
        </div>
      </div>
      <dl className="heatmap-stats">
        <div>
          <dt>XP</dt>
          <dd>{fmtInt(grid.totalXp)}</dd>
        </div>
        <div>
          <dt>Active days</dt>
          <dd>
            {grid.activeDays}
            <span className="muted"> / {days.length}</span>
          </dd>
        </div>
        <div>
          <dt>Slate days</dt>
          <dd>{count('slate')}</dd>
        </div>
        <div>
          <dt>Partial days</dt>
          <dd>{count('partial')}</dd>
        </div>
        <div>
          <dt>Freezes used</dt>
          <dd>{count('frozen')}</dd>
        </div>
        <div>
          <dt>Missed</dt>
          <dd>{count('missed')}</dd>
        </div>
      </dl>
      </div>
      <figcaption className="heatmap-foot">
        <span className="heatmap-readout" aria-live="polite">
          {shown ? describeCell(shown) : ' '}
        </span>
        <span className="heatmap-legend" aria-hidden="true">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((b) => (
            <span key={b} className={`hm-cell hm-${b}`} />
          ))}
          <span>More</span>
          <span className="hm-cell hm-freeze" />
          <span>Freeze</span>
        </span>
      </figcaption>
    </figure>
  );
}
