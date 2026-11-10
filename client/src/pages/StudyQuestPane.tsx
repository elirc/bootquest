import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import type { StudyQuestPublic, SubmitResponse, UnitDetail, UnitNotesResponse } from '../api/types';
import { LearnMoreButton } from '../components/LearnMore';
import { Icon } from '../components/Icon';
import { Chip, Kbd } from '../components/ui';
import { hasModifier, isEditableTarget, useKeydown } from '../lib/keys';
import { InlineProse } from '../lib/prose';
import { enterActsOnFocus, shortcutBlocked } from '../lib/shortcuts';
import { useTracksRefresh } from '../lib/tracks';
import { readingTitle } from '../lib/view';
import { isFundTopicKey } from '../lib/fundamentals';
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
 */
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
      loadNotes(); // explanations may have been released by this answer
      refreshTracks(); // W10: a pass changes campaign / track progress (and may unlock an act)
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    setSubmit(null);
    setAnswers(sq.questions.map(() => null));
    setStep(0);
    setReviewing(false);
    // a new try is closed-book again
    setLessonShown(false);
    setAssisted(false);
  };

  // fund wave: a Fundamentals topic has no repo and no reading list; its lesson is the Lesson pane
  const fund = isFundTopicKey(detail.unit.key);

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
      if (answers[step] === null) return;
      e.preventDefault();
      goNext();
      return;
    }
    if (isEditableTarget(e.target)) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= (sq.questions[step]?.choices.length ?? 0)) {
      e.preventDefault();
      pick(step, n - 1);
    }
  });

  return (
    <>
    {lesson !== null && (gateOpen && !lessonShown ? <LessonHidden onShow={showLesson} /> : lesson)}
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
                <Chip tone="success">topic passed</Chip>
              </span>
            )}
          </div>
          <p className="muted small" data-testid="fund-gate-intro">
            Read the lesson, then take the quiz gate: {sq.questions.length} questions, pass mark {sq.passPct}%. Missed questions come back as review cards;
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
          <button type="button" className="btn btn-primary" onClick={() => setStarted(true)}>
            <Icon name="play" /> Start quiz
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
            const q = sq.questions[step]!;
            return (
              // keyed: each question is a fresh group (its first choice takes focus)
              <fieldset key={q.itemKey} className="choices" data-testid={`question-${step + 1}`}>
                <legend>
                  <strong>Q{step + 1}.</strong> <InlineProse text={q.prompt} />
                </legend>
                {q.choices.map((c, ci) => (
                  <label key={ci} className={`choice${answers[step] === ci ? ' choice-on' : ''}`}>
                    <input
                      ref={ci === 0 ? firstRadio : undefined}
                      type="radio"
                      name={`q${step + 1}`}
                      checked={answers[step] === ci}
                      onChange={() => pick(step, ci)}
                      aria-label={`Q${step + 1} choice ${ci + 1}`}
                    />
                    <Kbd>{ci + 1}</Kbd>
                    <span className="choice-text">
                      <InlineProse text={c} />
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
              Pick with 1–{sq.questions[step]!.choices.length}, then Enter
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
          {sq.questions.map((q, qi) => {
            const outcome = submit?.studyQuiz?.items[qi];
            return (
              <fieldset key={q.itemKey} className="choices" disabled={busy || submit !== null} data-testid={`question-${qi + 1}`}>
                <legend>
                  <strong>Q{qi + 1}.</strong> <InlineProse text={q.prompt} />
                  {fund && !submit && answers[qi] === null && <span className="gate-unanswered"> not answered</span>}
                  {outcome && (
                    <span className={`study-mark ${outcome.correct ? 'study-right' : 'study-wrong'}`} data-testid={`mark-${qi + 1}`}>
                      {outcome.correct ? ' correct' : ' incorrect'}
                    </span>
                  )}
                  {/* inside the legend: a disabled fieldset (after submit) never disables its first legend's controls */}
                  {hasNotes(q.itemKey) && (
                    <span className="question-learn-more" data-testid={`learn-more-q${qi + 1}`}>
                      <LearnMoreButton unitId={unitId} target={q.itemKey} subject={`Q${qi + 1}`} compact />
                    </span>
                  )}
                </legend>
                {q.choices.map((c, ci) => (
                  <label key={ci} className={`choice${answers[qi] === ci ? ' choice-on' : ''}`}>
                    <input
                      type="radio"
                      name={`q${qi + 1}`}
                      checked={answers[qi] === ci}
                      onChange={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? ci : a)))}
                      aria-label={`Q${qi + 1} choice ${ci + 1}`}
                    />
                    <span className="choice-text">
                      <InlineProse text={c} />
                    </span>
                  </label>
                ))}
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
                  const firstOpen = answers.findIndex((a) => a === null);
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
              <button type="button" className="btn" onClick={retry}>
                Try again
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
        {submit?.studyQuiz && <StudyResult submit={submit} />}
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

function StudyResult({ submit }: { submit: SubmitResponse }) {
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
          The answers to the {missed} missed question{missed === 1 ? '' : 's'} are not shown here: each one is now a review card (question on the front, the
          keyed answer and its source on the back) that arrives in your review queue tomorrow
          {r.reviewCards.alreadyQueued > 0 ? ` (${r.reviewCards.alreadyQueued} already queued from an earlier attempt)` : ''}.
        </p>
      )}
      {r.flashcardsEnrolled > 0 && (
        <p className="muted small" data-testid="flashcards-notice">
          {r.flashcardsEnrolled} flashcard{r.flashcardsEnrolled === 1 ? '' : 's'} from this quest joined your review queue (first due tomorrow).
        </p>
      )}
      {!pass && <p className="muted small">Failed submits cost nothing and are recorded; review the reading list and try again.</p>}
    </div>
  );
}
