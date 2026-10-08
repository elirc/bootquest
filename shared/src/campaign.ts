import { z } from 'zod';
import { TrackId } from './enums.ts';

/**
 * Campaign packs (W5b, spec §3.3): the upskillorder study map turned into
 * 5 acts per active track. Written by `npm run seed:campaign` to
 * content/campaign/{js,csharp,java}.json + manifest.json, loaded by the server
 * into campaign_act / quest (+ one placeholder unit per playable quest).
 *
 * Campaign packs are STRUCTURAL (which repos, in which act, in which order),
 * not learner-verified code, so they carry a lighter stamp than drill packs:
 *   - manifest.seeder.fingerprint = sha256 of the seeder's own source bytes
 *     (server/src/store/campaign-fingerprint.ts) — the loader refuses a pack
 *     built by a different seeder;
 *   - manifest.tracks[].sha256 = the bytes of each track file — the loader
 *     refuses an edited file;
 *   - manifest.sources[].sha256 = the upskillorder inputs (assess/*.jsonl,
 *     INDEX.md, START-HERE.md) — provenance, re-verified by
 *     `seed:campaign -- --check` (rebuild from the live sources, byte-compare),
 *     NOT by the server (the estate is not required at serve time).
 * No timestamps anywhere: two seeder runs over the same inputs are byte-identical.
 */

export const CAMPAIGN_FORMAT = 'bootquest-campaign@1' as const;

/** quest.quest_kind (mirrors the SQL CHECK in migration 006). */
export const QUEST_KINDS = ['study-quest', 'reading'] as const;
export const QuestKind = z.enum(QUEST_KINDS);
export type QuestKind = z.infer<typeof QuestKind>;

export const QuestVerdict = z.enum(['study', 'skim']);
export const Confidence = z.enum(['high', 'med', 'low']);

/** Where a quest came from: the assess jsonl line (1-based) it was parsed from. */
export const QuestProvenance = z
  .object({
    file: z.string().regex(/^assess\/batch-\d+\.jsonl$/),
    line: z.number().int().positive(),
    /** sha256 of that line's bytes (CR stripped) */
    lineSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type QuestProvenance = z.infer<typeof QuestProvenance>;

export const CampaignQuest = z
  .object({
    /** stable quest key: campaign/<track>/<repo> */
    key: z.string().regex(/^campaign\/(js|csharp|java)\/[^/\s]+$/),
    kind: QuestKind,
    repo: z.string().min(1),
    title: z.string().min(1),
    /** INDEX.md rank (1 = study first) */
    rank: z.number().int().positive(),
    verdict: QuestVerdict,
    confidence: Confidence.nullable(),
    difficulty: z.number().int().min(1).max(5),
    richness: z.number().int().min(0).max(5),
    stack: z.string().min(1),
    repoKind: z.string().min(1),
    /** core quests (study verdict) count toward the 80% act unlock; reading steps never do */
    core: z.boolean(),
    /** study quests: the quiz gate arrives with seed:quests; until then the quest is not completable */
    contentPending: z.boolean(),
    family: z.string().min(1).nullable(),
    familyPick: z.boolean(),
    /** spot-the-fix pairs: the snapshot twin read against this canonical repo */
    twinRepo: z.string().min(1).nullable(),
    /** why this act: 'anchor:<spec name>' or 'rule:<band>' */
    placement: z.string().min(1),
    /** one-line study focus from the assessment (served from the pack, never a DB column) */
    focus: z.string().max(280),
    /**
     * The placeholder unit the quest plays through; null = inert (Java placeholder act).
     * study-quest -> unit kind 'study' (no check until seed:quests);
     * reading     -> unit kind 'reading' (self-attest, 5 XP).
     */
    unit: z
      .object({
        key: z.string().regex(/^campaign\/(js|csharp|java)\/[^/\s]+$/),
        kind: z.enum(['study', 'reading']),
        title: z.string().min(1),
        difficulty: z.number().int().min(1).max(5),
      })
      .strict()
      .nullable(),
    provenance: z.array(QuestProvenance).min(1),
  })
  .strict()
  .superRefine((q, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (q.kind === 'study-quest' && (q.verdict !== 'study' || !q.core || !q.contentPending)) bad(`${q.key}: study-quest must be verdict study, core, content-pending`);
    if (q.kind === 'reading' && (q.verdict !== 'skim' || q.core || q.contentPending)) bad(`${q.key}: reading step must be verdict skim, non-core, not pending`);
    if (q.unit && q.unit.kind !== (q.kind === 'study-quest' ? 'study' : 'reading')) bad(`${q.key}: unit kind ${q.unit.kind} does not fit quest kind ${q.kind}`);
    if (q.unit && q.unit.key !== q.key) bad(`${q.key}: unit key must equal the quest key`);
    if (q.twinRepo !== null && q.provenance.length !== 2) bad(`${q.key}: a twin pair carries both provenance lines`);
  });
export type CampaignQuest = z.infer<typeof CampaignQuest>;

export const CampaignAct = z
  .object({
    actNo: z.number().int().min(1).max(5),
    title: z.string().min(1),
    theme: z.string().min(1),
    /** fraction of the PREVIOUS act's core quests that must be done (0.8) */
    unlockPct: z.number().min(0).max(1),
    /** minimum (global) level to enter this act */
    unlockLevel: z.number().int().min(1),
    /** statically locked (Java placeholder): never unlocks, whatever the progress */
    locked: z.boolean(),
    quests: z.array(CampaignQuest),
  })
  .strict()
  .superRefine((a, ctx) => {
    for (let i = 1; i < a.quests.length; i++) {
      if (a.quests[i - 1]!.rank >= a.quests[i]!.rank) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `act ${a.actNo}: quests must be in strictly increasing rank order` });
        break;
      }
    }
  });
