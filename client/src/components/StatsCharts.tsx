// Campaign 2 B2: hand-rolled SVG charts for the Stats page. No chart library: geometry comes from
// lib/chart.ts (unit-tested), every colour is a CSS token (classes in app.css), numbers are
// tabular, and every chart ships a readout (hover / arrow keys) plus a data table for screen readers.

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { bands, fmtRate, niceScale, placeLabels, yScale } from '../lib/chart';
import { fmtInt } from '../lib/format';

/** Width of a container, measured (ResizeObserver) so text is never scaled; `fallback` before layout / in tests. */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** SVG path of a bar with rounded TOP corners only (the data end; the baseline end stays square). */
export function topRoundedBar(x: number, y: number, w: number, h: number, r = 2): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export interface ChartSeries {
  id: string;
  label: string;
  /** CSS class carrying the token fill (app.css .series-*) */
  className: string;
}

export interface BarDatum {
  key: string;
  /** readout prefix, e.g. "Wed Oct 7, 2026" */
  label: string;
  values: Record<string, number>;
}

const M = { top: 10, right: 8, bottom: 22, left: 40 };

/**
 * Vertical (stacked) bars to scale from a zero baseline. `series` is bottom-first; a series'
 * colour follows the entity, never its rank. Hover or arrow keys select a bar; the readout
 * under the chart names every segment in text.
 */
export function BarChart({
  data,
  series,
  xLabels,
  subLabels = [],
  height = 200,
  unit,
  summary,
  valueLabels = false,
  highlightLast = false,
  describe,
}: {
  data: readonly BarDatum[];
  series: readonly ChartSeries[];
  xLabels: readonly { i: number; text: string }[];
  /** W11: a second, left-anchored label row under the first (e.g. "Today" under its weekday) */
  subLabels?: readonly { i: number; text: string }[];
  height?: number;
  unit: string;
  summary: string;
  /** print each bar's total above it when the band is wide enough */
  valueLabels?: boolean;
  /** mark the last bar (today / this week) */
  highlightLast?: boolean;
  describe?: (d: BarDatum) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [sel, setSel] = useState<number | null>(null);
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.id] ?? 0), 0));
  const scale = niceScale(Math.max(0, ...totals));
  const plotW = Math.max(40, width - M.left - M.right);
  const subH = subLabels.length > 0 ? 13 : 0; // the second label row's extra height
  const plotH = height - M.top - M.bottom - subH;
  const base = M.top + plotH;
  const bs = bands(data.length, M.left, plotW);
  const labels = placeLabels(
    xLabels.filter((l) => bs[l.i]).map((l) => ({ ...l, x: bs[l.i]!.cx })),
    M.left,
    width - M.right,
  );
  const text = (i: number) => {
    const d = data[i]!;
    if (describe) return describe(d);
    const parts = series.filter((s) => (d.values[s.id] ?? 0) > 0).map((s) => `${s.label} ${fmtInt(d.values[s.id]!)}`);
    return totals[i] === 0 ? `${d.label}: no ${unit}` : `${d.label}: ${fmtInt(totals[i]!)} ${unit}${series.length > 1 ? ` (${parts.join(' · ')})` : ''}`;
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (data.length === 0) return;
    const cur = sel ?? data.length - 1;
    const next =
      e.key === 'ArrowLeft' ? Math.max(0, cur - 1) : e.key === 'ArrowRight' ? Math.min(data.length - 1, cur + 1) : e.key === 'Home' ? 0 : e.key === 'End' ? data.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setSel(next);
  };
  const shown = sel ?? (highlightLast && data.length ? data.length - 1 : null);

  return (
    <div className="chart" ref={ref}>
      <svg
        className="chart-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${summary} Use the arrow keys to read each bar.`}
        tabIndex={0}
        onKeyDown={onKey}
        onMouseLeave={() => setSel(null)}
        onBlur={() => setSel(null)}
      >
        {scale.ticks.map((t) => {
          const y = Math.round(yScale(t, scale.max, base, plotH)) + 0.5;
          return (
            <g key={t} className="chart-grid">
              <line x1={M.left} x2={width - M.right} y1={y} y2={y} />
              <text x={M.left - 6} y={y} dy="0.32em" textAnchor="end" className="chart-tick">
                {fmtInt(t)}
              </text>
            </g>
          );
        })}
        {shown !== null && bs[shown] && <rect className="chart-hover" x={bs[shown].bx} y={M.top} width={bs[shown].bw} height={plotH} />}
        {data.map((d, i) => {
          const b = bs[i]!;
          let y0 = base;
          const segs = series.filter((s) => (d.values[s.id] ?? 0) > 0);
          return (
            <g key={d.key} data-bar={d.key} data-total={totals[i]}>
              {segs.map((s, k) => {
                const v = d.values[s.id]!;
                const h = base - yScale(v, scale.max, base, plotH);
                const y = y0 - h;
                y0 = y;
                // a 1px surface gap between stacked segments when the segment is tall enough
                const gap = k > 0 && h > 3 ? 1 : 0;
                const isTop = k === segs.length - 1;
                return isTop ? (
                  <path key={s.id} className={`chart-bar ${s.className}`} d={topRoundedBar(b.x, y, b.w, Math.max(0.5, h - gap), Math.min(2, b.w / 2))} />
                ) : (
                  <rect key={s.id} className={`chart-bar ${s.className}`} x={b.x} y={y} width={b.w} height={Math.max(0.5, h - gap)} />
                );
              })}
              {valueLabels && b.bw >= 18 && totals[i]! > 0 && (
                <text x={b.cx} y={Math.max(M.top + 9, yScale(totals[i]!, scale.max, base, plotH) - 4)} textAnchor="middle" className="chart-value">
                  {fmtInt(totals[i]!)}
                </text>
              )}
            </g>
          );
        })}
        <line className="chart-axis" x1={M.left} x2={width - M.right} y1={base + 0.5} y2={base + 0.5} />
        {labels.map((l) => (
          <text key={`${l.i}-${l.text}`} x={l.anchorX} y={height - 6 - subH} textAnchor="middle" className="chart-tick">
            {l.text}
          </text>
        ))}
        {subLabels
          .filter((l) => bs[l.i])
          .map((l) => (
            <text key={`sub-${l.i}`} x={bs[l.i]!.x} y={height - 4} textAnchor="start" className="chart-tick chart-sub-tick">
              {l.text}
            </text>
          ))}
        {/* hit targets: the full band, taller and wider than the mark */}
        {bs.map((b, i) => (
          <rect key={`hit-${i}`} className="chart-hit" x={b.bx} y={M.top} width={b.bw} height={plotH} onMouseEnter={() => setSel(i)} />
        ))}
      </svg>
      <p className="chart-readout" aria-live="polite">
        {shown !== null && data[shown] ? text(shown) : ' '}
      </p>
    </div>
  );
}

