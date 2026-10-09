import type { CheckSpec, SeedQuizItem } from '@bootquest/shared';
import type { CanonicalRunResult, StudyQuestPublic } from '@bootquest/shared/api';
import { FLASHCARD_CARD_PREFIX, gradeStudyQuiz, QUIZ_MISS_CARD_PREFIX, StudyQuizShapeError, type StudyQuizGrade } from '../engines/study-quest.ts';
import type { QuestPackItems, SeedItemStore } from '../store/seed-items.ts';
import { HttpError } from './http.ts';

/**
 * W8 study-quest service helpers: the PUBLIC projection of a quest pack (reading list with
 * repo links + questions with choices, never keys), server-side grading of a full answer set,
 * and the review-card text (resolved from the stamped pack by card key, never stored).
 */

/** The estate's GitHub owner (every curriculum repo is elirc/<repo>; the pack pins the sha). */
export const ESTATE_OWNER = 'elirc';

const encPath = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

export function repoLink(repo: string, sha: string, path: string, lines?: { start: number; end: number }): string {
  const frag = lines ? (lines.start === lines.end ? `#L${lines.start}` : `#L${lines.start}-L${lines.end}`) : '';
  return `https://github.com/${ESTATE_OWNER}/${encodeURIComponent(repo)}/blob/${sha}/${encPath(path)}${frag}`;
}

/** The quest pack a study-quiz gate was derived from (by its first item's repo), or undefined. */
function packFor(store: SeedItemStore, spec: Extract<CheckSpec, { type: 'study-quiz' }>): QuestPackItems | undefined {
  const first = store.quiz(spec.itemKeys[0]!);
  return first ? store.questPacks().get(first.provenance.repo) : undefined;
}

function gateItems(store: SeedItemStore, spec: Extract<CheckSpec, { type: 'study-quiz' }>): SeedQuizItem[] | null {
  const items = spec.itemKeys.map((k) => store.quiz(k));
  return items.every((i): i is SeedQuizItem => i !== undefined) ? items : null;
}

/**
 * PUBLIC half of a study-quest unit: undefined for other check types; null when the gate's
 * quiz items are not loaded on this server (content pending).
 */
export function studyQuestPublicFor(store: SeedItemStore, spec: CheckSpec): StudyQuestPublic | null | undefined {
  if (spec.type !== 'study-quiz') return undefined;
  const items = gateItems(store, spec);
  const pack = packFor(store, spec);
  if (!items || !pack) return null;
  return {
    repo: pack.repo,
    sha: pack.sha,
    passPct: Math.round(spec.passPct * 100),
    readingSteps: pack.readingSteps.map((r) => ({
      key: r.key,
      title: r.title,
      headingPath: [...r.headingPath],
      path: r.provenance.path,
      lines: { start: r.provenance.lines.start, end: r.provenance.lines.end },
      url: repoLink(pack.repo, r.provenance.sha, r.provenance.path, r.provenance.lines),
    })),
    // choices are public (the quiz public-spec machinery: QuizCheck `choices`); answerKey never leaves
    questions: items.map((q) => ({ itemKey: q.key, prompt: q.prompt, choices: q.check.choices ?? q.choices.map((c) => c.text) })),
    flashcards: pack.flashcards.length,
  };
}

export interface StudyGradeResult {
  result: CanonicalRunResult;
  grade: StudyQuizGrade;
  /** the pack's flashcard item keys (enrolled on a pass) */
  flashcardKeys: string[];
}

/**
 * Grade a study-quiz submission server-side. Request-shape problems are 400s (nothing is
 * recorded); a gate whose items are not loaded is 409 CONTENT_PENDING (nothing recorded).
 * The canonical result never names a key: a pass carries no failures (RunnerResult rule),
 * a fail lists the missed question numbers only.
 */
export function gradeStudySubmission(
  store: SeedItemStore,
  spec: Extract<CheckSpec, { type: 'study-quiz' }>,
  answers: readonly (number | string)[] | undefined,
): StudyGradeResult {
  if (answers === undefined) {
    throw new HttpError(400, 'VALIDATION', 'study-quiz checks take `answers`: the full answer set, one choice index per question in order', [
      { path: 'body.answers', message: 'required for study-quiz units' },
    ]);
  }
  const items = gateItems(store, spec);
  if (!items) throw new HttpError(409, 'CONTENT_PENDING', 'this study quest\'s quiz items are not loaded on this server (its stamped quest pack is missing)');
  let grade: StudyQuizGrade;
  try {
    grade = gradeStudyQuiz(items, answers, spec.passPct);
  } catch (err) {
    if (err instanceof StudyQuizShapeError) throw new HttpError(400, 'VALIDATION', err.message, [{ path: 'body.answers', message: err.message }]);
    throw err;
  }
  // floor: a 79.9% fail is never displayed as 80%
  const pct = Math.floor(grade.score * 100);
  const mark = Math.round(spec.passPct * 100);
  const missedNos = grade.items.map((g, i) => (g.correct ? null : i + 1)).filter((n): n is number => n !== null);
  const output =
    `${grade.correct}/${grade.total} correct (${pct}%); pass mark ${mark}%` +
    (missedNos.length ? `; missed Q${missedNos.join(', Q')} -> review cards due tomorrow` : '');
  const result: CanonicalRunResult = grade.passed
    ? { pass: true, output, failures: [], durationMs: 0 }
    : {
        pass: false,
        output,
        failures: missedNos.map((n) => ({ name: `Q${n}`, message: 'incorrect (the key arrives as a review card, due tomorrow)' })),
        durationMs: 0,
      };
  return { result, grade, flashcardKeys: (packFor(store, spec)?.flashcards ?? []).map((f) => f.key) };
}

function citeOf(item: { citations: readonly { raw: string; resolved?: string }[]; provenance: { repo: string; sha: string; path: string; lines: { start: number; end: number } } }): string {
  const c = item.citations.find((x) => x.resolved) ?? item.citations[0];
  const where = c ? c.raw : `${item.provenance.path}:${item.provenance.lines.start}-${item.provenance.lines.end}`;
  return `${item.provenance.repo}@${item.provenance.sha.slice(0, 7)} ${where}`;
}

/** Card text for a seeded review card (quiz miss / flashcard), or undefined for other cards. */
export function reviewCardText(store: SeedItemStore, cardKey: string): { front: string; back: string; source: string | null } | undefined {
  if (cardKey.startsWith(QUIZ_MISS_CARD_PREFIX)) {
    const q = store.quiz(cardKey.slice(QUIZ_MISS_CARD_PREFIX.length));
    if (!q) return undefined;
    const choices = q.check.choices ?? q.choices.map((c) => c.text);
    const keyed = typeof q.check.answerKey === 'number' ? (choices[q.check.answerKey] ?? String(q.check.answerKey)) : String(q.check.answerKey);
    return { front: q.prompt, back: q.explanation ? `${keyed}\n\n${q.explanation}` : keyed, source: citeOf(q) };
  }
  if (cardKey.startsWith(FLASHCARD_CARD_PREFIX)) {
    const f = store.flashcard(cardKey.slice(FLASHCARD_CARD_PREFIX.length));
    if (!f) return undefined;
    return { front: f.front, back: f.back, source: citeOf(f) };
  }
  return undefined;
}
