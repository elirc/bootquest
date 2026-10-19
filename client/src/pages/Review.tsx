import { Prose, ProseBlocks, parseProse } from '../lib/prose';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import { isApiError, type GradeResponse, type ReviewGrade, type ReviewQueueItem } from '../api/types';
import { useDueReport } from '../components/AppShell';
import { Icon } from '../components/Icon';
import { Chip, Kbd, LoadState, PageHeader, ProgressBar } from '../components/ui';
import { LearnMoreButton } from '../components/LearnMore';
import { hasModifier, isEditableTarget, useKeydown } from '../lib/keys';
import { useAsync } from '../lib/useAsync';
import { COMPETENCY_LABEL } from '../lib/view';

export const GRADES: { grade: ReviewGrade; key: string; label: string; hint: string }[] = [
  { grade: 'again', key: '1', label: 'Again', hint: 'forgot' },
  { grade: 'hard', key: '2', label: 'Hard', hint: 'struggled' },
  { grade: 'good', key: '3', label: 'Good', hint: 'recalled' },
  { grade: 'easy', key: '4', label: 'Easy', hint: 'instant' },
];

// TODO(unify): Player grows the same shortcut gating in parallel (fix/client-player); fold both
// into lib/keys once they land. Kept local and small on purpose.
const OVERLAY_OPEN = '[role="dialog"], [aria-modal="true"], dialog[open]';
/** Controls a focused Space / Enter belongs to (native activation wins over the page shortcut). */
const ACTIVATES = 'a[href], button, summary, select, input, textarea, [contenteditable="true"], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]';
/** Widgets that may consume digit keys themselves. */
const TAKES_DIGITS = '[role="radiogroup"], [role="listbox"], [role="menu"], [role="tablist"], [role="slider"], [role="spinbutton"], [role="grid"]';

/** True when a Review shortcut must NOT fire for this key event. */
export function reviewKeyBlocked(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.repeat || hasModifier(e) || isEditableTarget(e.target)) return true;
  if (document.querySelector(OVERLAY_OPEN)) return true; // a dialog / drawer owns the keyboard
  const el = e.target instanceof Element && e.target !== document.body ? e.target : null;
  if (!el) return false;
  if (e.key === ' ' || e.key === 'Enter') return el.closest(ACTIVATES) !== null;
  return el.closest(TAKES_DIGITS) !== null;
}

/** the quest item a seeded card is about ('quiz-miss:<key>' / 'flashcard:<key>'), else null */
export function seededItemKey(cardKey: string): string | null {
  const m = /^(?:quiz-miss|flashcard):(.+)$/.exec(cardKey);
  return m ? m[1]! : null;
}

export function ReviewPage() {
  const api = useApi();
  const q = useAsync(() => api.getReviewQueue(), [api]);
  return (
    <>
      <PageHeader eyebrow="Spaced repetition" title="Review session" />
      {q.status === 'ready' ? <Session cards={q.data.items} /> : <LoadState error={q.error} onRetry={q.reload} minHeight={420} />}
    </>
  );
}