export function Legend({ series }: { series: readonly ChartSeries[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="chart-legend" aria-label="Legend">
      {series.map((s) => (
        <li key={s.id}>
          <svg width="10" height="10" aria-hidden="true">
            <rect className={s.className} width="10" height="10" rx="2" />
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** A collapsible data table: the chart's numbers as text (screen readers, exact values). */
export function DataTable({ caption, head, rows }: { caption: string; head: readonly string[]; rows: readonly (readonly ReactNode[])[] }) {
  return (
    <details className="chart-table">
      <summary>Data table</summary>
      <div className="chart-table-scroll">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) =>
                  j === 0 ? (
                    <th key={j} scope="row">
                      {c}
                    </th>
                  ) : (
                    <td key={j}>{c}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export interface RateRow {
  key: string;
  label: string;
  passRate: number | null;
  passes: number;
  attempts: number;
  firstTryRate: number | null;
  firstTryPasses: number;
  units: number;
}

/**
 * Pass rate (thick bar) and first-try rate (thin bar) per row on ONE fixed 0-100% scale. The row
 * label sits on its own line so the bars keep the full width at phone size; each bar's value is
 * printed as text at its end (never colour alone).
 */
export function RateChart({ rows, summary }: { rows: readonly RateRow[]; summary: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const valueW = 84;
  const left = 0;
  const plotW = Math.max(40, width - valueW - 8);
  const rowH = 46;
  const top = 2;
  const height = top + rows.length * rowH + 18;
  const x = (r: number | null) => (r === null ? 0 : Math.max(0, Math.min(1, r)) * plotW);
  return (
    <div className="chart" ref={ref}>
      <svg className="chart-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
        {[0, 0.5, 1].map((t) => {
          const gx = Math.round(left + t * (plotW - 1)) + 0.5;
          return (
            <g key={t} className="chart-grid">
              <line x1={gx} x2={gx} y1={top + 14} y2={height - 16} />
              <text x={gx} y={height - 3} textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'} className="chart-tick">
                {t * 100}%
              </text>
            </g>
          );
        })}
        {rows.map((r, i) => {
          const y = top + i * rowH;
          return (
            <g key={r.key} data-row={r.key}>
              <text x={left} y={y + 11} className="chart-label">
                {r.label}
              </text>
              <rect className="chart-track" x={left} y={y + 16} width={plotW} height={10} rx={2} />
              {r.passRate !== null && r.passRate > 0 && <rect className="chart-bar series-pass" x={left} y={y + 16} width={Math.max(2, x(r.passRate))} height={10} rx={2} />}
              <rect className="chart-track" x={left} y={y + 30} width={plotW} height={6} rx={2} />
              {r.firstTryRate !== null && r.firstTryRate > 0 && (
                <rect className="chart-bar series-first" x={left} y={y + 30} width={Math.max(2, x(r.firstTryRate))} height={6} rx={2} />
              )}
              <text x={width - 2} y={y + 25} textAnchor="end" className="chart-value">
                {fmtRate(r.passRate)} · {r.passes}/{r.attempts}
              </text>
              <text x={width - 2} y={y + 37} textAnchor="end" className="chart-tick">
                {fmtRate(r.firstTryRate)} · {r.firstTryPasses}/{r.units}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** A 100%-wide stacked bar of shares (e.g. review ratings); labels + counts live in the legend list. */
export function ShareBar({ parts, summary }: { parts: readonly { id: string; label: string; value: number; className: string }[]; summary: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const total = parts.reduce((s, p) => s + p.value, 0);
  let x0 = 0;
  return (
    <div className="chart" ref={ref}>
      <svg className="chart-svg" width={width} height={14} viewBox={`0 0 ${width} 14`} role="img" aria-label={summary}>
        <rect className="chart-track" x={0} y={0} width={width} height={14} rx={3} />
        {total > 0 &&
          parts.map((p) => {
            const w = (p.value / total) * width;
            const x = x0;
            x0 += w;
            return p.value > 0 ? <rect key={p.id} className={`chart-bar ${p.className}`} x={x + (x > 0 ? 1 : 0)} y={0} width={Math.max(1, w - (x > 0 ? 1 : 0))} height={14} rx={x === 0 || x0 >= width - 0.5 ? 3 : 0} /> : null;
          })}
      </svg>
      <ul className="chart-legend">
        {parts.map((p) => (
          <li key={p.id}>
            <svg width="10" height="10" aria-hidden="true">
              <rect className={p.className} width="10" height="10" rx="2" />
            </svg>
            {p.label} <span className="num">{fmtInt(p.value)}</span>
            {total > 0 && <span className="muted"> ({fmtRate(p.value / total)})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
