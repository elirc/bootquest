import { z } from 'zod';
import { CheckSpec, DrillCsCheck, DrillJavaCheck, DrillJsCheck, QuizCheck } from './check.ts';
import { PACK_FORMAT, PackQuarantine } from './pack.ts';

/**
 * Seed-content packs (W5a, spec §7): the output of the seed-time content
 * factory (seed:quests / seed:explainback / seed:variants / seed:patches).
 *
 * Conventions borrowed from code packs (pack.ts):
 *   - committed JSON under content/seed/<generator>/<name>/: manifest.json +
 *     items.json (+ quarantine.json, QUARANTINE.md, review-queue.json,
 *     validation.json);
 *   - manifest binds items.json by sha256 and its per-kind counts
 *     (loaded === built);
 *   - quarantine.json uses the SAME PackQuarantine schema as code packs
 *     (course = generator id); the stamp binds the quarantine keys;
 *   - validation.json exists ONLY after the generator's deterministic
 *     validator passed; it binds manifest + items bytes and a fingerprint of
 *     kind 'seed:<generator>' (validator + generator bytes + toolchain).
 * Differences: items.json holds ONLY accepted items (rejected candidates are
 * listed in quarantine.json with their reason, never shipped); items held for
 * human review (inheritAmbiguous citations, resolver warnings) live in
 * review-queue.json — not a pass, not shipped until a human clears them.
 * Determinism: nothing here carries a wall-clock time; the same (input, sha)
 * produces byte-identical files.
 */

export const SEED_PACK_FORMAT = 'bootquest-seed-pack@1' as const;

export const SEED_GENERATORS = ['quests', 'explainback', 'variants', 'patches', 'notes'] as const;
export const SeedGenerator = z.enum(SEED_GENERATORS);
export type SeedGenerator = z.infer<typeof SeedGenerator>;

export const SEED_ITEM_KINDS = ['quiz', 'flashcard', 'reading-step', 'explain-back', 'variant', 'patch-kata', 'note'] as const;
export const SeedItemKind = z.enum(SEED_ITEM_KINDS);
export type SeedItemKind = z.infer<typeof SeedItemKind>;

const sha = z.string().regex(/^[0-9a-f]{7,40}$/, 'git sha (7-40 lowercase hex)');
const repoRel = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.includes('\\') && !p.split('/').includes('..'), {
    message: 'must be a repo-relative /-path without ..',
  });
const lineRange = z
  .object({ start: z.number().int().positive(), end: z.number().int().positive() })
  .strict()
  .refine((r) => r.end >= r.start, { message: 'end must be >= start' });

/** Where an item came from: exact source text location at a pinned commit. */
export const SeedProvenance = z
  .object({
    /** repo name exactly as the estate spells it (case-sensitive, e.g. "ww6", "jstrain2.2") */
    repo: z.string().min(1),
    sha,
    path: repoRel,
    lines: lineRange,
  })
  .strict();
export type SeedProvenance = z.infer<typeof SeedProvenance>;

/**
 * A citation as written in the source, plus where the resolver bound it at
 * the pinned sha. Enough of the parser's Citation is kept to re-resolve it
 * (seed:check) without re-parsing.
 */
export const SeedCitation = z
  .object({
    raw: z.string(),
    /** path as written (null only for an orphan continuation — never in a shipped item) */
    path: z.string().nullable(),
    lineStart: z.number().int().nullable(),
    lineEnd: z.number().int().nullable(),
    form: z.enum(['path-line', 'anchor', 'path-only', 'continuation', 'prose-line']),
    /** 1-based line in the source guide */
    sourceLine: z.number().int().positive(),
    malformed: z.string().optional(),
    inheritAmbiguous: z.array(z.string()).optional(),
    /**
     * the parser called this continuation an orphan (no file earlier in its block); the
     * factory bound it to the most recent file cited earlier in the same section, at
     * this guide line. A guess across blocks: always held for human review, never a pass.
     */
    crossBlockFrom: z.number().int().positive().optional(),
    /** repo-relative file the resolver bound it to at the pinned sha */
    resolved: z.string().optional(),
    /**
     * W7: NOT resolved — matched a citationWhitelist entry of the exclusion registry
     * (gitignored runtime file / file the guide tells the learner to create). Recorded
     * on the shipped item so the exemption stays visible; never counted as resolved.
     */
    whitelisted: z.object({ pattern: z.string().min(1), note: z.string().min(1) }).strict().optional(),
  })
  .strict();