function Session({ cards }: { cards: ReviewQueueItem[] }) {
  const api = useApi();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [xp, setXp] = useState(0);
  const [tally, setTally] = useState<Record<ReviewGrade, number>>({ again: 0, hard: 0, good: 0, easy: 0 });
  const [error, setError] = useState<string | null>(null);
  // fix/client-dash: a lapse on a Review-state card can demote its competency; say so, loudly
  const [demotions, setDemotions] = useState<Demotion[]>([]);
  const busy = useRef(false);
  const reportDue = useDueReport();
  const card = cards[index];

  const grade = async (g: ReviewGrade) => {
    if (!card || !revealed || busy.current) return;
    busy.current = true;
    try {
      const r = await api.gradeReview(card.id, g);
      reportDue(r.remainingDue); // W11: the nav badge counts down live
      const dem = r.demotion;
      if (dem) setDemotions((ds) => [dem, ...ds]);
      setXp((x) => x + r.xp.amount);
      setTally((t) => ({ ...t, [g]: t[g] + 1 }));
      setRevealed(false);
      setIndex((i) => i + 1);
      setError(null);
    } catch (e) {
      setError(errorText(e));
      // NOT_DUE: the server will not take a grade for this card today; move on.
      if (isApiError(e, 'NOT_DUE')) {
        setRevealed(false);
        setIndex((i) => i + 1);
      }
    } finally {
      busy.current = false;
    }
  };

  useKeydown((e) => {
    if (!card || reviewKeyBlocked(e)) return;
    if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      setRevealed(true);
      return;
    }
    const hit = GRADES.find((g) => g.key === e.key);
    if (hit && revealed) {
      e.preventDefault();
      void grade(hit.grade);
    }
  });

  if (cards.length === 0 || !card) {
    return (
      <div className="review">
        <Demotions items={demotions} />
        <div className="panel review-done" role="status">
          <Icon name="check" size={24} />
          <h2>{cards.length === 0 ? 'Nothing due' : 'Queue cleared'}</h2>
          {cards.length > 0 && (
            <p>
              {cards.length} cards · +{xp} XP · {GRADES.map((g) => `${g.label} ${tally[g.grade]}`).join(' · ')}
            </p>
          )}
          <Link to="/" className="btn">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="review">
      <Demotions items={demotions} />
      <div className="review-progress">
        <span>
          Card <strong>{index + 1}</strong> of {cards.length}
        </span>
        <ProgressBar value={index} max={cards.length} label="Review progress" tone="info" />
        <span className="muted">+{xp} XP</span>
      </div>

      <article className={`card${revealed ? ' card-revealed' : ''}`} aria-live="polite">
        <header className="card-meta">
          <Chip>{card.kind}</Chip>
          {card.competencyId && <Chip>{card.competencyId}</Chip>}
          <span className="muted small">{card.unitId !== null ? `unit #${card.unitId}` : 'standalone card'}</span>
        </header>
        <div className="card-face">
          {/* W8: seeded cards (study-quest misses, flashcards) carry their text; others show the key. */}
          {card.card ? (
            <div className="card-front prose" data-testid="card-front">
              <ProseBlocks blocks={parseProse(card.card.front)} />
            </div>
          ) : (
            <p className="card-front">
              <code>{card.cardKey}</code>
            </p>
          )}
          <div className="card-back-slot">
            {revealed ? (
              card.card ? (
                <div className="card-back" data-testid="card-back">
                  <Prose text={card.card.back} />
                  {card.card.source && <p className="muted small">Source: {card.card.source}</p>}
                  {card.unitId !== null && seededItemKey(card.cardKey) && (
                    <LearnMoreButton key={card.id} unitId={card.unitId} target={seededItemKey(card.cardKey)!} subject="this card" hotkey />
                  )}
                </div>
              ) : (
                <p className="card-back" data-testid="card-back">
                  Card text is not served by the API yet. Grade how well you recalled <code>{card.cardKey}</code>.
                </p>
              )
            ) : (
              <span className="muted">Recall the answer, then reveal.</span>
            )}
          </div>
        </div>
      </article>

      <div className="grade-bar">
        {revealed ? (
          GRADES.map((g) => (
            <button key={g.grade} type="button" className={`btn grade grade-${g.grade}`} onClick={() => void grade(g.grade)}>
              <Kbd>{g.key}</Kbd>
              <span className="grade-label">{g.label}</span>
              <span className="grade-hint">{g.hint}</span>
            </button>
          ))
        ) : (
          <button type="button" className="btn btn-primary reveal" onClick={() => setRevealed(true)}>
            Show answer <Kbd>Space</Kbd>
          </button>
        )}
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type Demotion = NonNullable<GradeResponse['demotion']>;

/**
 * fix/client-dash: GradeResponse.demotion rendered (it used to pass without a word). The server
 * already wrote the demotion evidence; this names the competency, the notch it lost and links the row.
 */
function Demotions({ items }: { items: Demotion[] }) {
  if (items.length === 0) return null;
  return (
    <div className="demotion" role="alert" data-testid="demotion">
      <Icon name="warn" size={18} />
      <div>
        <ul className="demotion-list">
          {items.map((d) => (
            <li key={d.evidenceId}>
              <strong>
                {COMPETENCY_LABEL[d.competency]} demoted: {d.from} → {d.to}
              </strong>{' '}
              <Link to={`/stats?competency=${d.competency}#evidence-${d.evidenceId}`}>evidence #{d.evidenceId}</Link>
            </li>
          ))}
        </ul>
        <p className="muted small">A lapse (Again) on a review card this competency already knew drops it one notch. Win it back with the three promotion legs.</p>
      </div>
    </div>
  );
}
