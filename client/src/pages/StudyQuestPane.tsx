import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import {
  isApiError,
  NO_LESSON_AIDS,
  type GateStatusResponse,
  type LessonAids,
  type LessonCheck,
  type PracticeResponse,
  type StudyQuestPublic,
  type SubmitResponse,
  type UnitDetail,
  type UnitNotesResponse,
} from '../api/types';
import { ExplanationPanel, LearnMoreButton } from '../components/LearnMore';
import { Icon } from '../components/Icon';
import { Chip, Kbd } from '../components/ui';
import { hasModifier, isEditableTarget, useKeydown } from '../lib/keys';
import { InlineProse, Prose } from '../lib/prose';
import { enterActsOnFocus, shortcutBlocked } from '../lib/shortcuts';
import { useTracksRefresh } from '../lib/tracks';
import { useFundLadderRefresh } from '../lib/useFundLadder';
import { readingTitle } from '../lib/view';
import { isFundTopicKey } from '../lib/fundamentals';
import { fmtWhen } from '../lib/format';
import { buildClaudePrompt, CopyPromptButton, lessonSection } from '../lib/claude-prompt';
import { displayIndexOf, identityOrder, makeGateOrder, servedPick, type GateOrder } from '../lib/gate';
import { LessonAidsContext } from './Player/LessonAids';
import { NextStep } from './Player/NextStep';

/**
 * W8 study quest (spec §4): an ordered reading list into the repo, then the pre-seeded quiz
 * gate answered ALL AT ONCE (one recorded attempt per submit, pass >= 80%). Misses become review
 * cards (question + choices on the front, keyed answer + source on the back).
 *
 * f52 U15 (ruling 3): a FUNDAMENTALS topic's gate is stepped instead: one question at a time
 * ("3 / 10"), 1-4 picks, Enter goes on, Back / Next move freely, then a review screen that lists
 * every question before the submit. Nothing says right or wrong until the submit is recorded.
 * Campaign study quests keep the all-at-once form.
 *
 * rv B (REVIEW Q3, R4-01/02/15/16): the gate is EVIDENCE or PRACTICE.
 *   - Evidence (Start quiz): a FAILED try shows only the score, what to re-read and this unit's try number:
 *     no question list, no picks, no marks (the server returns none). The server allows 2 graded tries per
 *     24 h (GET /units/:id/gate-status says when the next opens). After a PASS every question shows its mark,
 *     keyed answer and explanation, and there is no "Try again". A missed question can be copied as a prompt
 *     for the learner's own Claude session (D6: no network).
 *   - Practice: the same questions, then every verdict + keyed answer + explanation at once. Nothing is
 *     recorded (no XP, no unlock, no card); the graded try of this gate then opens 2 days later.
 */
/** The lesson panel's heading (Player renders it; "Show lesson" moves focus to it). */
export const LESSON_HEADING_ID = 'ins-title';

/** The first line of a Fundamentals explanation note: the keyed choice by text (notes-service FUND_ANSWER_PREFIX). */
const ANSWER_PREFIX = 'Answer: ';

/** Split a released explanation into its keyed-answer line (Fundamentals notes only) and the rest. */
export function splitExplanation(body: string): { answer: string | null; rest: string } {
  if (!body.startsWith(ANSWER_PREFIX)) return { answer: null, rest: body };
  const end = body.indexOf('\n');
  return end === -1 ? { answer: body.slice(ANSWER_PREFIX.length), rest: '' } : { answer: body.slice(ANSWER_PREFIX.length, end), rest: body.slice(end + 1).trim() };
}
export function StudyQuestPane({
  detail,
  lesson = null,
  onGateOpenChange,
}: {
  detail: UnitDetail;
  lesson?: ReactNode;
  /** fix pass 2: told when a Fundamentals (closed-book) gate opens and closes, so the page can lock "Learn more" */
  onGateOpenChange?: (open: boolean) => void;
}) {
  const sq = detail.studyQuest ?? null;
  if (!sq) {
    return (
      <section className="panel player-work" aria-label="Study quest">
        <div className="verdict verdict-todo" data-testid="study-pending">
          <Icon name="warn" /> Content pending: this study quest&apos;s quiz gate is not loaded on this server.
        </div>
      </section>
    );
  }
  return <StudyQuest detail={detail} sq={sq} lesson={lesson} onGateOpenChange={onGateOpenChange} />;
}

/**
 * U2 (ruling 2): a Fundamentals quiz gate is closed-book. While the gate is open (started, not yet
 * submitted) the lesson is not rendered at all; "Show lesson" brings it back for THIS try and marks
 * the try as assisted ("I had help" ticked and locked; rv B: an assisted pass earns half XP).
 */
function LessonHidden({ onShow }: { onShow: () => void }) {
  return (
    <section className="panel lesson-hidden" aria-label="Lesson" data-testid="lesson-hidden">
      <p>
        <Icon name="lock" size={14} /> <strong>Lesson hidden while you answer.</strong>{' '}
        <span className="muted">The quiz gate is closed-book.</span>
      </p>
      <p className="lesson-hidden-actions">
        <button type="button" className="btn btn-sm" onClick={onShow}>
          Show lesson
        </button>
        <span className="muted small">Showing it marks this attempt as &ldquo;I had help&rdquo; (a pass then earns half XP).</span>
      </p>
    </section>
  );
}

