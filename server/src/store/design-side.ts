import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DESIGN_DIMENSIONS, type DesignDimension } from '@bootquest/shared/api-ext';
import { HeadlinesFile } from './keyideas.ts';
import { DEFAULT_CONTENT_DIR } from './routing.ts';

/**
 * rv2 S3 (PLAN F5): the DESIGN IT side data the dimension profile reads, from `content/design/headlines.json`
 * (S2 C2). S1's reader (store/keyideas.ts) keeps only each key point's headline text for the ebmiss card fronts;
 * this one keeps its `dimension`. Same file, same envelope schema (S1's HeadlinesFile), same rules:
 *
 *   sets[<unit key or question-set key>] = [[entry per key point] per question] | { "q1k2": entry }
 *   entry = { headline, dimension, repoSpecific } | "headline text" | null
 *
 * Server-local, never stamped, never fingerprinted. Loading never refuses startup: no file = no dimensions (every
 * key point counts as unclassified); a malformed file is warned once and ignored; an entry without a known
 * dimension is simply unclassified. Lazily read on first use from BOOTQUEST_KEYIDEAS (a content dir, as S1's
 * store); unset = the repo's content/; '' or 'off' = nothing. Tests install their own with setDesignSide().
 */

export interface DesignSide {
  /** the file was found and parsed */
  loaded: boolean;
  /** "<set or unit key>#q<i>k<j>" -> dimension */
  dimensions: ReadonlyMap<string, DesignDimension>;
  /** the file's own dimension definitions (top-level `dimensions`), when present */
  descriptions: ReadonlyMap<DesignDimension, string>;
  problems: readonly string[];
}

export const EMPTY_DESIGN_SIDE: DesignSide = { loaded: false, dimensions: new Map(), descriptions: new Map(), problems: [] };

const KNOWN = new Set<string>(DESIGN_DIMENSIONS);
const isDimension = (v: unknown): v is DesignDimension => typeof v === 'string' && KNOWN.has(v);
const Descriptions = z.record(z.string(), z.string()).optional();

/** Build the side data from a parsed headlines file (exported for tests). */
export function designSideFrom(raw: unknown): DesignSide {
  const file = HeadlinesFile.parse(raw);
  const dimensions = new Map<string, DesignDimension>();
  const dimOf = (e: unknown): DesignDimension | undefined =>
    e !== null && typeof e === 'object' && isDimension((e as { dimension?: unknown }).dimension) ? (e as { dimension: DesignDimension }).dimension : undefined;
  for (const [setKey, v] of Object.entries(file.sets)) {
    if (Array.isArray(v)) {
      v.forEach((q, qi) =>
        q.forEach((e, ki) => {
          const d = dimOf(e);
          if (d) dimensions.set(`${setKey}#q${qi + 1}k${ki + 1}`, d);
        }),
      );
    } else {
      for (const [kp, e] of Object.entries(v)) {
        const d = dimOf(e);
        if (d && /^q\d+k\d+$/.test(kp)) dimensions.set(`${setKey}#${kp}`, d);
      }
    }
  }
  const descriptions = new Map<DesignDimension, string>();
  const desc = Descriptions.safeParse((raw as { dimensions?: unknown }).dimensions);
  if (desc.success && desc.data) for (const [k, t] of Object.entries(desc.data)) if (isDimension(k)) descriptions.set(k, t);
  return { loaded: true, dimensions, descriptions, problems: [] };
}

/** Read content/design/headlines.json from a content dir. Missing = nothing; malformed = a problem (ignored). */
export function readDesignSide(contentDir: string): DesignSide {
  const path = join(contentDir, 'design', 'headlines.json');
  if (!existsSync(path)) return EMPTY_DESIGN_SIDE;
  try {
    return designSideFrom(JSON.parse(readFileSync(path, 'utf8')));
  } catch (err) {
    const m = (err instanceof Error ? err.message : String(err)).slice(0, 240).replace(/\s+/g, ' ');
    return { ...EMPTY_DESIGN_SIDE, problems: [`design/headlines.json is malformed (ignored: no dimension profile): ${m}`] };
  }
}

let installed: DesignSide | undefined;

/** The design side data in force (lazily loaded; see the header). */
export function designSide(): DesignSide {
  if (installed === undefined) {
    const env = process.env.BOOTQUEST_KEYIDEAS;
    if (env !== undefined && (env.trim() === '' || env.trim() === 'off')) installed = EMPTY_DESIGN_SIDE;
    else installed = readDesignSide(env !== undefined ? env.trim() : DEFAULT_CONTENT_DIR);
    for (const p of installed.problems) console.warn(`[bootquest api] design side: ${p}`);
  }
  return installed;
}

/** Install side data (tests; null = reload lazily from the environment on next use). */
export function setDesignSide(s: DesignSide | null): void {
  installed = s ?? undefined;
}

/** The dimension of one key point: by the set key first, then by the unit key (S2 keys sets by unit key). */
export function kpDimension(side: DesignSide, setKey: string, unitKey: string, kpId: string): DesignDimension | undefined {
  return side.dimensions.get(`${setKey}#${kpId}`) ?? side.dimensions.get(`${unitKey}#${kpId}`);
}
