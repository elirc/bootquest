import { z } from 'zod';

/**
 * Fundamentals (fund wave): a standalone, repo-free learning ladder per language track. Each topic is
 * a lesson (markdown, served in-app as the topic unit's instructions), a single-keyed quiz gate
 * (study-quiz, pass mark 80%), flashcards (enrolled into FSRS review on the first pass) and drills
 * (a regular code pack, content/packs/fund-<track>/, stamped by `seed:validate` under the REAL runners).
 *
 * Authoring: tools/seed/authoring/fundamentals/<track>/<NN-topic>.json (hand-written in this repo, no
 * upstream checkout). `npm run seed:import:fundamentals -- --track <track>` compiles it into
 *   content/fundamentals/<track>/{topics.json, manifest.json}   (lesson + quiz + flashcards; this file)
 *   content/packs/fund-<track>/{<NN-topic>.json, manifest.json} (drills; then `seed:validate`)
 * The server loads topics.json only when its bytes match the manifest's sha256 and every invariant
 * below re-parses (loaded === built); it never reads the authoring files.
 *
 * NOT fingerprinted: no seed generator, `index.ts` or `pack.ts` may import this module (exported only
 * through the `@bootquest/shared/fundamentals` subpath).
 */

export const FUNDAMENTALS_FORMAT = 'bootquest-fundamentals@1' as const;
export const FUNDAMENTALS_MANIFEST_FORMAT = 'bootquest-fundamentals-manifest@1' as const;

/** the language tracks that carry a Fundamentals ladder */
export const FUND_TRACKS = ['js', 'csharp', 'java'] as const;
export const FundTrack = z.enum(FUND_TRACKS);
export type FundTrack = z.infer<typeof FundTrack>;

export const FUND_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const FundLevel = z.enum(FUND_LEVELS);
export type FundLevel = z.infer<typeof FundLevel>;
/** unit difficulty of a topic, by level */
export const FUND_LEVEL_DIFFICULTY: Readonly<Record<FundLevel, number>> = { beginner: 1, intermediate: 2, advanced: 3 };

/** topic ids: NN-kebab-case (the NN prefix is the ladder order) */
export const FUND_TOPIC_ID_RE = /^[0-9]{2}-[a-z0-9-]+$/;

/** quiz gate size per topic */
export const FUND_QUIZ_MIN = 8;
export const FUND_QUIZ_MAX = 12;
export const FUND_CARDS_MIN = 4;
export const FUND_CARDS_MAX = 12;
export const FUND_CHOICES_MIN = 3;
export const FUND_CHOICES_MAX = 5;
/** a lesson shorter than this is not a lesson */
export const FUND_LESSON_MIN_CHARS = 600;
/** the study-quiz pass mark (spec §4) */
export const FUND_PASS_PCT = 0.8;

/** fund:<track>/<topic>/q01 */
export const fundQuizKey = (track: FundTrack, topic: string, n: number): string => `fund:${track}/${topic}/q${String(n).padStart(2, '0')}`;
/** fund:<track>/<topic>/c01 */
export const fundCardKey = (track: FundTrack, topic: string, n: number): string => `fund:${track}/${topic}/c${String(n).padStart(2, '0')}`;
/** the topic's study unit (lesson + quiz gate): fund/<track>/<topic> */
export const fundTopicUnitKey = (track: FundTrack, topic: string): string => `fund/${track}/${topic}`;
/** the drill pack source of a track (content/packs/fund-<track>) */
export const fundPackSource = (track: FundTrack): string => `fund-${track}`;
/** a drill unit of a topic: fund-<track>/<topic>/<slug> */
export const fundDrillUnitKey = (track: FundTrack, topic: string, slug: string): string => `${fundPackSource(track)}/${topic}/${slug}`;

export const FUND_ITEM_KEY_RE = /^fund:(js|csharp|java)\/[0-9]{2}-[a-z0-9-]+\/[qc][0-9]{2}$/;
/** true for a fundamentals quiz / flashcard item key */
export const isFundItemKey = (k: string): boolean => k.startsWith('fund:');

const nonBlank = z.string().refine((s) => s.trim().length > 0, { message: 'must not be blank' });
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

