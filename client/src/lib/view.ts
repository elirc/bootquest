// Client-only display helpers over the server contract. Nothing here computes a number the
// server owns (XP, level, streak); these are labels and presentation constants only.

import type { CompetencyId, PublicCheck, TrackId, TrackProgress, UnitDetail } from '../api/types';
// TYPE-only on purpose: shared/src/enums.ts builds zod enums at module load, and a value import
// would put zod (~55 kB) in the bundle (vite.config: the client imports only TYPES from shared).
import type { COMPETENCY_IDS as SHARED_COMPETENCY_IDS, TRACK_IDS as SHARED_TRACK_IDS } from '../../../shared/src/enums.ts';
import { localDayKey } from './format';
import { proseChunks } from './prose';

/**
 * Every TrackId in the server's order (shared/src/enums.ts TRACK_IDS = track.sort_order).
 * `satisfies typeof` the shared tuple: a reorder, rename, addition or removal there fails the
 * typecheck here, so this can never drift (fix/client-dash: it had agentic before java).
 */
export const TRACK_IDS = ['js', 'csharp', 'java', 'agentic', 'sysdesign'] as const satisfies typeof SHARED_TRACK_IDS;

/** Every CompetencyId in the server's order; held to shared/src/enums.ts COMPETENCY_IDS the same way. */
export const COMPETENCY_IDS = [
  'language-fluency',
  'feature-delivery',
  'data-http',
  'testing-verification',
  'agentic-engineering',
  'code-reading',
  'communication',
  'system-design',
] as const satisfies typeof SHARED_COMPETENCY_IDS;

/** Display names (exhaustive over CompetencyId); the dashboard rows carry the server's own `name`. */
export const COMPETENCY_LABEL: Record<CompetencyId, string> = {
  'language-fluency': 'Language fluency',
  'feature-delivery': 'Feature delivery',
  'data-http': 'Data & HTTP',
  'testing-verification': 'Testing & verification',
  'agentic-engineering': 'Agentic engineering',
  'code-reading': 'Code reading & maintenance',
  communication: 'Communication',
  'system-design': 'System design',
};

export const isCompetencyId = (v: string | null | undefined): v is CompetencyId => (COMPETENCY_IDS as readonly string[]).includes(v ?? '');

/** The display name of a competency id; an id this client does not know yet shows as itself. */
export const competencyLabel = (c: CompetencyId): string => (COMPETENCY_LABEL as Partial<Record<string, string>>)[c] ?? c;

/**
 * Tracks whose daily slate USUALLY carries a drill set (track.slate_drills = 1 as seeded:
 * migrations 002 + 011 + 016). Presentation only, and a client-side guess: an unlocked one missing from
 * today's slate may be out of drills OR have had slate_drills switched off, so the dashboard says
 * neutrally that there is no drill slot today and never asserts why.
 */
export const SLATE_DRILL_TRACKS: readonly TrackId[] = ['js', 'csharp', 'java', 'sysdesign'];

export const TRACK_LABEL: Record<TrackId, string> = { js: 'JS/TS', csharp: 'C#/.NET', agentic: 'Agentic', java: 'Java', sysdesign: 'System design' };
/** Short badge text (W-13b: the server has no `short`; this is presentation only). */
export const TRACK_SHORT: Record<TrackId, string> = { js: 'JS', csharp: 'C#', agentic: 'AG', java: 'JV', sysdesign: 'SD' };

/**
 * W9 (ui-audit #4): what the sidebar and campaign tabs show while GET /tracks is in flight — the
 * server's own order (track.sort_order) and names, so nothing reorders or relabels on arrival.
 */
export const TRACK_PLACEHOLDER: readonly { id: TrackId; name: string; locked: boolean }[] = [
  { id: 'js', name: 'JS/TS + React', locked: false },
  { id: 'csharp', name: 'C#/.NET', locked: false },
  { id: 'java', name: 'Java', locked: false },
  { id: 'agentic', name: 'Agentic engineering', locked: false },
  { id: 'sysdesign', name: 'System design', locked: false },
];

export const isTrackId = (v: string | undefined): v is TrackId => (TRACK_IDS as readonly string[]).includes(v ?? '');

/**
 * Spec §streak: at most 2 freeze tokens are banked. The dashboard response carries only the
 * banked count (`streak.tokens`), not the cap, so the cap is a display constant here.
 */
export const FREEZE_TOKENS_MAX = 2;

/** 'YYYY-MM-DD' of an epoch-ms timestamp in the owner's local day (the server's day basis). */
export const dayOfMs = localDayKey;

const LANGUAGE_LABEL: Record<string, string> = { js: 'JavaScript', ts: 'TypeScript', sql: 'SQL', cs: 'C#' };

/** Editor language label from the public check spec (W-14d: language lives in spec, not on the unit). */
export function languageOf(spec: PublicCheck | null | undefined): string | null {
  if (!spec) return null;
  if (spec.type === 'drill-cs') return 'C#';
  if (spec.type === 'drill-java') return 'Java';
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

/** The factory's title for a guide with no headings (tools/seed quests parse); never shown as-is. */
export const UNTITLED_GUIDE = '(untitled guide)';

/**
 * W10: a reading item titled with the factory placeholder shows the guide's file name instead
 * (client-only fallback; the seeded title itself is untouched). Any other title is returned as is.
 */
export function readingTitle(title: string, path: string): string {
  if (title.trim() !== UNTITLED_GUIDE) return title;
  const base = path.split(/[\\/]/).filter((p) => p !== '').pop();
  return base ?? title;
}

/**
 * W10 (ui-audit #8): what the unit's own data says about where a campaign quest unit comes from.
 * Campaign quest units are keyed `campaign/<track>/<repo>` by the campaign seeder; anything else
 * yields null (we never guess a source the unit does not name).
 */
export function campaignSourceOf(unitKey: string): { trackId: string; repo: string } | null {
  const m = /^campaign\/([^/]+)\/(.+)$/.exec(unitKey);
  return m ? { trackId: m[1]!, repo: m[2]! } : null;
}

/**
 * Campaign 2 B2 (ui-audit #26): the ONE tooltip text for a track's percentage. The number itself
 * is server-computed (TrackProgress in shared/src/api.ts); the sidebar, the campaign page and the
 * stats page all show it with this explanation, so they agree by construction.
 */
export function progressTitle(p: TrackProgress): string {
  const core = `Campaign core quests: ${p.coreDone}/${p.coreTotal}`;
  const practice = `practice units: ${p.practiceDone}/${p.practiceTotal}`;
  if (p.basis === 'campaign-core') return `${p.pct}% = campaign core quests done (${p.coreDone}/${p.coreTotal}, all acts, content-pending included). Practice units: ${p.practiceDone}/${p.practiceTotal}, not counted in the %.`;
  if (p.basis === 'practice') return `${p.pct}% = practice units done (${p.practiceDone}/${p.practiceTotal}); this track has no campaign core quests.`;
  return `No progress counted (${core}; ${practice}).`;
}

/** The percentage as shown: '<1%' once something counted is done but the floor is still 0; '–' when nothing is counted. */
export function progressLabel(p: TrackProgress): string {
  if (p.basis === 'none') return '–';
  const done = p.basis === 'campaign-core' ? p.coreDone : p.practiceDone;
  return p.pct === 0 && done > 0 ? '<1%' : `${p.pct}%`;
}
