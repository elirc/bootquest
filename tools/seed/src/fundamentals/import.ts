import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { countPackUnits, PACK_FORMAT, PackCourseFile, PackManifest, type PackCounts, type PackUnit } from '@bootquest/shared';
import { UnitContentEntry } from '@bootquest/shared/api';
import {
  countFundamentals,
  FUND_CARDS_MAX,
  FUND_CARDS_MIN,
  FUND_CHOICES_MAX,
  FUND_CHOICES_MIN,
  FUND_LESSON_MIN_CHARS,
  FUND_QUIZ_MAX,
  FUND_QUIZ_MIN,
  FUNDAMENTALS_FORMAT,
  FUNDAMENTALS_MANIFEST_FORMAT,
  fundCardKey,
  fundDrillUnitKey,
  FundamentalsFile,
  FundamentalsManifest,
  fundPackSource,
  fundQuizKey,
  type FundCounts,
  type FundTrack,
} from '@bootquest/shared/fundamentals';
import { packBytes, sha256 } from '../bootforge/import.ts';
import { CsdrillsExercise } from '../csdrills/source.ts';
import { mapExercise as mapCsExercise } from '../csdrills/import.ts';
import { JavadrillsExercise } from '../javadrills/source.ts';
import { mapExercise as mapJavaExercise } from '../javadrills/import.ts';
import { SysdrillsExercise } from '../sysdrills/source.ts';
import { mapExercise as mapJsExercise } from '../sysdrills/import.ts';
import { EB_LEAK_OPTIONS } from '../factory/guards.ts';
import { prepareLeakKey, prepareLeakText } from '../factory/leak.ts';
import { FUNDAMENTALS_EXPECTED, ImportError, readTopics, type AuthoredTopic } from './source.ts';

/**
 * seed:import:fundamentals — one track's Fundamentals authoring (tools/seed/authoring/fundamentals/<track>/)
 * → two outputs, both deterministic (same authoring bytes → same output bytes):
 *   content/fundamentals/<track>/topics.json + manifest.json   lesson, quiz gate, flashcards per topic
 *                                                               (the server binds topics.json by sha256)
 *   content/packs/fund-<track>/<NN-topic>.json + manifest.json one pack COURSE per topic with drills;
 *                                                               stamp it with `seed:validate -- --source fund-<track>`
 * Drill mapping reuses the language's drill-bank importer (sysdrills / csdrills / javadrills mapExercise:
 * every one of its refusals applies), then re-keys the unit fund-<track>/<topic>/<slug> on the language
 * track with competency language-fluency.
 * Import-time refusals (ImportError, nothing written): every authoring.ts refusal; a lesson under
 * FUND_LESSON_MIN_CHARS; a quiz gate outside FUND_QUIZ_MIN..MAX questions; a question with a blank
 * prompt / explanation, fewer than FUND_CHOICES_MIN or more than FUND_CHOICES_MAX choices, a blank or
 * duplicate choice, or an answer index outside them; keyed answers piled on one choice position (more
 * than half of a topic's questions); flashcards outside FUND_CARDS_MIN..MAX or blank; a flashcard back
 * that contains a same-topic keyed answer at token boundaries (the estate's FC-quiz xleak rule: cards
 * enrol on the first pass and would answer the gate on every retake); a duplicate drill slug; and a
 * census that differs from FUNDAMENTALS_EXPECTED.
 */

export const REPO_NAME = 'elirc/selfboot';
export const AUTHORING_SUBPATH = 'tools/seed/authoring/fundamentals';
export const LESSON_ID = 'drills';

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
export const DEFAULT_AUTHORING_ROOT = join(REPO, ...AUTHORING_SUBPATH.split('/'));
export const DEFAULT_TOPICS_ROOT = join(REPO, 'content', 'fundamentals');
export const DEFAULT_PACKS_ROOT = join(REPO, 'content', 'packs');

