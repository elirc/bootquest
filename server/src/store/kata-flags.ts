import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_CONTENT_DIR } from './routing.ts';

/**
 * rv3 S5 (PLAN W9 / F10, ruling 6): the kata precision flags, `content/seed/kata-flags.json`
 * (bootquest-kata-flags@1, built by tools/seed/authoring/katas/kata-flags.mjs from the kata specs). Server-local,
 * never stamped, never fingerprinted: seed:patches cannot carry these fields (its draft schema is strict and the
 * factory is bound; rv3 S4 deviation 1).
 *
 *   clean: true   the PR has no defect; approve is the right verdict and any finding fails. Its key holds ONE
 *                 `in: 'repo'` entry: the shipped defect the PR FIXES, never a defect of the PR (shown as such).
 *   decoys        nit-only lines of the patched files: a finding on one of them is a false positive.
 *
 * Keyed by the seed kata key (`check.spec.kataKey`). A kata that is not listed is scored exactly as before (rv B:
 * G1 counts the patched-line defects). Loading never refuses startup: a missing file is "no flags", a malformed one
 * is a problem (warned once, ignored). Lazily on first use from BOOTQUEST_KATA_FLAGS (a content dir); unset = the
 * repo's content/, except inside a vitest run (nothing; tests install their own with setKataFlags, as rv3 MF-10 does
 * for the key ideas); '' or 'off' = no flags.
 */

export const KATA_FLAGS_FORMAT = 'bootquest-kata-flags@1' as const;

const Decoy = z
  .object({
    path: z.string().min(1),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    in: z.literal('patched'),
    why: z.string().min(1),
  })
  .strict()
  .refine((d) => d.lineEnd >= d.lineStart, 'lineEnd < lineStart');

const KataFlagEntry = z
  .object({
    unitKey: z.string().min(1),
    pack: z.string().min(1),
    title: z.string().min(1),
    pattern: z.enum(['clean', 'decoys']),
    clean: z.literal(true).optional(),
    decoys: z.array(Decoy).min(1).optional(),
    note: z.string().optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.pattern === 'clean' && (e.clean !== true || e.decoys !== undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a clean kata has clean: true and no decoys' });
    if (e.pattern === 'decoys' && (e.decoys === undefined || e.clean !== undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a decoy kata has decoys and no clean field' });
  });

export const KataFlagsFile = z
  .object({
    format: z.literal(KATA_FLAGS_FORMAT),
    _note: z.string().optional(),
    counts: z.object({ clean: z.number().int().min(0), decoyKatas: z.number().int().min(0), decoyLines: z.number().int().min(0) }).strict(),
    katas: z.record(z.string().min(1), KataFlagEntry),
  })
  .strict()
  .superRefine((f, ctx) => {
    const es = Object.values(f.katas);
    const got = {
      clean: es.filter((e) => e.pattern === 'clean').length,
      decoyKatas: es.filter((e) => e.pattern === 'decoys').length,
      decoyLines: es.reduce((n, e) => n + (e.decoys?.length ?? 0), 0),
    };
    if (got.clean !== f.counts.clean || got.decoyKatas !== f.counts.decoyKatas || got.decoyLines !== f.counts.decoyLines) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `counts ${JSON.stringify(f.counts)} do not match the entries ${JSON.stringify(got)}` });
    }
  });
export type KataFlagsFile = z.infer<typeof KataFlagsFile>;

/** One decoy line as the server serves it (after the answer only): `n1`, `n2`, ... in file order. */
export interface KataDecoy {
  id: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  why: string;
}

/** A flagged kata: clean (approve passes) or with decoys (a finding on one is a false positive). */
export interface KataFlag {
  unitKey: string;
  clean: boolean;
  decoys: readonly KataDecoy[];
}

export interface KataFlagsStore {
  byKey: ReadonlyMap<string, KataFlag>;
  problems: readonly string[];
}

export const EMPTY_KATA_FLAGS: KataFlagsStore = { byKey: new Map(), problems: [] };

export const decoyId = (i: number): string => `n${i + 1}`;

function toStore(file: KataFlagsFile, problems: string[] = []): KataFlagsStore {
  const byKey = new Map<string, KataFlag>();
  for (const [key, e] of Object.entries(file.katas)) {
    byKey.set(key, {
      unitKey: e.unitKey,
      clean: e.pattern === 'clean',
      decoys: (e.decoys ?? []).map((d, i) => ({ id: decoyId(i), path: d.path, lineStart: d.lineStart, lineEnd: d.lineEnd, why: d.why })),
    });
  }
  return { byKey, problems };
}

/** Read `<contentDir>/seed/kata-flags.json`; absent = no flags, malformed = no flags + a problem. */
export function readKataFlags(contentDir: string): KataFlagsStore {
  const p = join(contentDir, 'seed', 'kata-flags.json');
  if (!existsSync(p)) return EMPTY_KATA_FLAGS;
  try {
    return toStore(KataFlagsFile.parse(JSON.parse(readFileSync(p, 'utf8'))));
  } catch (err) {
    return { byKey: new Map(), problems: [`seed/kata-flags.json is malformed (ignored: every kata is scored as unflagged): ${err instanceof Error ? err.message : String(err)}`] };
  }
}

/** Build a store in memory (tests): validated exactly as on disk. */
export function makeKataFlags(file: unknown): KataFlagsStore {
  return toStore(KataFlagsFile.parse(file));
}

/** Where the flags load from when nothing is installed, or null = none (see the header). */
export function kataFlagsDir(): string | null {
  const env = process.env.BOOTQUEST_KATA_FLAGS;
  if (env !== undefined) return env.trim() === '' || env.trim() === 'off' ? null : env.trim();
  return process.env.VITEST ? null : DEFAULT_CONTENT_DIR;
}

let installed: KataFlagsStore | undefined;

/** The kata flags in force (lazily loaded). */
export function kataFlags(): KataFlagsStore {
  if (installed === undefined) {
    const dir = kataFlagsDir();
    installed = dir === null ? EMPTY_KATA_FLAGS : readKataFlags(dir);
    for (const p of installed.problems) console.warn(`[bootquest api] kata-flags: ${p}`);
  }
  return installed;
}

/** Install a store (tests; null = reload lazily from the environment on next use). */
export function setKataFlags(s: KataFlagsStore | null): void {
  installed = s ?? undefined;
}

/** The flag of a seed kata key, or undefined = unflagged (scored as before). */
export function kataFlagFor(kataKey: string): KataFlag | undefined {
  return kataFlags().byKey.get(kataKey);
}

/**
 * Does a finding's evidence text cite a line of this decoy? A citation is `<path or file name>:<line>` or
 * `:<a>-<b>`; it hits when the file matches (the full path, or its last segment) and the cited range overlaps the
 * decoy's. Only a SUGGESTION for the learner's own mark (the self-score decides), never a grade.
 */
export function citesDecoy(evidence: string, d: Pick<KataDecoy, 'path' | 'lineStart' | 'lineEnd'>): boolean {
  const base = d.path.split('/').pop()!;
  const re = /([A-Za-z0-9_./-]+):(\d+)(?:\s*-\s*(\d+))?/g;
  for (const m of evidence.matchAll(re)) {
    const file = m[1]!;
    if (!(file === d.path || file.endsWith(`/${d.path}`) || d.path.endsWith(`/${file}`) || file === base)) continue;
    const a = Number(m[2]);
    const b = m[3] !== undefined ? Number(m[3]) : a;
    if (Math.min(a, b) <= d.lineEnd && Math.max(a, b) >= d.lineStart) return true;
  }
  return false;
}
