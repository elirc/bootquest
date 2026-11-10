import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import { NO_LESSON_AIDS, type LessonAids, type StudyQuestPublic, type SubmitResponse, type UnitDetail, type UnitNotesResponse } from '../api/types';
import { LearnMoreButton } from '../components/LearnMore';
import { Icon } from '../components/Icon';
import { Chip, Kbd } from '../components/ui';
import { hasModifier, isEditableTarget, useKeydown } from '../lib/keys';
import { InlineProse, Prose } from '../lib/prose';
import { enterActsOnFocus, shortcutBlocked } from '../lib/shortcuts';
import { useTracksRefresh } from '../lib/tracks';
import { readingTitle } from '../lib/view';
import { isFundTopicKey } from '../lib/fundamentals';
import {
  clearGateFails,
  cooldownLeft,
  displayIndexOf,
  fmtCountdown,
  identityOrder,
  makeGateOrder,
  readGateFails,
  recordGateFail,
  servedPick,
  type GateFails,
  type GateOrder,
} from '../lib/gate';
import { LessonAidsContext } from './Player/LessonAids';
import { NextStep } from './Player/NextStep';

/**
 * W8 study quest (spec §4): an ordered reading list into the repo, then the pre-seeded quiz
 * gate answered ALL AT ONCE (one recorded attempt per submit, pass >= 80%). The result shows
 * right/wrong per question and NEVER the key of a missed question: misses become review cards
 * (question on the front, keyed answer + source on the back) that arrive in the review queue
 * the next day. Submits are free and repeatable; the 50 XP is paid once.
 *
 * f52 U15 (ruling 3): a FUNDAMENTALS topic's gate is stepped instead: one question at a time
 * ("3 / 10"), 1-4 picks, Enter goes on, Back / Next move freely, then a review screen that lists
 * every question before the submit. Nothing says right or wrong until the submit is recorded.
 * Campaign study quests keep the all-at-once form.
 *
 * f52 U3 (ruling 4): after a PASSED gate the keyed answer and the explanation of every question
 * are shown under it, missed questions first. They come from GET /units/:id/notes (re-read after
 * each submit), which releases a Fundamentals gate's explanations on a verified pass only. After a
 * FAILED gate nothing more is shown than which questions were missed.
 */
/** The first line of a Fundamentals explanation note: the keyed choice by text (notes-service FUND_ANSWER_PREFIX). */
const ANSWER_PREFIX = 'Answer: ';

/** Split a released explanation into its keyed-answer line (Fundamentals notes only) and the rest. */
export function splitExplanation(body: string): { answer: string | null; rest: string } {
  if (!body.startsWith(ANSWER_PREFIX)) return { answer: null, rest: body };
  const end = body.indexOf('\n');
  return end === -1 ? { answer: body.slice(ANSWER_PREFIX.length), rest: '' } : { answer: body.slice(ANSWER_PREFIX.length, end), rest: body.slice(end + 1).trim() };
}
export function StudyQuestPane({ detail, lesson = null }: { detail: UnitDetail; lesson?: ReactNode }) {
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
  return <StudyQuest detail={detail} sq={sq} lesson={lesson} />;
}