type Mode = 'graded' | 'practice';

// ---------------------------------------------------------------- rv2 S3 (F4): the pretest

/** Per-browser memory of a finished or skipped pretest (a convenience: a blocked store just shows it again). */
export const PRETEST_KEY_PREFIX = 'bootquest:pretest-done:';

function pretestDone(unitId: number): boolean {
  try {
    return window.localStorage.getItem(`${PRETEST_KEY_PREFIX}${unitId}`) === '1';
  } catch {
    return false;
  }
}

function markPretestDone(unitId: number): void {
  try {
    window.localStorage.setItem(`${PRETEST_KEY_PREFIX}${unitId}`, '1');
  } catch {
    /* not remembered; the in-memory state still closes it */
  }
}

const normPrompt = (t: string): string => t.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The pretest's cards: the lesson's "check yourself" cards (content/fundamentals/sections.json), never a gate
 * question. A check whose prompt is also a question of this gate is dropped (defensive: the gate must not be
 * previewed, even if the content ever overlapped).
 */
export function pretestChecks(checks: readonly LessonCheck[], gatePrompts: readonly string[]): LessonCheck[] {
  const gate = new Set(gatePrompts.map(normPrompt));
  return checks.filter((c) => !gate.has(normPrompt(c.prompt)));
}

/** The offer above the lesson: one line, two buttons; nothing is shown from the cards until it is taken. */
export function PretestOffer({ count, onTake, onDecline }: { count: number; onTake: () => void; onDecline: () => void }) {
  return (
    <section className="panel pretest-offer" aria-labelledby="pretest-offer-title" data-testid="pretest-offer">
      <h2 className="panel-title" id="pretest-offer-title">
        What do you already know?
      </h2>
      <p className="small">
        <span className="muted">
          {count === 1 ? 'One question' : `${count} questions`} from this lesson before you read it. Not graded: nothing is sent or recorded.
        </span>{' '}
        <button type="button" className="btn btn-sm btn-primary" onClick={onTake} data-testid="pretest-take">
          Take the pretest
        </button>{' '}
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDecline} data-testid="pretest-decline">
          Not now
        </button>
      </p>
    </section>
  );
}

/**
 * rv2 S3 (PLAN §2.1 item 7, F4): before an unpassed Fundamentals lesson, its check cards as "what do you already
 * know?". Answer-first (a guess, or "I don't know yet", before the answer shows), unscored (nothing is sent: no
 * attempt, no XP, no card, no practice lock) and skippable. Done or skipped, the lesson takes its place.
 */
export function Pretest({ checks, onDone }: { checks: readonly LessonCheck[]; onDone: () => void }) {
  const [guesses, setGuesses] = useState<string[]>(() => checks.map(() => ''));
  const [shown, setShown] = useState<boolean[]>(() => checks.map(() => false));
  const reveal = (i: number) => setShown((p) => p.map((v, j) => (j === i ? true : v)));
  const allShown = shown.every(Boolean);
  return (
    <section className="panel pretest" aria-labelledby="pretest-title" data-testid="pretest">
      <h2 className="panel-title" id="pretest-title">
        What do you already know?
      </h2>
      <p className="muted small" data-testid="pretest-intro">
        {checks.length === 1 ? 'One question' : `${checks.length} questions`} from this lesson, before you read it. Guess first, then look: a try before
        the lesson helps it stick. Not graded: nothing is sent or recorded, no XP.
      </p>
      <ol className="pretest-cards">
        {checks.map((c, i) => (
          <li key={`${c.heading}-${i}`}>
            <aside className="check-card" data-testid="pretest-card" data-revealed={shown[i] ? 'true' : 'false'} aria-label={`Pretest question ${i + 1}`}>
              <Prose text={c.prompt} className="check-card-prompt" />
              <textarea
                className="answer-text"
                rows={2}
                value={guesses[i] ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setGuesses((p) => p.map((g, j) => (j === i ? v : g)));
                }}
                readOnly={shown[i]}
                aria-label={`Your guess ${i + 1} (not sent)`}
              />
              {shown[i] ? (
                <div className="check-card-answer" data-testid="pretest-answer">
                  <Prose text={c.answer} />
                </div>
              ) : (
                <p className="toolbar">
                  <button type="button" className="btn btn-sm" disabled={(guesses[i] ?? '').trim() === ''} onClick={() => reveal(i)}>
                    Show the answer
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => reveal(i)}>
                    I don&apos;t know yet
                  </button>
                </p>
              )}
            </aside>
          </li>
        ))}
      </ol>
      <div className="toolbar">
        <span className="toolbar-spacer" />
        {allShown ? (
          <button type="button" className="btn btn-primary" onClick={onDone} data-testid="pretest-done">
            Start the lesson
          </button>
        ) : (
          <button type="button" className="btn" onClick={onDone} data-testid="pretest-skip">
            Skip to the lesson
          </button>
        )}
      </div>
    </section>
  );
}