/** the drill pack's grader field per track (java: none — track java derives kind java, like javadrills) */
const GRADER: Readonly<Record<FundTrack, 'js' | 'csharp' | undefined>> = { js: 'js', csharp: 'csharp', java: undefined };

export { FUNDAMENTALS_EXPECTED, ImportError };

interface MappedDrill {
  packUnit: PackUnit;
  content: UnitContentEntry;
  slug: string;
}

/** one authored drill through its language's drill-bank importer, re-keyed onto the fundamentals pack */
export function mapDrill(track: FundTrack, topic: string, raw: unknown, position: number): MappedDrill {
  const label = `${track}/${topic} drill ${position + 1}`;
  const parse = <T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } }): T => {
    const r = schema.safeParse(raw);
    if (!r.success) throw new ImportError(`${label}: not a ${track} drill (${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')})`);
    return r.data;
  };
  let mapped: { packUnit: PackUnit; content: UnitContentEntry };
  let slug: string;
  try {
    if (track === 'js') {
      const ex = parse(SysdrillsExercise);
      slug = ex.slug;
      if (!ex.hints || ex.hints.length !== 3) throw new ImportError(`${label}: needs exactly 3 hints`);
      mapped = mapJsExercise(topic, ex, position);
    } else if (track === 'csharp') {
      const ex = parse(CsdrillsExercise);
      slug = ex.slug;
      mapped = mapCsExercise(topic, ex, position);
    } else {
      const ex = parse(JavadrillsExercise);
      slug = ex.slug;
      mapped = mapJavaExercise(topic, ex, position);
    }
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const key = fundDrillUnitKey(track, topic, slug);
  const unit = { ...mapped.packUnit.unit, key, track, phase: topic, competencies: ['language-fluency' as const], prerequisites: [] };
  return { packUnit: { unit, origin: mapped.packUnit.origin } as PackUnit, content: mapped.content, slug };
}

function checkQuizAndCards(t: AuthoredTopic): void {
  const fail = (msg: string): never => {
    throw new ImportError(`${t.track}/${t.topic}: ${msg}`);
  };
  if (t.lesson.trim().length < FUND_LESSON_MIN_CHARS) fail(`lesson has ${t.lesson.trim().length} characters (min ${FUND_LESSON_MIN_CHARS})`);
  if (t.quiz.length < FUND_QUIZ_MIN || t.quiz.length > FUND_QUIZ_MAX) fail(`quiz gate has ${t.quiz.length} questions (want ${FUND_QUIZ_MIN}..${FUND_QUIZ_MAX})`);
  const positions = new Map<number, number>();
  t.quiz.forEach((q, i) => {
    const n = `Q${i + 1}`;
    if (!q.prompt.trim()) fail(`${n}: blank prompt`);
    if (!q.explanation.trim()) fail(`${n}: blank explanation (the review card of a miss shows it)`);
    if (q.choices.length < FUND_CHOICES_MIN || q.choices.length > FUND_CHOICES_MAX) fail(`${n}: ${q.choices.length} choices (want ${FUND_CHOICES_MIN}..${FUND_CHOICES_MAX})`);
    const seen = new Set<string>();
    for (const c of q.choices) {
      if (!c.trim()) fail(`${n}: blank choice`);
      const k = c.replace(/\s+/g, ' ').trim().toLowerCase();
      if (seen.has(k)) fail(`${n}: duplicate choice ${JSON.stringify(c)}`);
      seen.add(k);
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) fail(`${n}: answer ${q.answer} is outside its ${q.choices.length} choices`);
    positions.set(q.answer, (positions.get(q.answer) ?? 0) + 1);
  });
  for (const [pos, n] of positions) {
    if (n * 2 > t.quiz.length) fail(`${n} of ${t.quiz.length} keyed answers sit at choice ${pos + 1}: spread the keys (the answer-position lint)`);
  }
  if (t.flashcards.length < FUND_CARDS_MIN || t.flashcards.length > FUND_CARDS_MAX) fail(`${t.flashcards.length} flashcards (want ${FUND_CARDS_MIN}..${FUND_CARDS_MAX})`);
  t.flashcards.forEach((c, i) => {
    if (!c.front.trim() || !c.back.trim()) fail(`card ${i + 1}: blank front or back`);
  });
  // FC-quiz xleak (tools/seed/src/ops/xleak-lint.ts): a keyed answer verbatim inside a same-topic card back
  const minTokens = EB_LEAK_OPTIONS.minContainTokens ?? 3;
  t.quiz.forEach((q, qi) => {
    const lk = prepareLeakKey(q.choices[q.answer]!);
    if (lk.tokens.length < minTokens) return;
    t.flashcards.forEach((c, ci) => {
      if (prepareLeakText(c.back).padded.includes(lk.padded)) fail(`card ${ci + 1}'s back restates Q${qi + 1}'s keyed answer (FC-quiz xleak): reword the card`);
    });
  });
}

