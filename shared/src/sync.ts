import { z } from 'zod';
import { CompetencyId, ContentRefKind, ContentRefStatus } from './enums.ts';

/**
 * GitHub curriculum sync (W4 / spec §3.2) — schemas shared by the server
 * (sync job, /api/sync, /api/refs), tools/seed (seed:sync) and the CLI.
 * Import via '@bootquest/shared/sync'.
 */

// ---------------------------------------------------------------- source registry (curriculum.yaml)

export const SOURCE_ROLES = ['curriculum', 'reference', 'corpus'] as const;
export const SourceRole = z.enum(SOURCE_ROLES);
export type SourceRole = z.infer<typeof SourceRole>;

/** owner/name — case-sensitive, never slugged (estate contract §6: dots, underscores, capitals). */
export const RepoName = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'owner/name');
export const FullSha = z.string().regex(/^[0-9a-f]{40}$/, 'full 40-hex commit sha');

/** A repo-relative POSIX directory prefix ("docs/curriculum/"); '' is not allowed (omit the list instead). */
const PathPrefix = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..') && !/^[A-Za-z]:/.test(p), {
    message: 'must be a repo-relative POSIX path prefix without ..',
  });

export const SourceEntry = z
  .object({
    repo: RepoName,
    role: SourceRole,
    /** sync this exact commit instead of the remote HEAD of the default branch */
    pinned_sha: FullSha.optional(),
    /** only markdown under these prefixes is registered (default: the whole repo) */
    include: z.array(PathPrefix).optional(),
    /** markdown under these prefixes is never registered (generated copies, vendored docs) */
    exclude: z.array(PathPrefix).optional(),
  })
  .strict();
export type SourceEntry = z.infer<typeof SourceEntry>;