function StudyQuest({
  detail,
  sq,
  lesson,
  onGateOpenChange,
}: {
  detail: UnitDetail;
  sq: StudyQuestPublic;
  lesson: ReactNode;
  onGateOpenChange?: (open: boolean) => void;
}) {
  const api = useApi();
  const unitId = detail.unit.id;
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<Mode>('graded');
  const [answers, setAnswers] = useState<(number | null)[]>(() => sq.questions.map(() => null));
  const [assisted, setAssisted] = useState(false);
  // U2: the learner opened the lesson during this try (locks "I had help" on until the try ends)
  const [lessonShown, setLessonShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submit, setSubmit] = useState<SubmitResponse | null>(null);
  const [practice, setPractice] = useState<PracticeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(detail.unit.state === 'done');
  // U15 stepper (Fundamentals only): the question on screen, and whether the review screen is up
  const [step, setStep] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const firstRadio = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  // fix pass 5: where focus goes when Submit cannot take it, and after a submit
  const backToQuestions = useRef<HTMLButtonElement>(null);
  const resultPanel = useRef<HTMLDivElement>(null);
  const refreshTracks = useTracksRefresh();
  const refreshLadder = useFundLadderRefresh();
  // "Learn more": which items have a reading, and (after an answer) which have a released explanation
  const [notes, setNotes] = useState<UnitNotesResponse | null>(null);
  const loadNotes = useCallback(() => {
    api.getUnitNotes(unitId).then(setNotes, () => setNotes(null));
  }, [api, unitId]);
  useEffect(loadNotes, [loadNotes]);
  // rv B: the server's view of this gate (try number, retry budget, practice lock, what to re-read)
  const [status, setStatus] = useState<GateStatusResponse | null>(null);
  const loadStatus = useCallback(() => {
    api.getGateStatus(unitId).then(setStatus, () => setStatus(null));
  }, [api, unitId]);
  useEffect(loadStatus, [loadStatus]);
  const hasNotes = (itemKey: string) =>
    notes !== null && (notes.readings.some((n) => n.target === itemKey) || notes.explanations.released.some((n) => n.target === itemKey));
  // U3: the explanations a PASSED submit released, by question item key (never read after a fail)
  const passedNow = submit?.verdict === 'pass';
  const failedNow = submit !== null && !passedNow;
  const explained = new Map(passedNow && notes !== null ? notes.explanations.released.map((n) => [n.target, n] as const) : []);
  // fund wave: a Fundamentals topic has no repo and no reading list; its lesson is the Lesson pane
  const fund = isFundTopicKey(detail.unit.key);
  // wave B (ruling 2): every try of a Fundamentals gate shows the questions and their choices in a
  // fresh order. DISPLAY ONLY: `answers` stays in served terms (answers[served question] = served
  // choice index), so the submit posts exactly what an unshuffled gate would. A campaign quest keeps
  // the served order.
  const choiceCounts = sq.questions.map((q) => q.choices.length);
  const [order, setOrder] = useState<GateOrder>(() => (fund ? makeGateOrder(choiceCounts) : identityOrder(choiceCounts)));
  /** the on-screen number of a served question (stable for the whole try, also in its result) */
  const numOf = (qi: number) => displayIndexOf(order, qi) + 1;
  const displayOrder = [...order.questions];
  if (passedNow && submit?.studyQuiz) {
    // once a passed gate shows its keyed answers, the missed ones come first
    const items = submit.studyQuiz.items;
    displayOrder.sort((a, b) => Number(items[a]?.correct ?? true) - Number(items[b]?.correct ?? true) || numOf(a) - numOf(b));
  }
  // wave B (ruling 7): the topic's lesson aids ("check yourself" cards, and the gate's heading map)
  const [aids, setAids] = useState<LessonAids>(NO_LESSON_AIDS);
  useEffect(() => {
    if (!fund) return;
    let live = true;
    api.getLessonAids(unitId).then(
      (a) => live && setAids(a),
      () => undefined, // aids are an extra: without them the lesson and the gate are unchanged
    );
    return () => {
      live = false;
    };
  }, [api, unitId, fund]);
  // rv2 S3 (F4): the pretest is offered before an unpassed Fundamentals lesson (above it) until it is taken or
  // waved off (remembered per browser); taken, its cards stand in for the lesson until it is finished or skipped
  const [pretestPhase, setPretestPhase] = useState<'offer' | 'open' | 'closed'>(() => (pretestDone(unitId) ? 'closed' : 'offer'));
  const pretest = fund && lesson !== null && detail.unit.state !== 'done' && !started && pretestPhase !== 'closed' ? pretestChecks(aids.checks, sq.questions.map((q) => q.prompt)) : [];
  const closePretest = () => {
    markPretestDone(unitId);
    setPretestPhase('closed');
  };
  const complete = answers.every((a) => a !== null);
  const answered = answers.filter((a) => a !== null).length;
  // rv B: when the next GRADED try opens (budget spent, or the practice lock); null = open now. The server's
  // clock decides: re-read the status when that time comes (at most hourly), never compare clocks here.
  const gradedOpensAt = status?.opensAt ?? null;
  useEffect(() => {
    if (gradedOpensAt === null) return;
    const t = setTimeout(loadStatus, Math.min(60 * 60_000, Math.max(5_000, gradedOpensAt - Date.now())));
    return () => clearTimeout(t);
  }, [gradedOpensAt, loadStatus]);

  const send = async () => {
    if (busy || !complete) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'practice') {
        setPractice(await api.practiceUnit(unitId, { answers: answers as number[] }));
      } else {
        const r = await api.submitUnit(unitId, { answers: answers as number[], selfAssisted: assisted });
        setSubmit(r);
        if (r.verdict === 'pass') setDone(true);
        loadNotes(); // explanations may have been released by this answer
        refreshTracks(); // W10: a pass changes campaign / track progress (and may unlock an act)
        refreshLadder(); // wave B: the course rail and the next step read the ladder after the pass
      }
      loadStatus();
    } catch (e) {
      // rv B: the retry budget / practice lock refusal (409 NOT_DUE) carries its own reason and time
      setError(isApiError(e, 'NOT_DUE') ? `${e.message} (NOT_DUE)` : errorText(e));
      loadStatus(); // the status says when
    } finally {
      setBusy(false);
    }
  };

  const begin = (m: Mode) => {
    setMode(m);
    setSubmit(null);
    setPractice(null);
    setError(null);
    setAnswers(sq.questions.map(() => null));
    // a new try: a new order of questions and choices
    if (fund) setOrder(makeGateOrder(choiceCounts));
    setStep(0);
    setReviewing(false);
    // a new graded try is closed-book again
    setLessonShown(false);
    setAssisted(false);
    setStarted(true);
  };

  // the gate is open from "Start" until the submit / practice result is in
  const gateOpen = started && submit === null && practice === null;
  // fix pass 2: a Fundamentals GRADED gate is closed-book for as long as it is open, a retake after a pass
  // included; a practice try is open-book (it never counts)
  const closedBook = fund && gateOpen && mode === 'graded';
  useEffect(() => {
    onGateOpenChange?.(closedBook);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedBook]);
  useEffect(() => () => onGateOpenChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  const showLesson = () => {
    setLessonShown(true);
    setAssisted(true);
  };

  const total = sq.questions.length;
  // U15: Fundamentals gates are answered one question at a time, then reviewed
  const stepping = fund && gateOpen && !reviewing && total > 0;
  const pick = (qi: number, ci: number) => setAnswers((prev) => prev.map((a, i) => (i === qi ? ci : a)));
  const goNext = () => {
    if (step >= total - 1) setReviewing(true);
    else setStep(step + 1);
  };
  const goBack = () => setStep(Math.max(0, step - 1));
  /** the served question on screen in the stepper */
  const stepQi = order.questions[step] ?? 0;
  /** rv B: what the server says a failed graded try should re-read (lesson headings / reading titles) */
  const reread = failedNow ? (status?.lastTry && !status.lastTry.passed ? status.lastTry.reread : []) : [];

  // keyboard focus follows the stepper: the question's first choice, then (on review) Submit, so
  // the whole gate can be taken without the mouse
  useEffect(() => {
    if (stepping) firstRadio.current?.focus({ preventScroll: true });
  }, [stepping, step]);
  useEffect(() => {
    if (!(fund && reviewing && gateOpen)) return;
    // fix pass 5: a disabled Submit (a question is still open) cannot take focus: "Back to questions" does
    const submitEl = submitButton.current;
    (submitEl && !submitEl.disabled ? submitEl : backToQuestions.current)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewing]);
  // fix pass 5: the submit replaces the focused Submit button, so focus moves to the result (a
  // pass then hands it on to the next-step link, Player/NextStep)
  useEffect(() => {
    if (submit?.studyQuiz || practice) resultPanel.current?.focus();
  }, [submit, practice]);
  // fix pass 5: "Show lesson" removes its own button; focus lands on the lesson's heading
  useEffect(() => {
    if (lessonShown) document.getElementById(LESSON_HEADING_ID)?.focus();
  }, [lessonShown]);

  // The same guards as the single-question quiz (Player QuizPane). On the review screen there is
  // no page-level Enter at all: Submit acts only as the focused button.
  useKeydown((e) => {
    if (!stepping || hasModifier(e) || shortcutBlocked(e)) return;
    if (e.key === 'Enter') {
      if (e.isComposing) return;
      // Enter on a focused button / link / checkbox is that control's own Enter
      if (enterActsOnFocus(e.target) || isEditableTarget(e.target)) return;
      if (answers[stepQi] === null) return;
      e.preventDefault();
      goNext();
      return;
    }
    if (isEditableTarget(e.target)) return;
    // a digit picks the choice at that position ON SCREEN
    const n = Number(e.key);
    const picked = Number.isInteger(n) && n >= 1 ? servedPick(order, step, n - 1) : null;
    if (picked) {
      e.preventDefault();
      pick(picked.question, picked.choice);
    }
  });

  const sourceLabel = fund ? `Fundamentals · ${detail.unit.title}` : `${sq.repo} study quest`;
  /** the prompt for one missed question of a passed gate (D6: copied, never sent) */
  const missPrompt = (qi: number, keyed: string | null, explanation: string): string => {
    const q = sq.questions[qi]!;
    const mine = answers[qi] != null ? q.choices[answers[qi]!] ?? '' : '';
    const heading = aids.gate[String(qi + 1)] ?? null;
    return buildClaudePrompt([
      { source: sourceLabel, question: q.prompt, choices: q.choices, mine, keyed: keyed ?? '(see the explanation)', explanation, lesson: lessonSection(detail.instructions, heading) },
    ]);
  };

  // rv B: the question list is on screen while answering and after a PASS only (never after a failed graded try)
  const showForm = started && !stepping && practice === null && (submit === null || passedNow);
  const lessonVisible = !(gateOpen && mode === 'graded' && !lessonShown);

  return (
    <>
    {/* wave B: the check cards are open-book practice, so they are off while a graded gate is open */}
    <LessonAidsContext.Provider value={{ checks: aids.checks, show: !closedBook }}>
      {pretest.length > 0 && pretestPhase === 'offer' && <PretestOffer count={pretest.length} onTake={() => setPretestPhase('open')} onDecline={closePretest} />}
      {pretest.length > 0 && pretestPhase === 'open' ? <Pretest checks={pretest} onDone={closePretest} /> : lesson !== null && (lessonVisible ? lesson : <LessonHidden onShow={showLesson} />)}
    </LessonAidsContext.Provider>
    {lesson !== null && gateOpen && mode === 'graded' && lessonShown && (
      <p className="muted small lesson-shown-note" data-testid="lesson-shown">
        Lesson shown: this attempt is marked &ldquo;I had help&rdquo;.
      </p>
    )}
    <section className="panel player-work" aria-label={fund ? 'Quiz gate' : 'Study quest'}>
      {fund ? (
        <>
          <div className="study-head">
            <h2 className="panel-title">Quiz gate</h2>
            {done && (
              <span data-testid="quest-done">
                <Chip tone="success">gate passed</Chip>
              </span>
            )}
          </div>
          <p className="muted small" data-testid="fund-gate-intro">
            Read the lesson, then take the quiz gate: {sq.questions.length} questions, pass mark {sq.passPct}%. The gate is closed-book: the lesson is hidden
            while you answer. Missed questions come back as review cards;
            your first pass enrols this topic&apos;s {sq.flashcards} flashcards into your reviews and unlocks the next topic.
          </p>
        </>
      ) : (
        <>
      <div className="study-head">
        <h2 className="panel-title">Reading list · {sq.repo}</h2>
        {done && (
          <span data-testid="quest-done">
            <Chip tone="success">quest done</Chip>
          </span>
        )}
        <LearnMoreButton unitId={unitId} compact label="Readings & explanations" />
      </div>
      <p className="muted small">
        Read these sections in the repo (pinned at <code>{sq.sha.slice(0, 7)}</code>), then take the quiz gate: {sq.questions.length} questions, pass mark{' '}
        {sq.passPct}%.
      </p>
      <ol className="reading-list" data-testid="reading-list">
        {sq.readingSteps.map((r) => (
          <li key={r.key}>
            <a href={r.url} target="_blank" rel="noopener noreferrer">
              <InlineProse text={readingTitle(r.title, r.path)} />
            </a>{' '}
            <span className="muted small">
              {r.path}:{r.lines.start}-{r.lines.end}
            </span>
            {hasNotes(r.key) && <LearnMoreButton unitId={unitId} target={r.key} subject={readingTitle(r.title, r.path)} compact />}
          </li>
        ))}
      </ol>
      {sq.readingSteps.length === 0 && <p className="muted">This pack has no reading steps.</p>}
        </>
      )}

      {started && mode === 'practice' && gateOpen && (
        <p className="muted small gate-practice-note" data-testid="practice-banner">
          <Chip>practice</Chip> Practice try: nothing is recorded, every answer is shown when you finish, and the graded gate then opens 2 days later.
        </p>
      )}

      {!started || (!gateOpen && !passedNow) ? (
        <StartBar
          started={started}
          status={status}
          gradedOpensAt={gradedOpensAt}
          passed={done}
          onGraded={() => begin('graded')}
          onPractice={() => begin('practice')}
        />
      ) : null}

      {stepping ? (
        <div className="study-quiz gate-step" role="group" aria-label="Quiz gate" data-testid="gate-step">
          <div className="gate-step-head">
            <span className="gate-progress" data-testid="gate-progress" aria-label={`Question ${step + 1} of ${total}`}>
              {step + 1} / {total}
            </span>
            <span className="muted small">
              {answered}/{total} answered
            </span>
          </div>
          <div className="gate-bar" aria-hidden="true">
            <span style={{ width: `${((step + 1) / total) * 100}%` }} />
          </div>
          {(() => {
            const q = sq.questions[stepQi]!;
            return (
              // keyed: each question is a fresh group (its first choice takes focus)
              <fieldset key={q.itemKey} className="choices" data-testid={`question-${step + 1}`}>
                <legend>
                  <strong>Q{step + 1}.</strong> <InlineProse text={q.prompt} />
                </legend>
                {/* choices in this try's display order: position d shows served choice ci */}
                {order.choices[stepQi]!.map((ci, d) => (
                  <label key={ci} className={`choice${answers[stepQi] === ci ? ' choice-on' : ''}`}>
                    <input
                      ref={d === 0 ? firstRadio : undefined}
                      type="radio"
                      name={`q${step + 1}`}
                      checked={answers[stepQi] === ci}
                      onChange={() => pick(stepQi, ci)}
                      aria-label={`Q${step + 1} choice ${d + 1}`}
                    />
                    <Kbd>{d + 1}</Kbd>
                    <span className="choice-text">
                      <InlineProse text={q.choices[ci]!} />
                    </span>
                  </label>
                ))}
              </fieldset>
            );
          })()}
          <div className="toolbar">
            <button type="button" className="btn" onClick={goBack} disabled={step === 0}>
              Back
            </button>
            <span className="toolbar-spacer" />
            <span className="muted small">
              Pick with 1–{sq.questions[stepQi]!.choices.length}, then Enter
            </span>
            <button type="button" className="btn btn-primary" onClick={goNext}>
              {step === total - 1 ? 'Review answers' : 'Next'} <Kbd>Enter</Kbd>
            </button>
          </div>
        </div>
      ) : showForm ? (
        <form
          className="study-quiz"
          aria-label="Quiz gate"
          onSubmit={(e) => {
            e.preventDefault();
            // U15: a stepped gate submits only from its Submit button (never an implicit Enter)
            if (!fund) void send();
          }}
        >
          {fund && gateOpen && (
            <p className="muted small" data-testid="gate-review">
              Review your answers. You can still change any of them; nothing is marked until you submit.
            </p>
          )}
          {displayOrder.map((qi) => {
            const q = sq.questions[qi]!;
            const outcome = submit?.studyQuiz?.items[qi];
            const note = explained.get(q.itemKey);
            const ex = note ? splitExplanation(note.body) : null;
            // the number the learner saw for this question during the try
            const num = numOf(qi);
            // rv B: marks exist only after a PASS (a failed try never reaches this list)
            const marked = outcome !== undefined && passedNow;
            return (
              <Fragment key={q.itemKey}>
              <fieldset className="choices" disabled={busy || submit !== null} data-testid={`question-${num}`}>
                <legend>
                  <strong>Q{num}.</strong> <InlineProse text={q.prompt} />
                  {fund && gateOpen && answers[qi] === null && <span className="gate-unanswered"> not answered</span>}
                  {outcome && marked && (
                    <span className={`study-mark ${outcome.correct ? 'study-right' : 'study-wrong'}`} data-testid={`mark-${num}`}>
                      {outcome.correct ? ' correct' : ' incorrect'}
                    </span>
                  )}
                  {/* inside the legend: a disabled fieldset (after submit) never disables its first legend's controls */}
                  {/* rv B (D6): a missed question of a passed gate, as a prompt for the learner's own Claude session */}
                  {outcome && marked && !outcome.correct && ex && (
                    <span className="question-copy-prompt">
                      <CopyPromptButton text={() => missPrompt(qi, ex.answer, ex.rest)} testId={`copy-prompt-${num}`} />
                    </span>
                  )}
                  {/* rv2 S3 (F4): once the explanation is out, its panel below carries the notes (one panel) */}
                  {hasNotes(q.itemKey) && !closedBook && !ex && (
                    <span className="question-learn-more" data-testid={`learn-more-q${num}`}>
                      <LearnMoreButton unitId={unitId} target={q.itemKey} subject={`Q${num}`} compact />
                    </span>
                  )}
                </legend>
                {order.choices[qi]!.map((ci, d) => {
                  const c = q.choices[ci]!;
                  return (
                    // the keyed choice is marked only from a released explanation (a passed gate)
                    <label
                      key={ci}
                      className={`choice${answers[qi] === ci ? ' choice-on' : ''}${ex?.answer != null && ex.answer === c ? ' choice-right' : ex?.answer != null && outcome && !outcome.correct && answers[qi] === ci ? ' choice-wrong' : ''}`}
                    >
                      <input type="radio" name={`q${num}`} checked={answers[qi] === ci} onChange={() => pick(qi, ci)} aria-label={`Q${num} choice ${d + 1}`} />
                      <span className="choice-text">
                        <InlineProse text={c} />
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              {/* rv2 S3 (F4): the keyed answer, the explanation, this item's readings and the drawer in ONE panel,
                  outside the (disabled after submit) fieldset so its controls stay usable */}
              {ex && (
                <ExplanationPanel
                  unitId={unitId}
                  target={q.itemKey}
                  subject={`Q${num}`}
                  answer={ex.answer}
                  explanation={ex.rest}
                  readings={notes?.readings.filter((n) => n.target === q.itemKey) ?? []}
                  missed={outcome !== undefined && !outcome.correct}
                  testId={`explain-${num}`}
                  moreTestId={`learn-more-q${num}`}
                />
              )}
              </Fragment>
            );
          })}
          {gateOpen && (
            <div className="toolbar">
              {mode === 'graded' && (
                <label className="check">
                  <input type="checkbox" checked={assisted} onChange={(e) => setAssisted(e.target.checked)} disabled={lessonShown} />I had help
                </label>
              )}
              {fund && (
                <button
                  ref={backToQuestions}
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    // the first question ON SCREEN that is still open
                    const firstOpen = order.questions.findIndex((qi) => answers[qi] === null);
                    setStep(firstOpen === -1 ? total - 1 : firstOpen);
                    setReviewing(false);
                  }}
                >
                  Back to questions
                </button>
              )}
              <span className="toolbar-spacer" />
              <span className="muted small">
                {answered}/{sq.questions.length} answered
              </span>
              <button
                ref={submitButton}
                type={fund ? 'button' : 'submit'}
                className="btn btn-primary"
                disabled={!complete || busy}
                onClick={fund ? () => void send() : undefined}
              >
                <Icon name="check" /> {busy ? 'Submitting…' : mode === 'practice' ? 'Check my practice answers' : 'Submit answers'}
              </button>
            </div>
          )}
        </form>
      ) : null}

      <div className="results" aria-live="polite" data-testid="results">
        {error && (
          <div className="verdict verdict-error" role="alert">
            <Icon name="warn" /> {error}
          </div>
        )}
        {submit?.studyQuiz && <StudyResult submit={submit} fund={fund} explained={explained.size > 0} reread={reread} tryNumber={status?.lastTry?.number ?? null} panelRef={resultPanel} />}
        {practice && <PracticeResult r={practice} sq={sq} answers={answers} panelRef={resultPanel} />}
        {/* U5: a passed gate is not a dead end — the topic's drills, then the next topic */}
        {submit?.verdict === 'pass' && <NextStep unit={detail.unit} submit={submit} />}
      </div>
      <Link to={`/campaign/${detail.unit.trackId}`} className="muted small">
        Back to campaign
      </Link>
    </section>
    </>
  );
}

/**
 * rv B: the entry to a gate: the graded try (when the server's budget and practice lock allow it) and the
 * practice try. A failed graded try lands here too, with "Try again" in place of "Start quiz".
 */
function StartBar({
  started,
  status,
  gradedOpensAt,
  passed,
  onGraded,
  onPractice,
}: {
  started: boolean;
  status: GateStatusResponse | null;
  gradedOpensAt: number | null;
  passed: boolean;
  onGraded: () => void;
  onPractice: () => void;
}) {
  const practiceable = status?.practiceable ?? false;
  return (
    <>
      {gradedOpensAt !== null && (
        <p className="muted small gate-cooldown" data-testid="gate-cooldown" role="status">
          {status?.reason === 'practice'
            ? `You practised this gate: the graded try opens ${fmtWhen(gradedOpensAt)}, so it tests what you remember, not the practice you just saw.`
            : `Two graded tries per 24 hours: your next graded try opens ${fmtWhen(gradedOpensAt)}. Re-read meanwhile, or practise (practice is never recorded).`}
        </p>
      )}
      <div className="toolbar">
        {practiceable && (
          <button type="button" className="btn" onClick={onPractice} data-testid="gate-practice" title="Every answer is shown at the end. Nothing is recorded; the graded try then opens 2 days later.">
            Practice
          </button>
        )}
        {practiceable && <span className="muted small">Practice shows every answer, records nothing, and moves the graded try 2 days out.</span>}
        <span className="toolbar-spacer" />
        <button type="button" className="btn btn-primary" onClick={onGraded} disabled={gradedOpensAt !== null} data-testid={started ? 'gate-retry' : 'gate-start'}>
          <Icon name="play" /> {started ? 'Try again' : passed ? 'Retake quiz' : 'Start quiz'}
        </button>
      </div>
    </>
  );
}

function StudyResult({
  submit,
  fund,
  explained,
  reread,
  tryNumber,
  panelRef,
}: {
  submit: SubmitResponse;
  fund: boolean;
  explained: boolean;
  reread: readonly string[];
  tryNumber: number | null;
  panelRef?: Ref<HTMLDivElement>;
}) {
  const r = submit.studyQuiz!;
  const pass = submit.verdict === 'pass';
  const xp = submit.xp;
  // rv B (R4-08): an assisted first pass pays half; say why
  const half = pass && xp !== null && xp.amount > 0 && submit.attempt.mode === 'assisted';
  const xpText = xp === null ? '0 XP' : xp.amount > 0 ? `+${xp.amount} XP${half ? ' (half: you had help)' : ''}` : xp.reason ? `0 XP (${xp.reason})` : '0 XP';
  const missed = r.total - r.correct;
  return (
    <div data-testid="study-result">
      {/* focus target after a submit (never a tab stop) */}
      <div ref={panelRef} tabIndex={-1} className={`verdict verdict-${pass ? 'pass' : 'fail'}`} data-testid="study-verdict">
        <Icon name={pass ? 'check' : 'warn'} />
        <strong>{pass ? 'Quiz gate passed' : 'Below the pass mark'}</strong>
        <span className="muted">
          {r.correct}/{r.total} correct ({Math.floor(r.score * 100)}%) · pass mark {r.passPct}%
        </span>
        {/* R4-15: this unit's try number, never the global attempt id */}
        <span className="verdict-xp" data-testid="study-try">
          {xpText} · {submit.attempt.mode}
          {tryNumber !== null ? ` · try ${tryNumber}` : ''}
        </span>
      </div>
      {missed > 0 && (
        <p className="muted small" data-testid="miss-cards-notice">
          {pass && explained
            ? `The ${missed} question${missed === 1 ? '' : 's'} you missed ${missed === 1 ? 'is' : 'are'} listed first above, with the keyed answer and why;`
            : `${missed} question${missed === 1 ? '' : 's'} missed. Which ones is not shown:`}{' '}
          each one is now a review card (question and choices on the front, the keyed answer and its source on the back) that{' '}
          {fund && !pass ? 'reaches your review queue once you pass this gate' : 'arrives in your review queue tomorrow'}
          {r.reviewCards.alreadyQueued > 0 ? ` (${r.reviewCards.alreadyQueued} already queued from an earlier attempt)` : ''}.
        </p>
      )}
      {pass && explained && missed === 0 && (
        <p className="muted small" data-testid="explained-notice">
          The keyed answer and the explanation of every question are shown above.
        </p>
      )}
      {/* a Fundamentals pass says this in its completion panel (Player/NextStep) */}
      {r.flashcardsEnrolled > 0 && !(fund && pass) && (
        <p className="muted small" data-testid="flashcards-notice">
          {r.flashcardsEnrolled} flashcard{r.flashcardsEnrolled === 1 ? '' : 's'} from this quest joined your review queue (first due tomorrow).
        </p>
      )}
      {!pass && reread.length > 0 && (
        <p className="gate-reread" data-testid="reread">
          <strong>Re-read:</strong>{' '}
          {reread.map((h, i) => (
            <span key={h}>
              {i > 0 && ' · '}
              <InlineProse text={h} />
            </span>
          ))}
        </p>
      )}
      {!pass && (
        <p className="muted small" data-testid="fail-advice">
          {reread.length > 0
            ? 'A failed try is saved and costs no XP. No question is marked and the answers stay hidden until you pass; the next try shuffles the questions.'
            : fund
              ? 'A failed try is saved and costs no XP. Re-read the lesson, then try again: no question is marked and the answers stay hidden until you pass.'
              : 'A failed try is saved and costs no XP. Review the reading list, then try again: no question is marked until you pass.'}
        </p>
      )}
    </div>
  );
}

/** rv B practice: every verdict, keyed answer and explanation at once (nothing was recorded). */
function PracticeResult({ r, sq, answers, panelRef }: { r: PracticeResponse; sq: StudyQuestPublic; answers: readonly (number | null)[]; panelRef?: Ref<HTMLDivElement> }) {
  return (
    <div data-testid="practice-result">
      <div ref={panelRef} tabIndex={-1} className={`verdict verdict-${r.wouldPass ? 'pass' : 'fail'}`}>
        <Icon name={r.wouldPass ? 'check' : 'warn'} />
        <strong>Practice: {r.correct}/{r.total} correct</strong>
        <span className="muted">{r.wouldPass ? 'that would pass' : `below the ${r.passPct}% pass mark`} · nothing recorded · 0 XP</span>
      </div>
      <ol className="practice-items">
        {r.items.map((it, i) => {
          const q = sq.questions[i];
          const mine = q && answers[i] != null ? q.choices[answers[i]!] : null;
          return (
            <li key={it.itemKey ?? i} className={`practice-item ${it.correct ? 'study-right' : 'study-wrong'}`} data-testid={`practice-item-${i + 1}`}>
              {q && <InlineProse text={q.prompt} />} <strong>{it.correct ? 'correct' : 'incorrect'}</strong>
              {!it.correct && mine && (
                <p className="small">
                  Your answer: <InlineProse text={mine} />
                </p>
              )}
              {it.answer && (
                <p className="small">
                  <strong>Answer:</strong> <InlineProse text={it.answer} />
                </p>
              )}
              {it.explanation && <Prose text={it.explanation} />}
            </li>
          );
        })}
      </ol>
      <p className="muted small" data-testid="practice-lock">
        The graded try of this gate opens {fmtWhen(r.gradedOpensAt)}. Practise again as often as you like.
      </p>
    </div>
  );
}
