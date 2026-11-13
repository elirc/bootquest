import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Db } from '../db/database.ts';

/**
 * rv wave stream C: routing side files (server-local, NOT stamped packs, so no restamp).
 *
 *   content/archive.json (REVIEW Q4 / D8): unit keys (and key prefixes ending in "/") that are hidden
 *     from the slate, the hero, next-up, path pickers and the default track / campaign lists. Their
 *     campaign quests also leave core counting (engines/campaign.ts), so an act never waits on a quest
 *     nobody is shown. Nothing is deleted: the units stay live, searchable (Ctrl+K) and listed under the
 *     client's "Archived" toggle. A key that content/fundamentals/related.json points at is NEVER
 *     archived (it is skipped with a warning): the Fundamentals "More practice" pool stays whole.
 *   content/paths/<track>.json (R3-08 / R5-03): an ordered list of steps, each an ordered list of unit
 *     keys (a key ending in "/" expands to every live unit under it, in served order). Next-up, the
 *     senior-rep slot and the track browser walk them. Unknown keys are warned once and skipped, like
 *     related.json.
 *   content/campaign-titles.json (R4-11, R3-13): campaign quest titles by concept, keyed by quest key (the
 *     hash-checked generated campaign files are never edited).
 *
 * Loading: lazily on first use from BOOTQUEST_ROUTING (a content dir holding archive.json + paths/);
 * unset = the repo's own content/ dir; '' or 'off' = no routing (an empty archive and no paths).
 * Tests install their own with setRouting().
 */

export const ArchiveFile = z
  .object({
    format: z.literal('bootquest-archive@1'),
    _note: z.string().optional(),
    groups: z.array(
      z
        .object({ id: z.string().min(1), reason: z.string(), count: z.number().int().optional(), keys: z.array(z.string().min(1)) })
        .strict(),
    ),
  })
  .strict();
export type ArchiveFile = z.infer<typeof ArchiveFile>;

export const PathFile = z
  .object({
    format: z.literal('bootquest-path@1'),
    track: z.string().min(1),
    _note: z.string().optional(),
    steps: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), keys: z.array(z.string().min(1)) }).strict()).min(1),
  })
  .strict();
export type PathFile = z.infer<typeof PathFile>;

export interface Routing {
  /** exact archived unit keys (related.json keys already removed) */
  archivedKeys: ReadonlySet<string>;
  /** archived key prefixes (each ends in "/") */
  archivedPrefixes: readonly string[];
  /** per track id: the path's steps */
  paths: ReadonlyMap<string, PathFile['steps']>;
  /** quest key -> concept title (content/campaign-titles.json, R4-11) */
  campaignTitles: ReadonlyMap<string, string>;
  /** load-time problems (bad files, related.json keys refused) */
  problems: readonly string[];
}

export const EMPTY_ROUTING: Routing = { archivedKeys: new Set(), archivedPrefixes: [], paths: new Map(), campaignTitles: new Map(), problems: [] };

export const CampaignTitlesFile = z
  .object({ format: z.literal('bootquest-campaign-titles@1'), _note: z.string().optional(), titles: z.record(z.string().min(1), z.string().min(1).max(120)) })
  .strict();

export const DEFAULT_CONTENT_DIR = fileURLToPath(new URL('../../../content/', import.meta.url));

/** Every key content/fundamentals/related.json points at (exempt from the archive). */
function relatedKeys(contentDir: string): Set<string> {
  const f = join(contentDir, 'fundamentals', 'related.json');
  const out = new Set<string>();
  if (!existsSync(f)) return out;
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(JSON.parse(readFileSync(f, 'utf8')));
  return out;
}