export const FundQuizItem = z
  .object({
    key: z.string().regex(FUND_ITEM_KEY_RE),
    prompt: nonBlank,
    choices: z.array(nonBlank).min(FUND_CHOICES_MIN).max(FUND_CHOICES_MAX),
    /** index of the single keyed choice */
    answer: z.number().int().nonnegative(),
    /** why the key is right (shown on the review card of a miss); never blank */
    explanation: nonBlank,
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.answer >= q.choices.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `answer ${q.answer} is outside the ${q.choices.length} choices`, path: ['answer'] });
    const seen = new Set<string>();
    q.choices.forEach((c, i) => {
      if (seen.has(norm(c))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate choice ${JSON.stringify(c)}`, path: ['choices', i] });
      seen.add(norm(c));
    });
    if (!/\/q[0-9]{2}$/.test(q.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a quiz item key ends in /qNN', path: ['key'] });
  });
export type FundQuizItem = z.infer<typeof FundQuizItem>;

export const FundFlashcard = z
  .object({
    key: z.string().regex(FUND_ITEM_KEY_RE).refine((k) => /\/c[0-9]{2}$/.test(k), { message: 'a flashcard key ends in /cNN' }),
    front: nonBlank,
    back: nonBlank,
  })
  .strict();
export type FundFlashcard = z.infer<typeof FundFlashcard>;

export const FundTopic = z
  .object({
    id: z.string().regex(FUND_TOPIC_ID_RE),
    /** 1-based ladder position (=== the id's NN prefix) */
    order: z.number().int().positive(),
    title: nonBlank,
    level: FundLevel,
    /** one or two sentences: what the topic covers */
    summary: nonBlank,
    /** the lesson (markdown subset the client's prose renderer understands) */
    lesson: z.string().refine((s) => s.trim().length >= FUND_LESSON_MIN_CHARS, { message: `a lesson has at least ${FUND_LESSON_MIN_CHARS} characters` }),
    quiz: z.array(FundQuizItem).min(FUND_QUIZ_MIN).max(FUND_QUIZ_MAX),
    flashcards: z.array(FundFlashcard).min(FUND_CARDS_MIN).max(FUND_CARDS_MAX),
    /** the topic's drill unit keys in the fund-<track> pack, in order (may be empty) */
    drillKeys: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (Number(t.id.slice(0, 2)) !== t.order) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `order ${t.order} does not match the id prefix ${t.id.slice(0, 2)}`, path: ['order'] });
    t.quiz.forEach((q, i) => {
      if (!q.key.includes(`/${t.id}/`)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `quiz key ${q.key} is not under topic ${t.id}`, path: ['quiz', i, 'key'] });
    });
    t.flashcards.forEach((c, i) => {
      if (!c.key.includes(`/${t.id}/`)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `flashcard key ${c.key} is not under topic ${t.id}`, path: ['flashcards', i, 'key'] });
    });
  });
export type FundTopic = z.infer<typeof FundTopic>;

export const FundamentalsFile = z
  .object({
    format: z.literal(FUNDAMENTALS_FORMAT),
    track: FundTrack,
    topics: z.array(FundTopic).min(1),
  })
  .strict()
  .superRefine((f, ctx) => {
    const keys = new Set<string>();
    f.topics.forEach((t, i) => {
      if (t.order !== i + 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `topics must be numbered 01..NN without gaps (position ${i + 1} is ${t.id})`, path: ['topics', i, 'order'] });
      for (const k of [...t.quiz.map((q) => q.key), ...t.flashcards.map((c) => c.key), ...t.drillKeys]) {
        if (keys.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate key ${k}`, path: ['topics', i] });
        keys.add(k);
      }
      for (const k of [...t.quiz.map((q) => q.key), ...t.flashcards.map((c) => c.key)]) {
        if (!k.startsWith(`fund:${f.track}/`)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `item ${k} is not on track ${f.track}`, path: ['topics', i] });
      }
      for (const k of t.drillKeys) {
        if (!k.startsWith(`fund-${f.track}/${t.id}/`)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `drill ${k} is not under fund-${f.track}/${t.id}/`, path: ['topics', i, 'drillKeys'] });
      }
    });
  });
export type FundamentalsFile = z.infer<typeof FundamentalsFile>;

export const FundCounts = z
  .object({
    topics: z.number().int().nonnegative(),
    quiz: z.number().int().nonnegative(),
    flashcards: z.number().int().nonnegative(),
    drills: z.number().int().nonnegative(),
  })
  .strict();
export type FundCounts = z.infer<typeof FundCounts>;

export function countFundamentals(f: Pick<FundamentalsFile, 'topics'>): FundCounts {
  return {
    topics: f.topics.length,
    quiz: f.topics.reduce((n, t) => n + t.quiz.length, 0),
    flashcards: f.topics.reduce((n, t) => n + t.flashcards.length, 0),
    drills: f.topics.reduce((n, t) => n + t.drillKeys.length, 0),
  };
}

/** content/fundamentals/<track>/manifest.json: binds topics.json bytes + counts (written by the importer). */
export const FundamentalsManifest = z
  .object({
    format: z.literal(FUNDAMENTALS_MANIFEST_FORMAT),
    track: FundTrack,
    file: z.literal('topics.json'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    counts: FundCounts,
    /** the census the authoring had to match (null = none, test fixtures) */
    expected: FundCounts.nullable(),
    importedFrom: z
      .object({
        subpath: z.string().min(1),
        gitHead: z.string().nullable(),
        dirty: z.boolean().nullable(),
      })
      .strict(),
  })
  .strict();
export type FundamentalsManifest = z.infer<typeof FundamentalsManifest>;
