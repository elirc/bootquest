import { z } from 'zod';
import { UnitContentEntry } from './api.ts';
import { LessonSpec } from './schemas.ts';

/**
 * Imported content packs (W2, spec §3.1). A pack is committed JSON under
 * content/packs/<source>/: one file per course plus manifest.json. Packs are
 * the store of record for imported content; the server's content loader
 * upserts their units into the DB at startup (keyed by source + stable key)
 * and serves their per-unit content from memory.
 *
 * Curriculum text (instructions, lesson explanations, solutions) stays in the
 * pack files and the in-memory content store — never in DB columns.
 */

export const PACK_FORMAT = 'bootquest-pack@1' as const;

/** Upstream exercise types a pack may carry (BootForge vocabulary). */
export const PACK_ORIGIN_TYPES = ['code', 'quiz', 'output', 'written'] as const;
export const PackOriginType = z.enum(PACK_ORIGIN_TYPES);
export type PackOriginType = z.infer<typeof PackOriginType>;

export const PackCounts = z
  .object({
    total: z.number().int().nonnegative(),
    code: z.number().int().nonnegative(),
    quiz: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    written: z.number().int().nonnegative(),
  })
  .strict()
  .refine((c) => c.total === c.code + c.quiz + c.output + c.written, { message: 'total must equal the sum of the per-type counts' });
export type PackCounts = z.infer<typeof PackCounts>;

/** Where a pack unit came from upstream (kept for traceability; not loaded into the DB). */
export const PackOrigin = z
  .object({
    /** upstream exercise id, e.g. "js-fundamentals/control-flow/switch-and-ternary/yes-no" */
    id: z.string().min(1),
    type: PackOriginType,
    module: z.string().min(1),
    lesson: z.string().min(1),
    /** position of the exercise inside the course (0-based, upstream order) */
    position: z.number().int().nonnegative(),
    xp: z.number().int().nonnegative().optional(),
    format: z.string().min(1).optional(),
    reviewOf: z.string().min(1).optional(),
    skills: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type PackOrigin = z.infer<typeof PackOrigin>;

export const PackUnit = z
  .object({
    unit: LessonSpec,
    origin: PackOrigin,
  })
  .strict()
  .superRefine((u, ctx) => {
    const kindFor: Record<PackOriginType, string> = { code: 'drill', quiz: 'quiz', output: 'predict-output', written: 'written' };
    if (u.unit.kind !== kindFor[u.origin.type]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `origin type ${u.origin.type} must map to unit kind ${kindFor[u.origin.type]}`, path: ['unit', 'kind'] });
    }
    const checkType = u.unit.checks[0]?.spec.type;
    // code drills: drill-js (BootForge, JS track) or drill-cs (csbootcamp, C# track)
    const wantCheck: Record<PackOriginType, readonly string[]> = { code: ['drill-js', 'drill-cs'], quiz: ['quiz'], output: ['predict-output'], written: [] };
    if (u.unit.checks.length > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'pack units carry at most one check', path: ['unit', 'checks'] });
    }
    const allowed = wantCheck[u.origin.type];
    if (checkType === undefined ? allowed.length > 0 : !allowed.includes(checkType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `origin type ${u.origin.type} needs check ${allowed.join(' | ') || '(none)'}, got ${checkType ?? '(none)'}`,
        path: ['unit', 'checks'],
      });
    }
  });
export type PackUnit = z.infer<typeof PackUnit>;

export const PackLesson = z.object({ id: z.string().min(1), title: z.string().min(1), explanation: z.string() }).strict();
export const PackModule = z.object({ id: z.string().min(1), title: z.string().min(1), lessons: z.array(PackLesson) }).strict();

