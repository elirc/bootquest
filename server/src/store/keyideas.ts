import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_CONTENT_DIR } from './routing.ts';

/**
 * rv2 S1 (PLAN §2.1): the key-ideas layer's side files. Server-local, never stamped, never fingerprinted.
 *
 *   content/keyideas/<section>.json   bootquest-keyideas@1: one section (scope = unit keys / "/"-prefixes, the
 *                                     same prefix rule as content/paths/*.json) and its 5-12 ideas. Each idea
 *                                     names the units that teach it (`sources`) and the drills that exercise
 *                                     it (`siblings`, used by redo cards). The S2 lint (seed:lint:keyideas)
 *                                     holds the content to the contract; this reader only refuses what it
 *                                     cannot use.
 *   content/seed/card-tags.json       bootquest-card-tags@1 (F3): flashcard item keys tagged `repo-recall`
 *                                     (or listed in `noEnrol`) are never enrolled into FSRS. Absent = no filter.
 *   content/design/headlines.json     bootquest-headlines@1 (F2 ebmiss fronts): a <= 12-word headline per key
 *                                     point of a DESIGN IT / G2 set. Absent = the generic headline.
 *
 * Loading never refuses startup: a missing dir/file is "nothing", a malformed file is a problem (warned once,
 * the file skipped). Lazily on first use from BOOTQUEST_KEYIDEAS (a content dir); unset = the repo's content/;
 * '' or 'off' = nothing at all. Tests install their own with setKeyIdeas().
 */

export const KEYIDEAS_FORMAT = 'bootquest-keyideas@1' as const;
export const DEFAULT_RECAP_AFTER = 0.8;

const kebab = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case');

export const KeyIdea = z
  .object({
    id: kebab,
    idea: z.string().min(1),
    why: z.string().min(1),
    prompt: z.string().min(1),
    answer: z.string().min(1),
    tags: z.array(z.string().min(1)),
    sources: z.array(z.string().min(1)).min(1),
    siblings: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type KeyIdea = z.infer<typeof KeyIdea>;

/**
 * `recapAfter`: a fraction in (0, 1] of the section's live, non-archived scope units that must be passed before
 * the recap opens (default 0.8), OR an integer >= 2: that many passed scope units (the campaign tag sections'
 * "any 3 sources passed").
 */
export const RecapAfter = z.number().positive().refine((n) => n <= 1 || Number.isInteger(n), 'a fraction <= 1 or a whole count >= 2');

export const KeyIdeasFile = z
  .object({
    format: z.literal(KEYIDEAS_FORMAT),
    section: kebab,
    title: z.string().min(1),
    track: z.string().min(1),
    _note: z.string().optional(),
    scope: z.array(z.string().min(1)).min(1),
    recapAfter: RecapAfter.optional(),
    ideas: z.array(KeyIdea).min(1),
  })
  .strict()
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    for (const i of f.ideas) {
      if (seen.has(i.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate idea id ${i.id}` });
      seen.add(i.id);
    }
  });
export type KeyIdeasFile = z.infer<typeof KeyIdeasFile>;

export const CardTagsFile = z
  .object({
    format: z.literal('bootquest-card-tags@1'),
    _note: z.string().optional(),
    /** flashcard item key -> tags; a card tagged `repo-recall` is not enrolled */
    tags: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
    /** flashcard item keys never enrolled, whatever their tags */
    noEnrol: z.array(z.string().min(1)).default([]),
  })
  .strict();

/** Tags that keep a flashcard out of FSRS (R2-05 / M7). */
export const NO_ENROL_TAGS: readonly string[] = ['repo-recall'];

const HeadlineEntry = z.union([z.string().min(1), z.object({ headline: z.string().min(1) }).passthrough()]);
/**
 * Keyed by the explain-back question-set key (or the ladder unit key); per set either an array per question of
 * an array per key point, or a record keyed by key-point id ("q1k2").
 */
export const HeadlinesFile = z
  .object({
    format: z.literal('bootquest-headlines@1'),
    _note: z.string().optional(),
    sets: z.record(z.string().min(1), z.union([z.array(z.array(HeadlineEntry.nullable())), z.record(z.string(), HeadlineEntry)])),
  })
  .passthrough();

export interface KeyIdeasStore {
  /** section id -> file (file order: by file name) */
  sections: ReadonlyMap<string, KeyIdeasFile>;
  /** flashcard item keys kept out of FSRS (F3) */
  noEnrol: ReadonlySet<string>;
  /** "<set or unit key>#q<i>k<j>" -> headline */
  headlines: ReadonlyMap<string, string>;
  /** load-time problems (bad files, skipped) */
  problems: readonly string[];
}

export const EMPTY_KEYIDEAS: KeyIdeasStore = { sections: new Map(), noEnrol: new Set(), headlines: new Map(), problems: [] };

const msg = (err: unknown): string => (err instanceof Error ? err.message.slice(0, 240) : String(err)).replace(/\s+/g, ' ');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function headlineMap(file: z.infer<typeof HeadlinesFile>): Map<string, string> {
  const out = new Map<string, string>();
  const text = (e: z.infer<typeof HeadlineEntry> | null | undefined): string | undefined => (e == null ? undefined : typeof e === 'string' ? e : e.headline);
  for (const [setKey, v] of Object.entries(file.sets)) {
    if (Array.isArray(v)) {
      v.forEach((q, qi) =>
        q.forEach((e, ki) => {
          const t = text(e);
          if (t) out.set(`${setKey}#q${qi + 1}k${ki + 1}`, t);
        }),
      );
    } else {
      for (const [kp, e] of Object.entries(v)) {
        const t = text(e);
        if (t && /^q\d+k\d+$/.test(kp)) out.set(`${setKey}#${kp}`, t);
      }
    }
  }
  return out;
}