/**
 * U2 (ruling 2): a Fundamentals quiz gate is closed-book. While the gate is open (started, not yet
 * submitted) the lesson is not rendered at all; "Show lesson" brings it back for THIS try and marks
 * the try as assisted ("I had help" ticked and locked). A retry hides the lesson again.
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
        <span className="muted small">Showing it marks this attempt as &ldquo;I had help&rdquo;.</span>
      </p>
    </section>
  );
}

function StudyQuest({ detail, sq, lesson }: { detail: UnitDetail; sq: StudyQuestPublic; lesson: ReactNode }) {
  const api = useApi();
  const unitId = detail.unit.id;
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<(number | null)[]>(() => sq.questions.map(() => null));
  const [assisted, setAssisted] = useState(false);
  // U2: the learner opened the lesson during this try (locks "I had help" on until the try ends)
  const [lessonShown, setLessonShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submit, setSubmit] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(detail.unit.state === 'done');
  // U15 stepper (Fundamentals only): the question on screen, and whether the review screen is up
  const [step, setStep] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const firstRadio = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const refreshTracks = useTracksRefresh();
  // "Learn more": which items have a reading, and (after an answer) which have a released explanation
  const [notes, setNotes] = useState<UnitNotesResponse | null>(null);
  const loadNotes = useCallback(() => {
    api.getUnitNotes(unitId).then(setNotes, () => setNotes(null));
  }, [api, unitId]);
  useEffect(loadNotes, [loadNotes]);
  const hasNotes = (itemKey: string) =>
    notes !== null && (notes.readings.some((n) => n.target === itemKey) || notes.explanations.released.some((n) => n.target === itemKey));
  // U3: the explanations a PASSED submit released, by question item key (never read after a fail)
  const passedNow = submit?.verdict === 'pass';
  const explained = new Map(passedNow && notes !== null ? notes.explanations.released.map((n) => [n.target, n] as const) : []);
  // ...and the questions in display order: once a passed Fundamentals gate shows its keyed
  // answers, the missed ones come first (a campaign quest's notes are per-question extras: no reorder)
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
  if (fund && passedNow && explained.size > 0 && submit?.studyQuiz) {
    const items = submit.studyQuiz.items;
    displayOrder.sort((a, b) => Number(items[a]?.correct ?? true) - Number(items[b]?.correct ?? true) || numOf(a) - numOf(b));
  }
  // wave B (ruling 2): from the second consecutive failed try the next one opens 3 minutes later
  // (client-side; per unit in localStorage; a blocked store keeps it for this page only)
  const [fails, setFails] = useState<GateFails>(() => (fund ? readGateFails(unitId) : { fails: 0, until: 0 }));
  const [now, setNow] = useState(() => Date.now());
  const coolingMs = fund ? cooldownLeft(fails, now) : 0;
  useEffect(() => {
    if (coolingMs <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [coolingMs > 0]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const complete = answers.every((a) => a !== null);
  const answered = answers.filter((a) => a !== null).length;

  const send = async () => {
    if (busy || !complete) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.submitUnit(unitId, { answers: answers as number[], selfAssisted: assisted });
      setSubmit(r);
      if (r.verdict === 'pass') setDone(true);
      if (fund) {
        const at = Date.now();
        setNow(at);
        if (r.verdict === 'pass') {
          clearGateFails(unitId);
          setFails({ fails: 0, until: 0 });
        } else setFails(recordGateFail(unitId, at, fails));
      }
      loadNotes(); // explanations may have been released by this answer
      refreshTracks(); // W10: a pass changes campaign / track progress (and may unlock an act)
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    if (coolingMs > 0) return;
    setSubmit(null);
    setAnswers(sq.questions.map(() => null));
    // a new try: a new order of questions and choices
    if (fund) setOrder(makeGateOrder(choiceCounts));
    setStep(0);
    setReviewing(false);
    // a new try is closed-book again
    setLessonShown(false);
    setAssisted(false);
  };

  // the gate is open from "Start quiz" until the submit is recorded
  const gateOpen = started && submit === null;
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
  /** the lesson headings of the questions a failed try missed (ruling 7 gate map; lesson order) */
  const reread =
    fund && submit?.studyQuiz && !passedNow
      ? [...new Set(submit.studyQuiz.items.flatMap((it, qi) => (!it.correct && aids.gate[String(qi + 1)] ? [aids.gate[String(qi + 1)]!] : [])))]
      : [];

  // keyboard focus follows the stepper: the question's first choice, then (on review) Submit, so
  // the whole gate can be taken without the mouse
  useEffect(() => {
    if (stepping) firstRadio.current?.focus({ preventScroll: true });
  }, [stepping, step]);
  useEffect(() => {
    if (fund && reviewing && submit === null) submitButton.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewing]);

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

  return (
    <>
    {/* wave B: the check cards are open-book practice, so they are off while the gate is open */}
    <LessonAidsContext.Provider value={{ checks: aids.checks, show: !gateOpen }}>
      {lesson !== null && (gateOpen && !lessonShown ? <LessonHidden onShow={showLesson} /> : lesson)}
    </LessonAidsContext.Provider>
    {lesson !== null && gateOpen && lessonShown && (
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

      {!started ? (
        <div className="toolbar">
          <span className="toolbar-spacer" />
          {coolingMs > 0 && <CooldownNote ms={coolingMs} />}
          <button type="button" className="btn btn-primary" onClick={() => setStarted(true)} disabled={coolingMs > 0}>
            <Icon name="play" /> {coolingMs > 0 ? `Start quiz in ${fmtCountdown(coolingMs)}` : 'Start quiz'}
          </button>
        </div>
      ) : stepping ? (
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
      ) : (
        <form
          className="study-quiz"
          aria-label="Quiz gate"
          onSubmit={(e) => {
            e.preventDefault();
            // U15: a stepped gate submits only from its Submit button (never an implicit Enter)
            if (!fund) void send();
          }}
        >
          {fund && submit === null && (
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
            // wave B (ruling 2): a FAILED Fundamentals gate marks no question (only the score and what to re-read)
            const marked = outcome !== undefined && !(fund && !passedNow);
            return (
              <fieldset key={q.itemKey} className="choices" disabled={busy || submit !== null} data-testid={`question-${num}`}>
                <legend>
                  <strong>Q{num}.</strong> <InlineProse text={q.prompt} />
                  {fund && !submit && answers[qi] === null && <span className="gate-unanswered"> not answered</span>}
                  {outcome && marked && (
                    <span className={`study-mark ${outcome.correct ? 'study-right' : 'study-wrong'}`} data-testid={`mark-${num}`}>
                      {outcome.correct ? ' correct' : ' incorrect'}
                    </span>
                  )}
                  {/* inside the legend: a disabled fieldset (after submit) never disables its first legend's controls */}
                  {hasNotes(q.itemKey) && (
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
                {ex && (
                  <div className={`gate-explain${outcome && !outcome.correct ? ' gate-explain-missed' : ''}`} data-testid={`explain-${num}`}>
                    {ex.answer !== null && (
                      <p>
                        <strong>Answer:</strong> <InlineProse text={ex.answer} />
                      </p>
                    )}
                    {ex.rest !== '' && <Prose text={ex.rest} />}
                  </div>
                )}
              </fieldset>
            );
          })}
          <div className="toolbar">
            <label className="check">
              <input type="checkbox" checked={assisted} onChange={(e) => setAssisted(e.target.checked)} disabled={submit !== null || lessonShown} />I had help
            </label>
            {fund && !submit && (
              <button
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
            {submit ? (
              <button type="button" className="btn" onClick={retry} disabled={coolingMs > 0} data-testid="gate-retry">
                {coolingMs > 0 ? `Try again in ${fmtCountdown(coolingMs)}` : 'Try again'}
              </button>
            ) : (
              <button
                ref={submitButton}
                type={fund ? 'button' : 'submit'}
                className="btn btn-primary"
                disabled={!complete || busy}
                onClick={fund ? () => void send() : undefined}
              >
                <Icon name="check" /> {busy ? 'Submitting…' : 'Submit answers'}
              </button>
            )}
          </div>
        </form>
      )}

      <div className="results" aria-live="polite" data-testid="results">
        {error && (
          <div className="verdict verdict-error" role="alert">
            <Icon name="warn" /> {error}
          </div>
        )}
        {submit?.studyQuiz && <StudyResult submit={submit} fund={fund} explained={fund && explained.size > 0} reread={reread} />}
        {submit !== null && coolingMs > 0 && <CooldownNote ms={coolingMs} />}
        {/* U5: a passed gate is not a dead end — the topic's drills, then the next topic */}
        {submit?.verdict === 'pass' && <NextStep unit={detail.unit} />}
      </div>
      <Link to={`/campaign/${detail.unit.trackId}`} className="muted small">
        Back to campaign
      </Link>
    </section>
    </>
  );
}

/** wave B (ruling 2): why the next try is not open yet, with the time left. */
function CooldownNote({ ms }: { ms: number }) {
  return (
    <p className="muted small gate-cooldown" data-testid="gate-cooldown" role="timer" aria-live="off">
      Two misses in a row: take a few minutes with the lesson first. The next try opens in {fmtCountdown(ms)}.
    </p>
  );
}

function StudyResult({ submit, fund, explained, reread }: { submit: SubmitResponse; fund: boolean; explained: boolean; reread: readonly string[] }) {
  const r = submit.studyQuiz!;
  const pass = submit.verdict === 'pass';
  const xp = submit.xp;
  const xpText = xp === null ? '0 XP' : xp.amount > 0 ? `+${xp.amount} XP` : xp.reason ? `0 XP (${xp.reason})` : '0 XP';
  const missed = r.total - r.correct;
  return (
    <div data-testid="study-result">
      <div className={`verdict verdict-${pass ? 'pass' : 'fail'}`}>
        <Icon name={pass ? 'check' : 'warn'} />
        <strong>{pass ? 'Quiz gate passed' : 'Below the pass mark'}</strong>
        <span className="muted">
          {r.correct}/{r.total} correct ({Math.floor(r.score * 100)}%) · pass mark {r.passPct}%
        </span>
        <span className="verdict-xp">
          {xpText} · {submit.attempt.mode} attempt <code>#{submit.attempt.id}</code>
        </span>
      </div>
      {missed > 0 && (
        <p className="muted small" data-testid="miss-cards-notice">
          {pass && explained
            ? `The ${missed} question${missed === 1 ? '' : 's'} you missed ${missed === 1 ? 'is' : 'are'} listed first above, with the keyed answer and why;`
            : `The answers to the ${missed} missed question${missed === 1 ? '' : 's'} are not shown here:`}{' '}
          each one is now a review card (question on the front, the keyed answer and its source on the back) that arrives in your review queue tomorrow
          {r.reviewCards.alreadyQueued > 0 ? ` (${r.reviewCards.alreadyQueued} already queued from an earlier attempt)` : ''}.
        </p>
      )}
      {pass && explained && missed === 0 && (
        <p className="muted small" data-testid="explained-notice">
          The keyed answer and the explanation of every question are shown above.
        </p>
      )}
      {r.flashcardsEnrolled > 0 && (
        <p className="muted small" data-testid="flashcards-notice">
          {r.flashcardsEnrolled} flashcard{r.flashcardsEnrolled === 1 ? '' : 's'} from this quest joined your review queue (first due tomorrow).
        </p>
      )}
      {!pass && fund && reread.length > 0 && (
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
          {fund
            ? reread.length > 0
              ? 'A failed try costs nothing and is saved. No question is marked and the answers stay hidden until you pass; the next try shuffles the questions.'
              : 'A failed try costs nothing and is saved. Re-read the lesson, then try again: no question is marked and the answers stay hidden until you pass.'
            : 'Failed submits cost nothing and are recorded; review the reading list and try again.'}
        </p>
      )}
    </div>
  );
}