export const PackCourseFile = z
  .object({
    format: z.literal(PACK_FORMAT),
    source: z.string().min(1),
    course: z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
        order: z.number().int().positive(),
        title: z.string().min(1),
        description: z.string(),
        /**
         * Course ids that must come first. Empty when upstream encodes no
         * gating (BootForge: ordering only — see `order`).
         */
        prerequisites: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    modules: z.array(PackModule).min(1),
    units: z.array(PackUnit).min(1),
    /** per-unit content keyed by unit key (see UnitContentEntry for field visibility) */
    content: z.record(z.string().min(1), UnitContentEntry),
  })
  .strict()
  .superRefine((p, ctx) => {
    const keys = new Set<string>();
    p.units.forEach((u, i) => {
      if (keys.has(u.unit.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate unit key ${u.unit.key}`, path: ['units', i] });
      keys.add(u.unit.key);
      if (!(u.unit.key in p.content)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `no content entry for ${u.unit.key}`, path: ['content'] });
    });
    for (const k of Object.keys(p.content)) {
      if (!keys.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `content entry ${k} has no unit`, path: ['content', k] });
    }
  });
export type PackCourseFile = z.infer<typeof PackCourseFile>;

export const PackManifestCourse = z
  .object({
    id: z.string().min(1),
    order: z.number().int().positive(),
    file: z.string().regex(/^[a-z0-9][a-z0-9-]*\.json$/),
    /** sha256 of the course file bytes as written (the loader refuses a mismatch) */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    counts: PackCounts,
  })
  .strict();

export const PackManifest = z
  .object({
    format: z.literal(PACK_FORMAT),
    source: z.string().min(1),
    track: z.string().min(1),
    importedFrom: z
      .object({
        /** owner/name of the upstream repo (may be local-only) */
        repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'owner/name'),
        /** 'local' = read from a local working tree, not GitHub */
        originKind: z.enum(['github', 'local-mirror', 'local']),
        /** pack root inside the upstream repo */
        subpath: z.string(),
        path: z.string().min(1),
        gitHead: z.string().nullable(),
        /** true when the upstream working tree had uncommitted changes (R1: we import the working tree) */
        dirty: z.boolean().nullable(),
      })
      .strict(),
    /** the counts the importer was told to expect (R1 recon); importer refuses a divergence */
    expected: PackCounts.nullable(),
    totals: PackCounts,
    courses: z.array(PackManifestCourse).min(1),
  })
  .strict()
  .superRefine((m, ctx) => {
    const sum = { total: 0, code: 0, quiz: 0, output: 0, written: 0 };
    for (const c of m.courses) for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += c.counts[k];
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) {
      if (sum[k] !== m.totals[k]) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `totals.${k}=${m.totals[k]} but courses sum to ${sum[k]}`, path: ['totals', k] });
    }
  });
export type PackManifest = z.infer<typeof PackManifest>;

/** Quarantine list written by seed:validate; the loader never ships these keys. */
export const PackQuarantine = z
  .object({
    format: z.literal(PACK_FORMAT),
    source: z.string().min(1),
    entries: z.array(z.object({ key: z.string().min(1), course: z.string().min(1), reason: z.string().min(1) }).strict()),
  })
  .strict();
export type PackQuarantine = z.infer<typeof PackQuarantine>;

/**
 * validation.json — the import-gate stamp (W2b/F1). seed:validate writes it
 * ONLY after a full-scope run (every course of the source) succeeded; any
 * other run removes it. The server's pack loader refuses a pack whose stamp is
 * missing or no longer matches the manifest bytes, the grader fingerprint or
 * the quarantine list, so "validated" and "never validated" can never look
 * the same on disk.
 */
export const PackValidationStamp = z
  .object({
    format: z.literal(PACK_FORMAT),
    source: z.string().min(1),
    /** sha256 of manifest.json's bytes at validation time */
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** grader + validator bytes + toolchain versions (server/src/store/grader-fingerprint.ts) */
    graderFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    /**
     * versions bound into the fingerprint: node + esbuild for the JS grader,
     * node + the .NET SDK (and reference-pack version) for the C# runner
     */
    toolchain: z
      .object({
        node: z.string().min(1),
        esbuild: z.string().min(1).optional(),
        dotnetSdk: z.string().min(1).optional(),
        dotnetRef: z.string().min(1).optional(),
      })
      .strict(),
    /** which grader the fingerprint covers (absent on stamps written before W3a = 'js') */
    graderKind: z.enum(['js', 'csharp']).optional(),
    /** validated per-type counts (=== manifest totals on a stamped run) */
    counts: PackCounts,
    executable: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    carveOut: z.number().int().nonnegative(),
    /** sorted; must equal quarantine.json's keys exactly */
    quarantinedKeys: z.array(z.string().min(1)),
    /** F4: journaled passes re-executed by the gating run */
    audit: z.object({ sampled: z.number().int().nonnegative(), mismatches: z.number().int().nonnegative() }).strict(),
    completedAt: z.string().min(1),
  })
  .strict();
export type PackValidationStamp = z.infer<typeof PackValidationStamp>;

/** Count units of a parsed course file by upstream type. */
export function countPackUnits(units: readonly { origin: { type: PackOriginType } }[]): PackCounts {
  const c = { total: 0, code: 0, quiz: 0, output: 0, written: 0 };
  for (const u of units) {
    c[u.origin.type]++;
    c.total++;
  }
  return c;
}
