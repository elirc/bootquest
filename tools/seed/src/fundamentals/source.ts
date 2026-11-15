import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { FUND_TOPIC_ID_RE, FundLevel, FundTrack, type FundCounts } from '@bootquest/shared/fundamentals';

/**
 * Fundamentals authoring source (fund wave) — committed, hand-written JSON in THIS repo:
 * tools/seed/authoring/fundamentals/<track>/<NN-topic>.json, one file per topic. No upstream repo and
 * no checkout: `seed:import:fundamentals` reads these files read-only (see import.ts).
 *
 * Shape (Zod, .strict(): a misspelled key is an error, never dropped):
 *   { format: 'fundamentals-authoring@1', track, topic, title, level, summary, lesson,
 *     quiz: [{ prompt, choices, answer, explanation }],
 *     flashcards: [{ front, back }],
 *     drills: [<one exercise in the track's drill-bank authoring shape>] }
 * Drills reuse the existing drill banks' authoring shapes and import rules verbatim:
 *   js     -> sysdrills (drill-js: ES module starter/solution + tests[{name, code}] over `mod`)
 *   csharp -> csdrills  (drill-cs console-check, jstrain harness: starterHead/solutionHead + tests block)
 *   java   -> javadrills (drill-java: single-file `class Exercise` with its tests between the markers)
 * so every drill passes the same refusals (TODO starters, byte-identical tests, boundary test, hint 3
 * in words, ...) as the drill bank of its language.
 */

export const FUNDAMENTALS_AUTHORING_FORMAT = 'fundamentals-authoring@1';

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * Census of the committed authoring, per track. Adding a topic (or a question, card or drill) = add it,
 * bump this, re-import, re-validate the fund-<track> pack.
 */
export const FUNDAMENTALS_EXPECTED: Readonly<Record<FundTrack, FundCounts>> = {
  js: { topics: 33, quiz: 330, flashcards: 238, drills: 79 },
  csharp: { topics: 26, quiz: 260, flashcards: 208, drills: 55 },
  java: { topics: 20, quiz: 200, flashcards: 160, drills: 42 },
};

export const AuthoringQuiz = z
  .object({
    prompt: z.string(),
    choices: z.array(z.string()),
    /** index of the single keyed choice */
    answer: z.number().int(),
    explanation: z.string(),
  })
  .strict();
export type AuthoringQuiz = z.infer<typeof AuthoringQuiz>;

export const AuthoringCard = z.object({ front: z.string(), back: z.string() }).strict();
export type AuthoringCard = z.infer<typeof AuthoringCard>;

export const TopicAuthoringFile = z
  .object({
    format: z.literal(FUNDAMENTALS_AUTHORING_FORMAT),
    track: FundTrack,
    topic: z.string(),
    title: z.string().min(1),
    level: FundLevel,
    summary: z.string().min(1),
    lesson: z.string(),
    quiz: z.array(AuthoringQuiz),
    flashcards: z.array(AuthoringCard),
    /** parsed per track by import.ts (the drill bank's own exercise schema) */
    drills: z.array(z.unknown()),
  })
  .strict();
export type TopicAuthoringFile = z.infer<typeof TopicAuthoringFile>;

export interface AuthoredTopic extends TopicAuthoringFile {
  /** ladder order = the topic's NN prefix */
  order: number;
  file: string;
}

/**
 * Read every *.json of one track's authoring dir (sorted by name). Refuses an empty dir, a file that is
 * not JSON or not the schema, a file named differently from its topic, a topic of another track, and
 * duplicate topic ids / orders. Nothing is written here.
 */
export function readTopics(trackDir: string, track: FundTrack): AuthoredTopic[] {
  if (!existsSync(trackDir)) throw new ImportError(`authoring dir ${trackDir} does not exist`);
  const files = readdirSync(trackDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new ImportError(`no authoring JSON in ${trackDir}`);
  const out: AuthoredTopic[] = [];
  const orders = new Set<number>();
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(trackDir, file), 'utf8'));
    } catch (err) {
      throw new ImportError(`${file}: not JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    const parsed = TopicAuthoringFile.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new ImportError(`${file}: not a ${FUNDAMENTALS_AUTHORING_FORMAT} topic (${issues})`);
    }
    const t = parsed.data;
    if (t.track !== track) throw new ImportError(`${file}: declares track ${t.track}, but lives under ${track}/`);
    if (!FUND_TOPIC_ID_RE.test(t.topic)) throw new ImportError(`${file}: topic id ${JSON.stringify(t.topic)} must match ${FUND_TOPIC_ID_RE}`);
    if (`${t.topic}.json` !== file) throw new ImportError(`${file}: declares topic ${t.topic} (file must be named ${t.topic}.json)`);
    const order = Number(t.topic.slice(0, 2));
    if (order < 1) throw new ImportError(`${file}: topic number must be 01 or higher`);
    if (orders.has(order)) throw new ImportError(`${file}: duplicate topic order ${order}`);
    orders.add(order);
    out.push({ ...t, order, file });
  }
  out.forEach((t, i) => {
    if (t.order !== i + 1) throw new ImportError(`${t.file}: topics must be numbered 01..NN without gaps (expected ${String(i + 1).padStart(2, '0')})`);
  });
  return out;
}