/** Read the three side files from a content dir. Missing = nothing; malformed = a problem (skipped). */
export function readKeyIdeas(contentDir: string): KeyIdeasStore {
  const problems: string[] = [];
  const sections = new Map<string, KeyIdeasFile>();
  const dir = join(contentDir, 'keyideas');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      try {
        const file = KeyIdeasFile.parse(readJson(join(dir, f)));
        if (file.section !== basename(f, '.json')) throw new Error(`section "${file.section}" does not match the file name`);
        if (sections.has(file.section)) throw new Error(`section "${file.section}" is defined twice`);
        sections.set(file.section, file);
      } catch (err) {
        problems.push(`keyideas/${f} is malformed (skipped): ${msg(err)}`);
      }
    }
  }
  const noEnrol = new Set<string>();
  const tagsPath = join(contentDir, 'seed', 'card-tags.json');
  if (existsSync(tagsPath)) {
    try {
      const t = CardTagsFile.parse(readJson(tagsPath));
      for (const k of t.noEnrol) noEnrol.add(k);
      for (const [k, tags] of Object.entries(t.tags)) if (tags.some((x) => NO_ENROL_TAGS.includes(x))) noEnrol.add(k);
    } catch (err) {
      problems.push(`seed/card-tags.json is malformed (ignored: every flashcard enrols): ${msg(err)}`);
    }
  }
  let headlines = new Map<string, string>();
  const hPath = join(contentDir, 'design', 'headlines.json');
  if (existsSync(hPath)) {
    try {
      headlines = headlineMap(HeadlinesFile.parse(readJson(hPath)));
    } catch (err) {
      problems.push(`design/headlines.json is malformed (ignored: generic headlines): ${msg(err)}`);
    }
  }
  return { sections, noEnrol, headlines, problems };
}

let installed: KeyIdeasStore | undefined;
const warned = new Set<string>();

/** The key-ideas store in force (lazily loaded; see the header). */
export function keyIdeas(): KeyIdeasStore {
  if (installed === undefined) {
    const env = process.env.BOOTQUEST_KEYIDEAS;
    if (env !== undefined && (env.trim() === '' || env.trim() === 'off')) installed = EMPTY_KEYIDEAS;
    else installed = readKeyIdeas(env !== undefined ? env.trim() : DEFAULT_CONTENT_DIR);
    for (const p of installed.problems) console.warn(`[bootquest api] keyideas: ${p}`);
  }
  return installed;
}

/** Install a store (tests; null = reload lazily from the environment on next use). Resets the warn-once memory. */
export function setKeyIdeas(s: KeyIdeasStore | null): void {
  installed = s ?? undefined;
  warned.clear();
}

/** Build a store in memory (tests): files are validated exactly as on disk. */
export function makeKeyIdeas(files: readonly unknown[], opts: { noEnrol?: readonly string[]; headlines?: Record<string, string> } = {}): KeyIdeasStore {
  const sections = new Map<string, KeyIdeasFile>();
  for (const f of files) {
    const file = KeyIdeasFile.parse(f);
    sections.set(file.section, file);
  }
  return { sections, noEnrol: new Set(opts.noEnrol ?? []), headlines: new Map(Object.entries(opts.headlines ?? {})), problems: [] };
}

/** Warn once per process per message key (unknown scope / source / sibling keys). */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[bootquest api] keyideas: ${message}`);
}
