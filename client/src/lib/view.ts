// Client-only display helpers over the server contract. Nothing here computes a number the
// server owns (XP, level, streak); these are labels and presentation constants only.

import type { PublicCheck, TrackId, UnitDetail } from '../api/types';
import { proseChunks } from './prose';

/** Every TrackId, in sidebar order. `satisfies` + the exhaustive record below keep it in sync. */
export const TRACK_IDS = ['js', 'csharp', 'agentic', 'java'] as const satisfies readonly TrackId[];

export const TRACK_LABEL: Record<TrackId, string> = { js: 'JS/TS', csharp: 'C#/.NET', agentic: 'Agentic', java: 'Java' };
/** Short badge text (W-13b: the server has no `short`; this is presentation only). */
export const TRACK_SHORT: Record<TrackId, string> = { js: 'JS', csharp: 'C#', agentic: 'AG', java: 'JV' };

/**
 * W9 (ui-audit #4): what the sidebar and campaign tabs show while GET /tracks is in flight — the
 * server's own order (track.sort_order) and names, so nothing reorders or relabels on arrival.
 */
export const TRACK_PLACEHOLDER: readonly { id: TrackId; name: string; locked: boolean }[] = [
  { id: 'js', name: 'JS/TS + React', locked: false },
  { id: 'csharp', name: 'C#/.NET', locked: false },
  { id: 'java', name: 'Java', locked: true },
  { id: 'agentic', name: 'Agentic engineering', locked: false },
];

export const isTrackId = (v: string | undefined): v is TrackId => (TRACK_IDS as readonly string[]).includes(v ?? '');

/**
 * Spec §streak: at most 2 freeze tokens are banked. The dashboard response carries only the
 * banked count (`streak.tokens`), not the cap, so the cap is a display constant here.
 */
export const FREEZE_TOKENS_MAX = 2;

/** 'YYYY-MM-DD' of an epoch-ms timestamp in the owner's local day (the server's day basis). */
export function dayOfMs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const LANGUAGE_LABEL: Record<string, string> = { js: 'JavaScript', ts: 'TypeScript', sql: 'SQL', cs: 'C#' };

/** Editor language label from the public check spec (W-14d: language lives in spec, not on the unit). */
export function languageOf(spec: PublicCheck | null | undefined): string | null {
  if (!spec) return null;
  if (spec.type === 'drill-cs') return 'C#';
  if ('language' in spec) return LANGUAGE_LABEL[spec.language] ?? spec.language;
  return null;
}

/**
 * Tolerant prose (W-14e): instructions / quiz prompt are being added server-side by another
 * wave. Read them when present (on the unit, or a `prompt` on the check spec), never require them.
 */
export function unitProse(detail: UnitDetail): { instructions: string; prompt: string | null } {
  // Canonical source is the top-level field (server contract since W2);
  // the unit-level fields remain as a tolerant fallback for older fixtures.
  const raw = detail.instructions ?? detail.unit.instructions;
  // W9 (ui-audit #2/#3): the RAW markdown-ish text is kept (code blocks, line breaks) and rendered
  // by lib/prose.tsx; chunks split at blank lines OUTSIDE code fences only.
  const chunks = Array.isArray(raw)
    ? raw.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    : typeof raw === 'string' && raw.trim() !== ''
      ? proseChunks(raw)
      : [];
  const specPrompt = (detail.check?.spec as { prompt?: unknown } | undefined)?.prompt;
  let prompt =
    typeof detail.unit.prompt === 'string' && detail.unit.prompt.trim() !== ''
      ? detail.unit.prompt
      : typeof specPrompt === 'string' && specPrompt.trim() !== ''
        ? specPrompt
        : null;
  // A quiz/predict unit's question arrives as its instructions (server
  // contract); promote the first chunk (with any code fence it holds) to the pane.
  let rest = chunks;
  if (prompt === null && (detail.unit.kind === 'quiz' || detail.unit.kind === 'predict-output') && rest.length > 0) {
    prompt = rest[0]!;
    rest = rest.slice(1);
  }
  return { instructions: rest.join('\n\n'), prompt };
}