export const CurriculumConfig = z
  .object({
    version: z.literal(1),
    sources: z.array(SourceEntry).min(1),
  })
  .strict()
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.sources.forEach((s, i) => {
      if (seen.has(s.repo)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate source ${s.repo}`, path: ['sources', i, 'repo'] });
      seen.add(s.repo);
    });
  });
export type CurriculumConfig = z.infer<typeof CurriculumConfig>;

// ---------------------------------------------------------------- signalpost program.json (borrowed)

/**
 * BORROWED from elirc/signalpost-swe-bootcamp `scripts/check-curriculum.ts`
 * @ ff8446042a16d0aaef1687b34932b4f9137e6e0d (its own in-repo validator).
 * Field-for-field the same; one mechanical adaptation: upstream uses zod v4's
 * `z.url()`, which is `z.string().url()` in the zod 3.25 this repo pins.
 * Non-strict like upstream: extra keys (`drill`, `delivery_status`, `intent`,
 * `pilotWeeks`, ticket `outOfScope`) pass through untouched.
 */
const nonempty = z.string().trim().min(1);
export const SignalpostTicket = z.object({
  id: nonempty,
  title: nonempty,
  context: nonempty,
  step: nonempty,
  mode: z.enum(['SOLO', 'PAIR']),
  competencies: z.array(nonempty).min(1).max(2),
  estimate: z.tuple([z.number().positive(), z.number().positive()]),
  acceptance: z.array(nonempty).min(3),
  done: z.array(nonempty).min(3),
  dependencies: z.array(nonempty),
  delivery_status: z.literal('not_started'),
  learning_status: z.literal('unassessed'),
});
export const SignalpostMilestone = z.object({
  id: z.number().int().positive(),
  code: z.string().regex(/^U\d{2}$/),
  title: nonempty,
  phase: nonempty,
  prerequisites: z.array(nonempty),
  competencies: z.array(nonempty).length(2),
  objective: nonempty,
  lesson: z.string().min(200),
  concepts: z.array(nonempty).min(3),
  example: nonempty,
  explanation: nonempty,
  guided: z.array(nonempty).min(3),
  transfer: nonempty,
  remediation: nonempty,
  readiness: nonempty,
  resources: z.array(z.object({ title: nonempty, url: z.string().url() })).min(1),
  targetLevel: z.union([z.literal(3), z.literal(4)]),
  learning_status: z.literal('unassessed'),
  tickets: z.array(SignalpostTicket).length(4),
});
export const SignalpostProgram = z.object({
  version: z.literal(2),
  phases: z.array(nonempty).length(3),
  weeklyHours: z.number().positive(),
  milestones: z.array(SignalpostMilestone).min(1),
});
export type SignalpostProgram = z.infer<typeof SignalpostProgram>;
export type SignalpostMilestone = z.infer<typeof SignalpostMilestone>;

/** Where a first-class curriculum repo keeps its program (LEARNING R2: docs/curriculum/, not the root). */
export const PROGRAM_JSON_PATH = 'docs/curriculum/program.json';

// ---------------------------------------------------------------- recorded check-spec table

/**
 * Check paths are NOT structured data in program.json (they live in ticket
 * prose), so the node-test-file specs come from a RECORDED table
 * (content/sync/check-specs.json; model: P3's fixtures/signalpost/checks.json).
 * Hashes were observed against the real repo at `sha`; sync re-verifies them
 * against every newly synced tarball and reports drift instead of re-pinning.
 */
const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const Hex40 = z.string().regex(/^[0-9a-f]{40}$/);
export const RecordedCheck = z
  .object({
    ticket: z.string().min(1),
    path: z.string().min(1),
    learner_path: z.string().min(1),
    blob_sha: Hex40,
    sha256: Hex64,
    needs_tsx: z.boolean(),
    module_type: z.enum(['module', 'commonjs']).default('module'),
    timeout_ms: z.number().int().positive().default(30000),
    expected_tests: z.array(z.string().min(1)).min(1),
    starter: z.object({ path: z.string().min(1), blob_sha: Hex40, sha256: Hex64 }).strict(),
    /**
     * U03 composite: repo-relative tsconfig of the practice project (served from the
     * same pinned tarball as `path`); the check then also runs the repo-pinned
     * `tsc -p <this> --noEmit` before `node --test`.
     */
    tsc_project: z.string().min(1).optional(),
    /**
     * campaign 2 (OPS review): the recorded pins of EVERY file in tsc_project's relative
     * `extends` chain (repo-relative path -> sha256 over the exact bytes + git blob sha at
     * `sha`). When present, sync verifies them like the check file, and the runner adapter
     * refuses (409 CHECK_INTEGRITY) a chain whose files differ from this set or its hashes.
     */
    tsc_files: z.record(z.string().min(1), z.object({ blob_sha: Hex40, sha256: Hex64 }).strict()).optional(),
    /** acceptance legs of the ticket this check deliberately does NOT cover (honest carve-out) */
    uncovered_legs: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .refine((r) => r.tsc_files === undefined || (r.tsc_project !== undefined && r.tsc_files[r.tsc_project] !== undefined), {
    message: 'tsc_files needs tsc_project, and must pin the tsc_project file itself',
    path: ['tsc_files'],
  });
export const CheckSpecTable = z
  .object({
    _provenance: z.string().min(1),
    repos: z.record(
      RepoName,
      z.object({ sha: Hex40, units: z.record(z.string().regex(/^U\d{2}$/), RecordedCheck) }).strict(),
    ),
  })
  .strict();
export type CheckSpecTable = z.infer<typeof CheckSpecTable>;
export type RecordedCheck = z.infer<typeof RecordedCheck>;

// ---------------------------------------------------------------- API shapes

export const SyncRequestBody = z
  .object({
    /** sync only these registered repos (default: all) */
    repos: z.array(RepoName).min(1).optional(),
  })
  .strict();
export type SyncRequestBody = z.infer<typeof SyncRequestBody>;

export const SyncRepoReport = z
  .object({
    repo: z.string(),
    role: SourceRole,
    sha: z.string().nullable(),
    /** 'network' = HEAD resolved remotely; 'pinned' = curriculum.yaml pin; 'cache' = offline fallback to the last synced sha */
    shaFrom: z.enum(['network', 'pinned', 'cache']).nullable(),
    tarball: z.enum(['hit', 'downloaded']).nullable(),
    markdownFiles: z.number(),
    refs: z.object({ inserted: z.number(), updated: z.number(), unchanged: z.number(), missing: z.number() }).strict(),
    newKeys: z.number(),
    queued: z.number(),
    program: z
      .object({ units: z.number(), checked: z.number(), study: z.number(), checkDrift: z.array(z.string()) })
      .strict()
      .nullable(),
    error: z.string().nullable(),
  })
  .strict();
export type SyncRepoReport = z.infer<typeof SyncRepoReport>;

export const SyncReport = z
  .object({
    syncId: z.number(),
    offline: z.boolean(),
    repos: z.array(SyncRepoReport),
    ok: z.boolean(),
  })
  .strict();
export type SyncReport = z.infer<typeof SyncReport>;

export const RefLink = z
  .object({
    id: z.number(),
    role: z.string(),
    repo: z.string(),
    path: z.string(),
    sha: z.string(),
    anchor: z.string().nullable(),
    title: z.string(),
    kind: ContentRefKind,
    status: ContentRefStatus,
    lineStart: z.number().nullable(),
    lineEnd: z.number().nullable(),
    /** GET this to render (null when the ref is not markdown) */
    contentUrl: z.string().nullable(),
  })
  .strict();
export type RefLink = z.infer<typeof RefLink>;

export const RefIdParams = z.object({ id: z.string().regex(/^[1-9]\d{0,14}$/, 'must be a positive integer id').transform(Number) }).strict();

export const RefContentResponse = z
  .object({
    ref: RefLink,
    /** the section's markdown (lines lineStart..lineEnd of the file at sha) — served from disk, never from the DB */
    markdown: z.string(),
    /** where the bytes came from: the per-SHA tarball cache, the per-SHA blob cache, or a first-access network fetch */
    servedFrom: z.enum(['tarball-cache', 'blob-cache', 'network']),
  })
  .strict();
export type RefContentResponse = z.infer<typeof RefContentResponse>;

export const SeedQueueItem = z
  .object({
    id: z.number(),
    contentRefId: z.number(),
    repo: z.string(),
    stableKey: z.string(),
    path: z.string(),
    anchor: z.string().nullable(),
    title: z.string(),
    sha: z.string(),
    reason: z.enum(['initial', 'new']),
    syncId: z.number(),
    status: z.enum(['pending', 'seeded']),
  })
  .strict();
export const SeedQueueQuery = z
  .object({
    status: z.enum(['pending', 'seeded', 'all']).optional(),
    limit: z.string().regex(/^\d{1,5}$/).transform(Number).pipe(z.number().int().min(1).max(10000)).optional(),
  })
  .strict();
export const SeedQueueResponse =z.object({ count: z.number(), items: z.array(SeedQueueItem) }).strict();
export type SeedQueueResponse = z.infer<typeof SeedQueueResponse>;

/** Free-text competency → one of the seven ladder competencies (competency_alias rows). */
export const CompetencyAliasRow = z.object({ alias: z.string(), competencyId: CompetencyId }).strict();