/** git HEAD + dirtiness of the authoring dir (null outside a work tree) */
function gitInfo(dir: string): { gitHead: string | null; dirty: boolean | null } {
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return { gitHead: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--', '.']).length > 0 };
  } catch {
    return { gitHead: null, dirty: null };
  }
}

export interface BuiltTrack {
  topics: FundamentalsFile;
  counts: FundCounts;
  courses: PackCourseFile[];
}

/** Build (validate, never write) one track's topics file and drill pack courses. */
export function buildTrack(track: FundTrack, authoringRoot: string): BuiltTrack {
  const authored = readTopics(join(authoringRoot, track), track);
  const courses: PackCourseFile[] = [];
  const topics = authored.map((t) => {
    checkQuizAndCards(t);
    const drills = t.drills.map((raw, i) => mapDrill(track, t.topic, raw, i));
    const slugs = new Set<string>();
    for (const d of drills) {
      if (slugs.has(d.slug)) throw new ImportError(`${track}/${t.topic}: duplicate drill slug ${d.slug}`);
      slugs.add(d.slug);
    }
    if (drills.length) {
      const content: Record<string, UnitContentEntry> = {};
      for (const d of drills) content[d.packUnit.unit.key] = d.content;
      courses.push(
        PackCourseFile.parse({
          format: PACK_FORMAT,
          source: fundPackSource(track),
          course: { id: t.topic, order: t.order, title: t.title, description: t.summary, prerequisites: [] },
          modules: [{ id: t.topic, title: t.title, lessons: [{ id: LESSON_ID, title: t.title, explanation: t.summary }] }],
          units: drills.map((d) => d.packUnit),
          content,
        }),
      );
    }
    return {
      id: t.topic,
      order: t.order,
      title: t.title,
      level: t.level,
      summary: t.summary,
      lesson: `${t.lesson.trim()}\n`,
      quiz: t.quiz.map((q, i) => ({ key: fundQuizKey(track, t.topic, i + 1), prompt: q.prompt, choices: q.choices, answer: q.answer, explanation: q.explanation })),
      flashcards: t.flashcards.map((c, i) => ({ key: fundCardKey(track, t.topic, i + 1), front: c.front, back: c.back })),
      drillKeys: drills.map((d) => d.packUnit.unit.key),
    };
  });
  const parsed = FundamentalsFile.safeParse({ format: FUNDAMENTALS_FORMAT, track, topics });
  if (!parsed.success) throw new ImportError(`${track}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return { topics: parsed.data, counts: countFundamentals(parsed.data), courses };
}

export interface ImportOptions {
  track: FundTrack;
  authoringRoot: string;
  /** content/fundamentals (the track's dir is created under it) */
  topicsRoot: string;
  /** content/packs (fund-<track> is created under it) */
  packsRoot: string;
  /** the census to match (null = none, fixtures) */
  expected: FundCounts | null;
  recordGit?: boolean;
}

export interface ImportResult {
  counts: FundCounts;
  topicsManifest: FundamentalsManifest;
  packManifest: PackManifest | null;
  written: string[];
  removed: string[];
}

/** Import one track. Every refusal runs BEFORE anything is written. */
export function importFundamentals(opts: ImportOptions): ImportResult {
  const { track } = opts;
  const built = buildTrack(track, opts.authoringRoot);
  if (opts.expected && JSON.stringify(built.counts) !== JSON.stringify(opts.expected)) {
    throw new ImportError(`${track}: authoring counts ${JSON.stringify(built.counts)} differ from the expected ${JSON.stringify(opts.expected)}; refusing to write`);
  }
  const git = opts.recordGit ? gitInfo(join(opts.authoringRoot, track)) : { gitHead: null, dirty: null };
  const topicsBytes = packBytes(built.topics);
  const topicsManifest = FundamentalsManifest.parse({
    format: FUNDAMENTALS_MANIFEST_FORMAT,
    track,
    file: 'topics.json',
    sha256: sha256(topicsBytes),
    counts: built.counts,
    expected: opts.expected,
    importedFrom: { subpath: `${AUTHORING_SUBPATH}/${track}`, ...git },
  });

  const coursesOut = built.courses.map((file) => ({ file, bytes: packBytes(file) }));
  const totals: PackCounts = { total: 0, code: 0, quiz: 0, output: 0, written: 0 };
  const courseRows = coursesOut.map(({ file, bytes }) => {
    const counts = countPackUnits(file.units);
    for (const k of Object.keys(totals) as (keyof PackCounts)[]) totals[k] += counts[k];
    return { id: file.course.id, order: file.course.order, file: `${file.course.id}.json`, sha256: sha256(bytes), counts };
  });
  const expectedPack: PackCounts | null = opts.expected ? { total: opts.expected.drills, code: opts.expected.drills, quiz: 0, output: 0, written: 0 } : null;
  const grader = GRADER[track];
  const packManifest = courseRows.length
    ? PackManifest.parse({
        format: PACK_FORMAT,
        source: fundPackSource(track),
        track,
        ...(grader ? { grader } : {}),
        importedFrom: {
          repo: REPO_NAME,
          originKind: 'local',
          subpath: `${AUTHORING_SUBPATH}/${track}`,
          path: resolve(opts.authoringRoot, track).replace(/\\/g, '/'),
          ...git,
        },
        expected: expectedPack,
        totals,
        courses: courseRows,
      })
    : null;

  const written: string[] = [];
  const removed: string[] = [];
  const topicsDir = join(opts.topicsRoot, track);
  mkdirSync(topicsDir, { recursive: true });
  writeFileSync(join(topicsDir, 'topics.json'), topicsBytes);
  writeFileSync(join(topicsDir, 'manifest.json'), packBytes(topicsManifest));
  written.push(`${track}/topics.json`, `${track}/manifest.json`);

  if (packManifest) {
    const packDir = join(opts.packsRoot, fundPackSource(track));
    mkdirSync(packDir, { recursive: true });
    // validation.json is kept: the loader compares its manifest sha256, so a changed import is refused until re-validated
    const keep = new Set(['manifest.json', 'quarantine.json', 'validation.json', ...courseRows.map((c) => c.file)]);
    for (const f of readdirSync(packDir)) {
      if (f.endsWith('.json') && !keep.has(f)) {
        rmSync(join(packDir, f));
        removed.push(f);
      }
    }
    for (const { file, bytes } of coursesOut) {
      writeFileSync(join(packDir, `${file.course.id}.json`), bytes);
      written.push(`${fundPackSource(track)}/${basename(file.course.id)}.json`);
    }
    writeFileSync(join(packDir, 'manifest.json'), packBytes(packManifest));
    written.push(`${fundPackSource(track)}/manifest.json`);
  }
  return { counts: built.counts, topicsManifest, packManifest, written, removed };
}
