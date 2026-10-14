import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CheckSpec, PACK_FORMAT, PackCourseFile, type CompetencyId, type LessonSpec, type PackUnit } from '@bootquest/shared';
import { UnitContentEntry } from '@bootquest/shared/api';
import { normalizeOutput } from '@bootquest/server/grade-core';
import { runScriptSnippet, type ScriptSnippetResult } from '@bootquest/server/runners/self-run/snippet';
import { readmeMeta } from '../csbootcamp/import.ts';
import { readText, SourceError } from './source.ts';

/**
 * jstrain2.2 quiz bank (quizzes/NN-*.md, 453 items) → quiz courses of the
 * jstrain pack. REALITY (W3c recon): the bank is NOT multiple choice. Every
 * item is `### QN — title`, a prompt (most: "What does this print?" + one js
 * snippet), and a `<details>` model answer whose first **bold** span carries
 * the literal output in backticks. Upstream captured those answers by running
 * each snippet with `node snippet.js` (CommonJS + module-syntax detection).
 *
 * Mapping, decided per item (single-keyed or nothing):
 *   predict-output  a print question with exactly one js snippet that runs
 *                   cleanly AND deterministically (captured twice, identical,
 *                   non-empty) under `node snippet.js`, and whose answer key has
 *                   literal tokens. expected = the captured stdout (normalized);
 *                   check {runAs:'script', keyTokens: the key's backtick tokens}.
 *                   A key that contradicts the captured output is NOT filtered
 *                   here: the import gate quarantines it ('ambiguous-key').
 *   written         everything else (verbal / spot-the-bug / tsc / SQL / stack
 *                   traces, snippets that THROW — the answer is the exception —
 *                   or keys without literal tokens): a self-assessed unit with the
 *                   upstream model answer + a rubric, a counted carve-out of the
 *                   gate (no check) exactly like BootForge `written`.
 */

export type QuizCapture = (code: string) => Promise<ScriptSnippetResult>;
export const defaultCapture: QuizCapture = (code) => runScriptSnippet(code);

export const PRINT_QUESTION = /[Ww]hat does (this|it) (print|log|output)|[Ww]hat gets (printed|logged)|[Ww]hat is printed|in what order/;

export interface QuizItem {
  file: string;
  course: string;
  number: number;
  slug: string;
  title: string;
  /** prompt markdown (heading stripped, trailing --- rule stripped) */
  question: string;
  /** model answer markdown inside <details> (summary stripped) */
  answer: string;
  position: number;
  total: number;
}

export const quizCourseId = (fileStem: string): string => `quiz-${fileStem}`;

