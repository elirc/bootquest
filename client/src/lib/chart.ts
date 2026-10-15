// Campaign 2 B2: pure chart geometry for the hand-rolled SVG charts on the Stats page.
// No chart library: scales, ticks and label placement are plain functions so they can be
// unit-tested (drawn to scale, labels inside bounds).

/** A "nice" axis maximum >= max (1, 2, 2.5, 5 x 10^k) and its evenly spaced ticks from 0. */
export function niceScale(max: number, maxTicks = 4): { max: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { max: 1, ticks: [0, 1] };
  const rough = max / Math.max(1, maxTicks);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough)!;
  // integer data (XP, cards) never gets fractional ticks
  const s = step < 1 ? 1 : step;
  const top = Math.ceil(max / s) * s;
  const ticks: number[] = [];
  for (let v = 0; v <= top + s / 2; v += s) ticks.push(Math.round(v * 1000) / 1000);
  return { max: top, ticks };
}

/** Linear value -> pixel (0 at `base`, `max` at `base - span`), clamped into the plot. */
export function yScale(value: number, max: number, base: number, span: number): number {
  const v = Math.max(0, Math.min(value, max));
  return base - (max > 0 ? (v / max) * span : 0);
}

export interface Band {
  /** left edge of the bar */
  x: number;
  /** bar width (>= 1) */
  w: number;
  /** centre of the band (label anchor) */
  cx: number;
  /** full band (hit target) */
  bx: number;
  bw: number;
}

/** n equal bands across [left, left + width]; a 2px surface gap between bars when there is room, else 1px, else none. */
export function bands(n: number, left: number, width: number): Band[] {
  if (n <= 0) return [];
  const bw = width / n;
  const gap = bw >= 8 ? 2 : bw >= 3 ? 1 : 0;
  return Array.from({ length: n }, (_, i) => {
    const bx = left + i * bw;
    const w = Math.max(1, bw - gap);
    return { x: bx + (bw - w) / 2, w, cx: bx + bw / 2, bx, bw };
  });
}

/**
 * Keep axis labels that fit: each label is `charW * text.length` wide, centred on `x`,
 * clamped inside [minX, maxX]; a label overlapping the previously kept one (plus `pad`) is dropped.
 */
export function placeLabels<T extends { x: number; text: string }>(
  labels: readonly T[],
  minX: number,
  maxX: number,
  charW = 6.5,
  pad = 6,
): (T & { left: number; anchorX: number })[] {
  const out: (T & { left: number; anchorX: number })[] = [];
  let lastRight = -Infinity;
  for (const l of labels) {
    const w = l.text.length * charW;
    const left = Math.min(Math.max(l.x - w / 2, minX), maxX - w);
    if (left < minX - 0.01 || left < lastRight + pad) continue;
    out.push({ ...l, left, anchorX: left + w / 2 });
    lastRight = left + w;
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Parse a 'YYYY-MM-DD' day key as calendar fields (never through a timezone). */
export function keyParts(key: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  // Zeller-free weekday: UTC noon of the calendar date (the key carries no zone)
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return { y, m, d, dow };
}

export const monthLabel = (key: string) => MONTHS[keyParts(key).m - 1]!;
export const shortDate = (key: string) => {
  const p = keyParts(key);
  return `${MONTHS[p.m - 1]} ${p.d}`;
};
export const longDate = (key: string) => {
  const p = keyParts(key);
  return `${WEEKDAYS[p.dow]} ${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
};
export const weekdayLabel = (key: string) => WEEKDAYS[keyParts(key).dow]!;

/** Indices where a new month starts (index 0 always counts) — the x-axis tick positions. */
export function monthStarts(keys: readonly string[], withYear = false): { i: number; text: string }[] {
  const out: { i: number; text: string }[] = [];
  let prev = '';
  keys.forEach((k, i) => {
    const ym = k.slice(0, 7);
    if (ym === prev) return;
    prev = ym;
    const p = keyParts(k);
    out.push({ i, text: withYear && (p.m === 1 || i === 0) ? `${MONTHS[p.m - 1]} ${p.y}` : MONTHS[p.m - 1]! });
  });
  return out;
}

/** 0.8 -> "80%", null -> "—"; one decimal only below 10% so small rates are not shown as 0%. */
export function fmtRate(r: number | null): string {
  if (r === null) return '—';
  const pct = r * 100;
  if (pct > 0 && pct < 10) return `${Math.round(pct * 10) / 10}%`;
  // never round an incomplete rate up to 100%
  return `${r < 1 ? Math.min(99, Math.round(pct)) : Math.round(pct)}%`;
}