export type CampaignAct = z.infer<typeof CampaignAct>;

export const CampaignTrackFile = z
  .object({
    format: z.literal(CAMPAIGN_FORMAT),
    track: z.enum(['js', 'csharp', 'java']),
    acts: z.array(CampaignAct).min(1).max(5),
  })
  .strict()
  .superRefine((f, ctx) => {
    f.acts.forEach((a, i) => {
      if (a.actNo !== i + 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `acts must be numbered 1..n in order (index ${i} is act ${a.actNo})` });
    });
    const seen = new Set<string>();
    for (const a of f.acts) {
      for (const q of a.quests) {
        if (!q.key.startsWith(`campaign/${f.track}/`)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${q.key} is not a ${f.track} key` });
        if (seen.has(q.repo)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `repo ${q.repo} appears twice in track ${f.track}` });
        seen.add(q.repo);
      }
    }
  });
export type CampaignTrackFile = z.infer<typeof CampaignTrackFile>;

export const CampaignCounts = z
  .object({
    acts: z.number().int().nonnegative(),
    quests: z.number().int().nonnegative(),
    studyQuests: z.number().int().nonnegative(),
    readingSteps: z.number().int().nonnegative(),
    /** quests that get a placeholder unit row (Java's inert quests do not) */
    units: z.number().int().nonnegative(),
  })
  .strict();
export type CampaignCounts = z.infer<typeof CampaignCounts>;

const ExcludedRepo = z
  .object({ repo: z.string(), rank: z.number().int().positive(), stack: z.string(), verdict: QuestVerdict, provenance: QuestProvenance })
  .strict();

export const CampaignManifest = z
  .object({
    format: z.literal(CAMPAIGN_FORMAT),
    seeder: z.object({ name: z.literal('seed:campaign'), fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
    /** upskillorder inputs (provenance; re-verified by seed:campaign --check) */
    sources: z.array(z.object({ file: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/), lines: z.number().int().nonnegative() }).strict()).min(1),
    tracks: z
      .array(
        z
          .object({
            track: z.enum(['js', 'csharp', 'java']),
            file: z.string().regex(/^[a-z]+\.json$/),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
            counts: CampaignCounts,
            perAct: z.array(z.object({ actNo: z.number().int(), studyQuests: z.number().int(), readingSteps: z.number().int() }).strict()),
          })
          .strict(),
      )
      .min(1),
    /** the seeder report: every assessed repo is accounted for exactly once */
    report: z
      .object({
        assessed: z.number().int().nonnegative(),
        skipAbsent: z.number().int().nonnegative(),
        /** study/skim repos whose stack has no V1 track (python / other), never silently dropped */
        noTrack: z.array(ExcludedRepo),
        /** study/skim Java repos beyond the four-repo locked placeholder act */
        javaBeyondPlaceholder: z.array(ExcludedRepo),
        /** template families: named picks seeded, the rest absent ('family-sampled') */
        families: z.array(
          z
            .object({
              family: z.string(),
              rule: z.string(),
              picks: z.array(z.string()),
              /** picks absent for another reason (e.g. no V1 track) */
              picksNotSeeded: z.array(z.object({ repo: z.string(), why: z.string() }).strict()),
              familySampled: z.array(z.string()),
            })
            .strict(),
        ),
        /** spot-the-fix twin pairs seeded as one reading step on the canonical repo */
        twinPairs: z.array(z.object({ canonical: z.string(), snapshot: z.string() }).strict()),
        /** repos whose stack would place them elsewhere, pinned to a track by a spec act anchor */
        anchorTrackOverrides: z.array(z.object({ repo: z.string(), stack: z.string(), track: z.string() }).strict()),
        seeded: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type CampaignManifest = z.infer<typeof CampaignManifest>;

// ---------------------------------------------------------------- API: GET /api/tracks/:id/campaign

/**
 * Quest state, derived server-side:
 *   locked    — its act is locked (or the whole track is);
 *   pending   — study quest whose quiz gate is not seeded yet (cannot be completed);
 *   available — playable now;
 *   done      — its unit has a verified pass (study) or a self-attest (reading).
 */
export const QuestState = z.enum(['locked', 'pending', 'available', 'done']);
export type QuestState = z.infer<typeof QuestState>;

export const CampaignQuestDto = z
  .object({
    id: z.number(),
    kind: QuestKind,
    title: z.string(),
    repo: z.string(),
    rank: z.number(),
    unitId: z.number().optional(),
    state: QuestState,
    core: z.boolean(),
    contentPending: z.boolean(),
    twinRepo: z.string().nullable(),
  })
  .strict();
export type CampaignQuestDto = z.infer<typeof CampaignQuestDto>;

export const CampaignActDto = z
  .object({
    id: z.number(),
    title: z.string(),
    theme: z.string().nullable(),
    ordinal: z.number(),
    unlocked: z.boolean(),
    /** the rule for entering THIS act: pct of the previous act's core quests + level */
    unlockRule: z.object({ previousCorePct: z.number(), level: z.number(), staticLock: z.boolean() }).strict(),
    progress: z.object({ coreDone: z.number(), coreTotal: z.number() }).strict(),
    quests: z.array(CampaignQuestDto),
  })
  .strict();
export type CampaignActDto = z.infer<typeof CampaignActDto>;

export const CampaignResponse = z
  .object({
    track: z.object({ id: TrackId, name: z.string(), locked: z.boolean() }).strict(),
    level: z.number(),
    acts: z.array(CampaignActDto),
  })
  .strict();
export type CampaignResponse = z.infer<typeof CampaignResponse>;