/** Parse one quiz markdown file into items (refuses malformed items). */
export function parseQuizFile(fileName: string, text: string): { title: string; description: string; items: QuizItem[] } {
  const stem = fileName.replace(/\.md$/, '');
  const course = quizCourseId(stem);
  const parts = text.split(/^### /m);
  const preamble = parts.shift() ?? '';
  const meta = readmeMeta(preamble, stem);
  const items: QuizItem[] = [];
  const seen = new Set<number>();
  parts.forEach((p, i) => {
    const nl = p.indexOf('\n');
    const heading = p.slice(0, nl).trim();
    const m = /^Q(\d+) — (.+)$/.exec(heading);
    if (!m) throw new SourceError(`${fileName}: heading "### ${heading}" is not "### QN — title"`);
    const n = Number(m[1]);
    if (seen.has(n)) throw new SourceError(`${fileName}: duplicate Q${n}`);
    seen.add(n);
    const body = p.slice(nl + 1);
    const d = /<details><summary>Answer<\/summary>\s*\n([\s\S]*?)<\/details>/.exec(body);
    if (!d) throw new SourceError(`${fileName} Q${n}: no <details><summary>Answer</summary> block`);
    const question = body.slice(0, d.index).trim();
    if (!question) throw new SourceError(`${fileName} Q${n}: empty question`);
    items.push({
      file: fileName,
      course,
      number: n,
      slug: `q${String(n).padStart(2, '0')}`,
      title: m[2]!.replace(/`/g, '').trim(),
      question,
      answer: d[1]!.trim(),
      position: i,
      total: parts.length,
    });
  });
  if (items.length === 0) throw new SourceError(`${fileName}: no items`);
  return { title: meta.title, description: meta.description, items };
}

const FENCE = /^```(\w*)\n([\s\S]*?)^```[ \t]*$/gm;

/** the first **bold** span of the answer and its `backtick` tokens */
export function answerKey(answer: string): { bold: string; tokens: string[] } {
  const bold = /\*\*([\s\S]+?)\*\*/.exec(answer)?.[1] ?? '';
  const tokens = [...bold.matchAll(/`([^`]+)`/g)].map((t) => t[1]!).filter((t) => t.trim() !== '');
  return { bold, tokens };
}

export type QuizRoute =
  | { kind: 'predict'; snippet: string; expected: string; keyTokens: string[] }
  | { kind: 'written'; reason: string };

/**
 * Per-item ANSWER-KEY corrections (kata-cs-tests wave): two upstream model answers carry
 * literal backtick tokens that are NOT what the snippet really prints, so the import gate
 * quarantines the items as 'ambiguous-key' (validate.ts). The gate is never weakened; the
 * overlay replaces the upstream key's tokens with tokens of the REAL captured output
 * (captured through the same runScriptSnippet runner, 2026-10-09, node v22), and the import
 * REFUSES loudly when the upstream text or the real output drifts from what a correction
 * assumes — a stale correction must never ship silently.
 */
export interface KeyCorrection {
  /** the exact upstream tokens being corrected (import refuses if the source file changed) */
  upstream: readonly string[];
  /** corrected literal tokens; must appear in-order in the captured output */
  tokens: readonly string[];
  /** why the upstream key is wrong (documentation, not shipped) */
  note: string;
}

export const KEY_CORRECTIONS: ReadonlyMap<string, KeyCorrection> = new Map<string, KeyCorrection>([
  [
    'quiz-04-async-event-loop/q10',
    {
      upstream: ['A1, B1, A2, B2, A3, B3'],
      tokens: ['chain A1', 'chain B1', 'chain A2', 'chain B2', 'chain A3', 'chain B3'],
      note: "the upstream key names the right ORDER but not the literal lines: the snippet prints 'chain A1' .. 'chain B3', one per line",
    },
  ],
  [
    'quiz-06-classes-prototypes/q11',
    {
      upstream: ['ReferenceError: Must call super constructor in derived c...'],
      tokens: ['ReferenceError: Must call super constructor in derived c', 'base 1'],
      note: "the upstream token's trailing '...' is prose ellipsis, never printed; the caught ReferenceError line and then 'base 1' is the real output",
    },
  ],
]);

/** Corrected key tokens for an item, or the upstream tokens unchanged. Throws on a stale overlay. */
export function correctedKeyTokens(item: Pick<QuizItem, 'file' | 'number' | 'course' | 'slug'>, tokens: string[]): string[] {
  const c = KEY_CORRECTIONS.get(`${item.course}/${item.slug}`);
  if (!c) return tokens;
  if (JSON.stringify(tokens) !== JSON.stringify(c.upstream)) {
    throw new SourceError(`${item.file} Q${item.number}: key-correction overlay is stale — upstream tokens are now ${JSON.stringify(tokens)}, the correction expected ${JSON.stringify(c.upstream)}; re-verify and update KEY_CORRECTIONS`);
  }
  return [...c.tokens];
}

/** Decide how an item is imported (see the module comment). */
export async function routeItem(item: QuizItem, capture: QuizCapture): Promise<QuizRoute> {
  if (!PRINT_QUESTION.test(item.question)) return { kind: 'written', reason: 'not-a-print-question' };
  const blocks = [...item.question.matchAll(FENCE)];
  if (blocks.length !== 1) return { kind: 'written', reason: 'not-exactly-one-code-block' };
  const lang = blocks[0]![1]!;
  if (lang !== 'js' && lang !== 'javascript') return { kind: 'written', reason: `snippet-language-${lang || 'none'}` };
  const snippet = blocks[0]![2]!;
  const { tokens } = answerKey(item.answer);
  if (tokens.length === 0) return { kind: 'written', reason: 'answer-key-has-no-literal-tokens' };
  const keyTokens = correctedKeyTokens(item, tokens);
  const corrected = keyTokens !== tokens;
  // Routing must not depend on machine load (the census assertion caught one item flipping on a
  // loaded box): a timeout or a disagreeing pair is retried with a fresh pair before giving up.
  let last: QuizRoute = { kind: 'written', reason: 'snippet-times-out' };
  for (let pair = 0; pair < 2; pair++) {
    const a = await capture(snippet);
    if (a.timedOut) continue;
    if (a.exitCode !== 0) return { kind: 'written', reason: 'snippet-throws (the answer is an exception, not output)' };
    const out = normalizeOutput(a.stdout);
    if (!out) return { kind: 'written', reason: 'snippet-prints-nothing' };
    const b = await capture(snippet);
    if (b.exitCode === 0 && !b.timedOut && normalizeOutput(b.stdout) === out) {
      if (corrected) {
        // a correction must HOLD against the freshly captured output, or the import refuses
        let at = 0;
        for (const tk of keyTokens) {
          const i = out.indexOf(tk, at);
          if (i < 0) throw new SourceError(`${item.file} Q${item.number}: key-correction token ${JSON.stringify(tk)} is not in the captured output (in order) — the correction itself is wrong; fix KEY_CORRECTIONS`);
          at = i + tk.length;
        }
      }
      return { kind: 'predict', snippet, expected: out, keyTokens };
    }
    last = { kind: 'written', reason: 'nondeterministic-output' };
  }
  return last;
}

function difficultyFor(item: QuizItem): number {
  // README: "Difficulty ramps within each file: the first third is warm-up, the middle is solid, the last third..."
  const third = item.position / item.total;
  return third < 1 / 3 ? 1 : third < 2 / 3 ? 2 : 3;
}

function competencyFor(stem: string): CompetencyId {
  if (/interview-verbal/.test(stem)) return 'communication';
  if (/spot-the-bug|stack-traces/.test(stem)) return 'code-reading';
  if (/sql|node-and-web|node-advanced/.test(stem)) return 'data-http';
  return 'language-fluency';
}

export interface QuizBuild {
  courses: PackCourseFile[];
  report: { predict: number; written: number; reasons: Record<string, number> };
}

/** Build one pack course per quiz file. `firstOrder` continues the pack's course order. */
export async function buildQuizCourses(sourceDir: string, firstOrder: number, capture: QuizCapture = defaultCapture): Promise<QuizBuild> {
  const dir = join(sourceDir, 'quizzes');
  if (!existsSync(dir)) throw new SourceError(`no quizzes/ under ${sourceDir}`);
  const files = readdirSync(dir).filter((f) => /^\d{2}-[a-z0-9-]+\.md$/.test(f)).sort();
  const report = { predict: 0, written: 0, reasons: {} as Record<string, number> };
  const courses: PackCourseFile[] = [];
  let order = firstOrder;
  for (const f of files) {
    const stem = f.replace(/\.md$/, '');
    const text = readText(join(dir, f));
    const parsed = parseQuizFile(f, text);
    const course = quizCourseId(stem);
    const title = `Quiz · ${parsed.title}`;
    const units: PackUnit[] = [];
    const content: Record<string, UnitContentEntry> = {};
    for (const item of parsed.items) {
      const route = await routeItem(item, capture);
      const key = `jstrain/${course}/${item.slug}`;
      const base = { key, track: 'js', title: item.title, phase: course, difficulty: difficultyFor(item), competencies: [competencyFor(stem)], prerequisites: [] };
      const origin = { id: `quizzes/${stem}/${item.slug}`, module: course, lesson: 'quiz', position: item.position, format: 'quiz', skills: [] as string[] };
      if (route.kind === 'predict') {
        report.predict++;
        const spec = CheckSpec.parse({ type: 'predict-output', language: 'js', expected: route.expected, normalize: true, runAs: 'script', keyTokens: route.keyTokens });
        units.push({ unit: { ...base, kind: 'predict-output', checks: [{ spec }] } as LessonSpec, origin: { ...origin, type: 'output' } } as PackUnit);
        const prose = item.question.replace(FENCE, '').replace(/\n{3,}/g, '\n\n').trim();
        content[key] = UnitContentEntry.parse({ instructions: prose, snippet: route.snippet, explanation: item.answer });
      } else {
        report.written++;
        report.reasons[route.reason] = (report.reasons[route.reason] ?? 0) + 1;
        const { bold } = answerKey(item.answer);
        const keyPoint = bold.replace(/\s+/g, ' ').trim();
        const rubric = [
          { id: 'answer', label: keyPoint ? `Gives the key answer: ${keyPoint.length > 300 ? `${keyPoint.slice(0, 297)}...` : keyPoint}` : 'Gives the key answer of the model answer' },
          { id: 'why', label: 'Names the underlying rule or reason, not just the result' },
        ];
        units.push({ unit: { ...base, kind: 'written', checks: [] } as LessonSpec, origin: { ...origin, type: 'written' } } as PackUnit);
        content[key] = UnitContentEntry.parse({ instructions: item.question, solution: item.answer, rubric });
      }
    }
    courses.push(
      PackCourseFile.parse({
        format: PACK_FORMAT,
        source: 'jstrain',
        course: { id: course, order: order++, title, description: parsed.description, prerequisites: [] },
        modules: [{ id: course, title, lessons: [{ id: 'quiz', title, explanation: text.split(/^### /m)[0]!.trim() }] }],
        units,
        content,
      }),
    );
  }
  return { courses, report };
}
