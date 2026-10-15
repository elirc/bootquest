import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import type { StudyQuestPublic, SubmitResponse, UnitDetail, UnitNotesResponse } from '../api/types';
import { LearnMoreButton } from '../components/LearnMore';
import { Icon } from '../components/Icon';
import { Chip } from '../components/ui';
import { InlineProse } from '../lib/prose';
import { useTracksRefresh } from '../lib/tracks';
import { readingTitle } from '../lib/view';

/**
 * W8 study quest (spec §4): an ordered reading list into the repo, then the pre-seeded quiz
 * gate answered ALL AT ONCE (one recorded attempt per submit, pass >= 80%). The result shows
 * right/wrong per question and NEVER the key of a missed question: misses become review cards
 * (question on the front, keyed answer + source on the back) that arrive in the review queue
 * the next day. Submits are free and repeatable; the 50 XP is paid once.
 */
export function StudyQuestPane({ detail }: { detail: UnitDetail }) {
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
  return <StudyQuest detail={detail} sq={sq} />;
}

function StudyQuest({ detail, sq }: { detail: UnitDetail; sq: StudyQuestPublic }) {
  const api = useApi();
  const unitId = detail.unit.id;
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<(number | null)[]>(() => sq.questions.map(() => null));
  const [assisted, setAssisted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submit, setSubmit] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(detail.unit.state === 'done');
  const refreshTracks = useTracksRefresh();
  // "Learn more": which items have a reading, and (after an answer) which have a released explanation
  const [notes, setNotes] = useState<UnitNotesResponse | null>(null);
  const loadNotes = useCallback(() => {
    api.getUnitNotes?.(unitId)?.then(setNotes, () => setNotes(null));
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
  };

  return (
    <section className="panel player-work" aria-label="Study quest">
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

      {!started ? (
        <div className="toolbar">
          <span className="toolbar-spacer" />
          <button type="button" className="btn btn-primary" onClick={() => setStarted(true)}>
            <Icon name="play" /> Start quiz
          </button>
        </div>
      ) : (
        <form
          className="study-quiz"
          aria-label="Quiz gate"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {sq.questions.map((q, qi) => {
            const outcome = submit?.studyQuiz?.items[qi];
            return (
              <fieldset key={q.itemKey} className="choices" disabled={busy || submit !== null} data-testid={`question-${qi + 1}`}>
                <legend>
                  <strong>Q{qi + 1}.</strong> <InlineProse text={q.prompt} />
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
              <input type="checkbox" checked={assisted} onChange={(e) => setAssisted(e.target.checked)} disabled={submit !== null} />I had help
            </label>
            <span className="toolbar-spacer" />
            <span className="muted small">
              {answered}/{sq.questions.length} answered
            </span>
            {submit ? (
              <button type="button" className="btn" onClick={retry}>
                Try again
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={!complete || busy}>
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
      </div>
      <Link to={`/campaign/${detail.unit.trackId}`} className="muted small">
        Back to campaign
      </Link>
    </section>
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