/** Read archive.json + paths/*.json from a content dir (missing files = nothing routed; malformed = a problem, skipped). */
export function readRouting(contentDir: string): Routing {
  const problems: string[] = [];
  const exempt = relatedKeys(contentDir);
  const keys = new Set<string>();
  const prefixes: string[] = [];
  const archivePath = join(contentDir, 'archive.json');
  if (existsSync(archivePath)) {
    try {
      const a = ArchiveFile.parse(JSON.parse(readFileSync(archivePath, 'utf8')));
      for (const g of a.groups) {
        for (const k of g.keys) {
          if (exempt.has(k)) problems.push(`archive ${g.id}: ${k} is a related.json key (never archived; skipped)`);
          else if (k.endsWith('/')) prefixes.push(k);
          else keys.add(k);
        }
      }
    } catch (err) {
      problems.push(`archive.json is malformed (ignored): ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    }
  }
  const paths = new Map<string, PathFile['steps']>();
  const pathDir = join(contentDir, 'paths');
  if (existsSync(pathDir)) {
    for (const f of readdirSync(pathDir).filter((n) => n.endsWith('.json')).sort()) {
      try {
        const p = PathFile.parse(JSON.parse(readFileSync(join(pathDir, f), 'utf8')));
        paths.set(p.track, p.steps);
      } catch (err) {
        problems.push(`paths/${f} is malformed (ignored): ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
      }
    }
  }
  const campaignTitles = new Map<string, string>();
  const titlesPath = join(contentDir, 'campaign-titles.json');
  if (existsSync(titlesPath)) {
    try {
      for (const [k, v] of Object.entries(CampaignTitlesFile.parse(JSON.parse(readFileSync(titlesPath, 'utf8'))).titles)) campaignTitles.set(k, v);
    } catch (err) {
      problems.push(`campaign-titles.json is malformed (ignored): ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    }
  }
  return { archivedKeys: keys, archivedPrefixes: prefixes, paths, campaignTitles, problems };
}

let installed: Routing | undefined;

/** The routing in force (lazily loaded; see the header). */
export function routing(): Routing {
  if (installed === undefined) {
    const env = process.env.BOOTQUEST_ROUTING;
    if (env !== undefined && (env.trim() === '' || env.trim() === 'off')) installed = EMPTY_ROUTING;
    else installed = readRouting(env !== undefined ? env.trim() : DEFAULT_CONTENT_DIR);
    for (const p of installed.problems) console.warn(`[bootquest api] routing: ${p}`);
  }
  return installed;
}

/** Install a routing (tests; null = reload lazily from the environment on next use). */
export function setRouting(r: Routing | null): void {
  installed = r ?? undefined;
  warnedUnknown = false;
}

/** Build a Routing in memory (tests). */
export function makeRouting(archive: readonly string[], paths: Record<string, PathFile['steps']> = {}): Routing {
  return {
    archivedKeys: new Set(archive.filter((k) => !k.endsWith('/'))),
    archivedPrefixes: archive.filter((k) => k.endsWith('/')),
    paths: new Map(Object.entries(paths)),
    campaignTitles: new Map(),
    problems: [],
  };
}

/** Is a unit key archived? */
export function isArchivedKey(key: string, r: Routing = routing()): boolean {
  return r.archivedKeys.has(key) || r.archivedPrefixes.some((p) => key.startsWith(p));
}

/** Live unit ids whose key is archived (one DB read). */
export function archivedUnitIds(db: Db, r: Routing = routing()): Set<number> {
  const out = new Set<number>();
  if (r.archivedKeys.size === 0 && r.archivedPrefixes.length === 0) return out;
  for (const u of db.all<{ id: number; key: string }>('SELECT id, key FROM unit WHERE retired_at IS NULL')) if (isArchivedKey(u.key, r)) out.add(u.id);
  return out;
}

export interface ResolvedStep {
  id: string;
  title: string;
  /** live, non-archived unit ids in path order */
  unitIds: number[];
}

let warnedUnknown = false;

/**
 * A track's path resolved against the DB: each step's keys -> live unit ids (prefix keys expand in id
 * order), archived units and unknown keys skipped (unknown keys warned once per process), a unit
 * listed twice kept at its first place. null = the track has no path.
 */
export function resolvePath(db: Db, trackId: string, r: Routing = routing()): ResolvedStep[] | null {
  const steps = r.paths.get(trackId);
  if (!steps) return null;
  const units = db.all<{ id: number; key: string }>('SELECT id, key FROM unit WHERE retired_at IS NULL ORDER BY id');
  const byKey = new Map(units.map((u) => [u.key, u.id]));
  const seen = new Set<number>();
  const unknown: string[] = [];
  const out = steps.map((s) => {
    const ids: number[] = [];
    for (const k of s.keys) {
      const hits = k.endsWith('/') ? units.filter((u) => u.key.startsWith(k)).map((u) => u.id) : byKey.has(k) ? [byKey.get(k)!] : [];
      if (hits.length === 0) unknown.push(k);
      for (const id of hits) {
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
    return { id: s.id, title: s.title, unitIds: ids };
  });
  const archived = archivedUnitIds(db, r);
  for (const s of out) s.unitIds = s.unitIds.filter((id) => !archived.has(id));
  if (unknown.length && !warnedUnknown && units.length > 0) {
    warnedUnknown = true;
    console.warn(`[bootquest api] routing: paths/${trackId}: ${unknown.length} key(s) skipped: ${unknown.slice(0, 5).join('; ')}${unknown.length > 5 ? '; ...' : ''}`);
  }
  return out;
}