export type SeedCitation = z.infer<typeof SeedCitation>;

/** honesty rule (estate-contract §6): observed vs read-derived vs author-recorded survives into the record */
export const SeedObservation = z.enum(['observed', 'read-derived', 'author-recorded']);

const base = {
  key: z.string().regex(/^seed:[a-z-]+:[^\s]+$/),
  provenance: SeedProvenance,
  citations: z.array(SeedCitation).default([]),
};

export const SeedQuizChoice = z
  .object({
    text: z.string().min(1),
    /** what the choice stands for (resolved files / source item key): multi-keyable detection */
    evidence: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const SeedQuizItem = z
  .object({
    ...base,
    kind: z.literal('quiz'),
    /** goal-check: "which check verifies this goal"; finding-location: "where is this defect" */
    /** concept: hand-authored concept check bound to the guide lines that support its key (W7) */
    variety: z.enum(['goal-check', 'finding-location', 'concept']),
    prompt: z.string().min(1),
    choices: z.array(SeedQuizChoice).min(2),
    /** the QuizCheck the app grades with (choice, single-keyed; choices mirror choices[].text) */
    check: QuizCheck,
    explanation: z.string().default(''),
  })
  .strict();

export const SeedFlashcardItem = z
  .object({
    ...base,
    kind: z.literal('flashcard'),
    /** hand-authored: written in a seed session from a finding the parser cannot read (W7) */
    shape: z.enum(['f-table', 'numbered', 'r-heading', 'hand-authored']),
    /** F1 | R21 | 1 */
    label: z.string().min(1),
    severity: z.string().optional(),
    /** scenario / evidence */
    front: z.string().min(1),
    /** consequence / fix */
    back: z.string().min(1),
    observation: SeedObservation,
    /** the guide tagged it **[AI]** (old-AI-generated smell) */
    aiTag: z.boolean().default(false),
  })
  .strict();

export const SeedReadingStepItem = z
  .object({
    ...base,
    kind: z.literal('reading-step'),
    title: z.string().min(1),
    /** heading path inside the guide (H1 > H2) */
    headingPath: z.array(z.string()),
  })
  .strict();

export const SeedKeyPoint = z
  .object({
    text: z.string().min(1),
    /** a substring of the source (whitespace-normalized) */
    quote: z.string().min(1).optional(),
    /**
     * or a resolvable file:line in the source repo at the pinned sha; seed:explainback stores the
     * RESOLVED repo-root path (a guide-relative / suffix cite as drafted is rewritten), so the path
     * a client renders always exists at the sha
     */
    cite: z
      .object({ path: repoRel, lineStart: z.number().int().positive(), lineEnd: z.number().int().positive() })
      .strict()
      .optional(),
  })
  .strict();

export const SeedExplainBackItem = z
  .object({
    ...base,
    kind: z.literal('explain-back'),
    questions: z.array(z.object({ prompt: z.string().min(1), keyPoints: z.array(SeedKeyPoint) }).strict()),
  })
  .strict();

/**
 * variant / kata test: a runner check. Each type executes through the factory harness registry
 * (tools/seed/src/factory/harness): drill-js (the server's JS grade adapter), drill-cs (the warm
 * C# runner) and drill-java (the Java runner, javabootcamp harness). A type with no registered
 * runner is a discard reason, never a pass.
 */
export const SeedRunnableCheck = z.union([DrillJsCheck, DrillCsCheck, DrillJavaCheck]);

export const SeedVariantItem = z
  .object({
    ...base,
    kind: z.literal('variant'),
    /** unit the changed-example retest belongs to */
    unitKey: z.string().min(1),
    task: z.string().min(1),
    check: SeedRunnableCheck,
    referenceSolution: z.string().min(1),
    deliberatelyWrongSolution: z.string().min(1),
    /** the misconception the wrong solution encodes */
    wrongBecause: z.string().min(1),
  })
  .strict();

export const SeedContextFile = z
  .object({
    path: repoRel,
    content: z.string(),
    /** verbatim: content === the repo file (lines) at the pinned sha; adapted: hand-reduced, provenance only */
    origin: z
      .object({ kind: z.enum(['verbatim', 'adapted']), repoPath: repoRel, lines: lineRange.optional() })
      .strict(),
  })
  .strict();

export const SeedDefect = z
  .object({
    scenario: z.string().min(1),
    evidence: z
      .object({
        path: z.string().min(1),
        lineStart: z.number().int().positive(),
        lineEnd: z.number().int().positive(),
        /** repo: resolves in the source repo at the pinned sha; patched: in the kata's patched context */
        in: z.enum(['repo', 'patched']).default('repo'),
      })
      .strict(),
    consequence: z.string().min(1),
  })
  .strict();

export const SeedPatchKataItem = z
  .object({
    ...base,
    kind: z.literal('patch-kata'),
    title: z.string().min(1),
    /** unified diff; applies cleanly to contextFiles */
    diff: z.string().min(1),
    contextFiles: z.array(SeedContextFile).min(1),
    seededDefectKey: z.array(SeedDefect),
    /** optional: must PASS on the context and FAIL on the patched (defective) version */
    test: z.object({ module: repoRel, check: SeedRunnableCheck }).strict().optional(),
    /** the finding (seed:quests flashcard key) the kata was built from */
    findingRef: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------- "Learn more" notes (seed:notes)

/**
 * Notes (owner ask 2026-10-15, the "Learn more" button): authored at seed time, validated by
 * seed:notes, served read-only by the server. Two phases:
 *   before = a READING, shown before the learner answers; seed:notes rejects one that contains
 *            (or heavily overlaps) any keyed quiz answer of its quest pack;
 *   after  = an EXPLANATION of one quiz, released only once the learner has a recorded answer
 *            for the study quest that contains it (answer-first, like explain-back keys).
 * Every excerpt quotes its source lines verbatim (whitespace-normalized) at the pinned sha.
 */
export const NOTES_DRAFT_FORMAT = 'bootquest-notes-draft@1' as const;
export const NOTE_PHASES = ['before', 'after'] as const;
export const NotePhase = z.enum(NOTE_PHASES);
export type NotePhase = z.infer<typeof NotePhase>;
/** target of a note: the whole quest pack, or the exact key of one quest item (quiz / flashcard / reading-step) */
export const NOTE_PACK_TARGET = 'pack' as const;

export const NoteExcerpt = z
  .object({
    path: repoRel,
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    /** verbatim text of lines lineStart..lineEnd (whitespace runs collapsed before matching) */
    quote: z.string().min(1),
  })
  .strict();
export type NoteExcerpt = z.infer<typeof NoteExcerpt>;

export const NoteReadMore = z
  .object({
    path: repoRel,
    lineStart: z.number().int().positive().nullable(),
    lineEnd: z.number().int().positive().nullable(),
    why: z.string().min(1),
  })
  .strict();
export type NoteReadMore = z.infer<typeof NoteReadMore>;

/** One note as authored in content/seed-drafts/notes/<pack>.json. */
export const NotesDraftNote = z
  .object({
    id: z.string().min(1),
    target: z.string().min(1),
    phase: NotePhase,
    title: z.string(),
    body: z.string(),
    excerpts: z.array(NoteExcerpt),
    readMore: z.array(NoteReadMore).default([]),
  })
  .strict();
export type NotesDraftNote = z.infer<typeof NotesDraftNote>;

/** content/seed-drafts/notes/<pack>.json (the shared draft contract, format bootquest-notes-draft@1). */
export const NotesDraft = z
  .object({
    format: z.literal(NOTES_DRAFT_FORMAT),
    /** quest pack name: the dir under content/seed/quests/ */
    pack: z.string().min(1),
    /** === that pack's manifest source.repo */
    repo: z.string().min(1),
    /** === that pack's manifest source.sha */
    sha,
    notes: z.array(NotesDraftNote),
  })
  .strict();
export type NotesDraft = z.infer<typeof NotesDraft>;

/** A stamped note (content/seed/notes/<pack>/items.json). provenance = its first excerpt. */
export const SeedNoteItem = z
  .object({
    ...base,
    kind: z.literal('note'),
    /** the draft's id (unique per pack) */
    noteId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
    /** the quest pack the note belongs to (content/seed/quests/<pack>/) */
    pack: z.string().min(1),
    /** 'pack' or the exact key of a quest item of that pack ('after' notes: a quiz key) */
    target: z.string().min(1),
    phase: NotePhase,
    title: z.string().min(1),
    /** markdown (no HTML, no images) */
    body: z.string().min(1),
    excerpts: z.array(NoteExcerpt).min(1),
    readMore: z.array(NoteReadMore),
  })
  .strict();
export type SeedNoteItem = z.infer<typeof SeedNoteItem>;

export const SeedItem = z.discriminatedUnion('kind', [
  SeedQuizItem,
  SeedFlashcardItem,
  SeedReadingStepItem,
  SeedExplainBackItem,
  SeedVariantItem,
  SeedPatchKataItem,
  SeedNoteItem,
]);
export type SeedItem = z.infer<typeof SeedItem>;
export type SeedItemInput = z.input<typeof SeedItem>;
export type SeedQuizItem = z.infer<typeof SeedQuizItem>;
export type SeedFlashcardItem = z.infer<typeof SeedFlashcardItem>;
export type SeedReadingStepItem = z.infer<typeof SeedReadingStepItem>;
export type SeedExplainBackItem = z.infer<typeof SeedExplainBackItem>;
export type SeedVariantItem = z.infer<typeof SeedVariantItem>;
export type SeedPatchKataItem = z.infer<typeof SeedPatchKataItem>;
export type SeedRunnableCheck = z.infer<typeof SeedRunnableCheck>;

/** generator -> item kinds it may emit */
export const GENERATOR_KINDS: Readonly<Record<SeedGenerator, readonly SeedItemKind[]>> = {
  quests: ['quiz', 'flashcard', 'reading-step'],
  explainback: ['explain-back'],
  variants: ['variant'],
  patches: ['patch-kata'],
  notes: ['note'],
};

export const SeedItemsFile = z
  .object({
    format: z.literal(SEED_PACK_FORMAT),
    generator: SeedGenerator,
    name: z.string().min(1),
    items: z.array(SeedItem),
  })
  .strict()
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    f.items.forEach((it, i) => {
      if (seen.has(it.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate item key ${it.key}`, path: ['items', i] });
      seen.add(it.key);
      if (!GENERATOR_KINDS[f.generator].includes(it.kind)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `generator ${f.generator} cannot emit ${it.kind}`, path: ['items', i, 'kind'] });
      }
    });
  });
export type SeedItemsFile = z.infer<typeof SeedItemsFile>;

export const SeedCounts = z.record(SeedItemKind, z.number().int().nonnegative());
export type SeedCounts = z.infer<typeof SeedCounts>;

/** One thing the generator did NOT turn into a shipped item, and why (never silent). */
export const SeedSkip = z
  .object({
    /** item key, or the source path for whole-file skips */
    subject: z.string().min(1),
    /** excluded:<entry-id> | unpaired-goal | no-distractors | ... */
    reason: z.string().min(1),
  })
  .strict();
export type SeedSkip = z.infer<typeof SeedSkip>;

export const SeedPackManifest = z
  .object({
    format: z.literal(SEED_PACK_FORMAT),
    generator: SeedGenerator,
    /** pack name (repo name for seed:quests, unit/draft name otherwise) */
    name: z.string().min(1),
    source: z
      .object({
        repo: z.string().min(1),
        sha,
        /**
         * git-head: the checkout is a real repo whose HEAD matched and whose tree git listed; git-tree: a
         * plain dir verified against a mirror's `git ls-tree` at the sha (every blob id below is git's
         * own); caller-asserted: a plain dir with no mirror, nothing checked against git. Writers only
         * stamp it with 0 blobs (fixtures: BOOTQUEST_SEED_ALLOW_UNVERIFIED_PIN=1). seed:pins: a 0-blob
         * pack is OK by definition (nothing pinned, nothing to verify); otherwise UNCHECKABLE (a
         * failure unless --no-strict) until a mirror exists
         */
        pin: z.enum(['git-head', 'git-tree', 'caller-asserted']),
        /** the source documents the generator read (guides / unit file / draft) */
        inputs: z.array(z.string().min(1)),
        /** index exclusions applied (bare names or repo-relative dirs) */
        excludeDirs: z.array(z.string()),
      })
      .strict(),
    /** git blob sha1 of every source file read or cited, as found in the checkout */
    blobs: z.record(z.string(), z.string().regex(/^[0-9a-f]{40}$/)),
    items: z.object({ file: z.literal('items.json'), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    counts: z.object({ total: z.number().int().nonnegative(), byKind: SeedCounts }).strict(),
    /** candidates = shipped + quarantined + review + dropped (loaded === built bookkeeping) */
    candidates: z.number().int().nonnegative(),
    quarantined: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    /** excluded / dropped / not-generatable, each with its reason (counted, never silent) */
    skipped: z.array(SeedSkip),
    /** dropped items (excluded-file contact) — subset of skipped, counted toward candidates */
    dropped: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const sum = Object.values(m.counts.byKind).reduce((a, b) => a + (b ?? 0), 0);
    if (sum !== m.counts.total) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `counts.byKind sums to ${sum}, total ${m.counts.total}` });
    if (m.candidates !== m.counts.total + m.quarantined + m.review + m.dropped) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `candidates ${m.candidates} != shipped ${m.counts.total} + quarantined ${m.quarantined} + review ${m.review} + dropped ${m.dropped}` });
    }
  });
export type SeedPackManifest = z.infer<typeof SeedPackManifest>;

export const SeedReviewQueue = z
  .object({
    format: z.literal(SEED_PACK_FORMAT),
    source: z.string().min(1),
    /** held items: NOT a pass, never shipped until a human clears them */
    entries: z.array(z.object({ key: z.string().min(1), warnings: z.array(z.string().min(1)).min(1), item: SeedItem }).strict()),
  })
  .strict();
export type SeedReviewQueue = z.infer<typeof SeedReviewQueue>;

/** quarantine.json for seed packs IS the code-pack schema (same machinery). */
export const SeedQuarantine = PackQuarantine;
export { PACK_FORMAT as SEED_QUARANTINE_FORMAT };

export const SeedValidationStamp = z
  .object({
    format: z.literal(SEED_PACK_FORMAT),
    /** pack source id: "<generator>/<name>" (the quarantine.json `source`) */
    source: z.string().min(1),
    fingerprintKind: z.string().regex(/^seed:(quests|explainback|variants|patches|notes)$/),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    toolchain: z
      .object({ node: z.string().min(1), esbuild: z.string().min(1).optional(), dotnetSdk: z.string().min(1).optional(), dotnetRef: z.string().min(1).optional(), jdk: z.string().min(1).optional() })
      .strict(),
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    itemsSha256: z.string().regex(/^[0-9a-f]{64}$/),
    counts: z.object({ total: z.number().int().nonnegative(), byKind: SeedCounts }).strict(),
    /** sorted; === quarantine.json keys */
    quarantinedKeys: z.array(z.string().min(1)),
    /** sorted; === review-queue.json keys */
    reviewKeys: z.array(z.string().min(1)),
    /** the run's executions (variants/patches): reference/wrong/defective runs actually performed */
    executions: z.number().int().nonnegative(),
  })
  .strict();
export type SeedValidationStamp = z.infer<typeof SeedValidationStamp>;

/** convenience re-export for validators that need the full union */
export { CheckSpec as SeedCheckSpec };
