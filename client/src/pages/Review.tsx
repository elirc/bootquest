import { Prose, ProseBlocks, parseProse } from '../lib/prose';
import { useCallback, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import { isApiError, type GradeResponse, type KeyIdeaRefDto, type ReviewGrade, type ReviewQueueItem, type ReviewQueueResponse } from '../api/types';
import { SectionRecap } from '../components/SectionRecap';
import { useDueReport } from '../components/AppShell';
import { Icon } from '../components/Icon';
import { Chip, Kbd, LoadState, PageHeader, ProgressBar } from '../components/ui';
import { LearnMoreButton } from '../components/LearnMore';
import { fmtWhen } from '../lib/format';
import { useKeydown } from '../lib/keys';
import { bareKeyBlocked } from '../lib/shortcuts';
import { useAsync } from '../lib/useAsync';
import { COMPETENCY_LABEL } from '../lib/view';

export const GRADES: { grade: ReviewGrade; key: string; label: string; hint: string }[] = [
  { grade: 'again', key: '1', label: 'Again', hint: 'forgot' },
  { grade: 'hard', key: '2', label: 'Hard', hint: 'struggled' },
  { grade: 'good', key: '3', label: 'Good', hint: 'recalled' },
  { grade: 'easy', key: '4', label: 'Easy', hint: 'instant' },
];

/**
 * True when a Review shortcut (Space / Enter to flip, 1-4 to grade) must NOT fire for this key
 * event: the shared bare-key gate (lib/shortcuts.ts) — a dialog in front, a repeat or handled
 * key, a chord or typing, a focused control that owns Space / Enter, or a widget that takes digits.
 */
export const reviewKeyBlocked = (e: KeyboardEvent): boolean => bareKeyBlocked(e);

/** the quest item a seeded card is about ('quiz-miss:<key>' / 'flashcard:<key>'), else null */
export function seededItemKey(cardKey: string): string | null {
  const m = /^(?:quiz-miss|flashcard):(.+)$/.exec(cardKey);
  return m ? m[1]! : null;
}

/** rv2 S1: mirrors shared/src/api-ext.ts (the client imports api-ext for types only). */
export const KEYIDEA_SESSION_CAP = 12;
export const KEYIDEA_TEN_MINUTE_CAP = 5;
/** F8: the 10-minute mode's hard cap on cards served in one Review session (holds across paging). */
export const TEN_MINUTE_CARD_CAP = 20;

/** The concept card kinds the Review page renders in their own way (rv2 S1). */
export const conceptKind = (cardKey: string): 'keyidea' | 'redo' | 'recheck' | 'other' =>
  cardKey.startsWith('keyidea:') ? 'keyidea' : cardKey.startsWith('redo:') ? 'redo' : cardKey.startsWith('recheck:') ? 'recheck' : 'other';

type SessionItem = ReviewQueueItem & { keyIdea?: KeyIdeaRefDto };
type SessionPage = { count: number; items: SessionItem[]; tags?: { tag: string; count: number }[] };

/**
 * /review                   the whole due queue
 * /review?ten=1             F8: the 10-minute mode, hard-capped at TEN_MINUTE_CARD_CAP cards across paging
 * /review?mode=keyideas     rv2: the interleaved key-ideas session (due key-idea cards from every section, no two
 *                           neighbours from one section; capped at 12, 5 with ten=1); &tag=<tag> = the concept index
 */
export function ReviewPage() {
  const api = useApi();
  const [params] = useSearchParams();
  const keyideas = params.get('mode') === 'keyideas';
  const ten = params.get('ten') === '1';
  const tag = params.get('tag') ?? undefined;
  const fetchPage = useCallback(
    (): Promise<SessionPage> => (keyideas ? api.getKeyIdeaQueue({ ...(tag ? { tag } : {}), ...(ten ? { limit: KEYIDEA_TEN_MINUTE_CAP } : {}) }) : api.getReviewQueue()),
    [api, keyideas, tag, ten],
  );
  const q = useAsync(fetchPage, [fetchPage]);
  const cap = keyideas ? (ten ? KEYIDEA_TEN_MINUTE_CAP : KEYIDEA_SESSION_CAP) : ten ? TEN_MINUTE_CARD_CAP : undefined;
  const tags = q.status === 'ready' ? (q.data.tags ?? []) : [];
  return (
    <>
      <PageHeader eyebrow="Spaced repetition" title={keyideas ? 'Key ideas session' : 'Review session'} />
      <p className="small review-modes" data-testid="review-modes">
        {keyideas ? <Link to={`/review${ten ? '?ten=1' : ''}`}>Whole review queue</Link> : <Link to={`/review?mode=keyideas${ten ? '&ten=1' : ''}`}>Key ideas session</Link>}
        {ten && <span className="muted"> · 10-minute mode: stop after {cap} cards</span>}
      </p>
      {keyideas && tags.length > 0 && (
        <p className="small review-tags" data-testid="review-tags">
          <Link to={`/review?mode=keyideas${ten ? '&ten=1' : ''}`} aria-current={tag === undefined ? 'true' : undefined}>
            <Chip tone={tag === undefined ? 'accent' : 'neutral'}>all</Chip>
          </Link>{' '}
          {tags.map((t) => (
            <Link key={t.tag} to={`/review?mode=keyideas&tag=${encodeURIComponent(t.tag)}${ten ? '&ten=1' : ''}`} aria-current={tag === t.tag ? 'true' : undefined}>
              <Chip tone={tag === t.tag ? 'accent' : 'neutral'}>
                #{t.tag} {t.count}
              </Chip>
            </Link>
          ))}
        </p>
      )}
      {q.status === 'ready' ? (
        <Session key={`${keyideas}|${tag ?? ''}|${ten}`} first={q.data} fetchPage={fetchPage} cap={cap} />
      ) : (
        <LoadState error={q.error} onRetry={q.reload} minHeight={420} />
      )}
    </>
  );
}

/**
 * BUG-2 (ab wave S2): GET /reviews/queue serves one page (200 by default) plus the server's due
 * COUNT. When a page was cut short (count > items.length) and the session reaches its end, it
 * fetches the queue again and carries on: graded cards have left the due set, so a plain refetch
 * IS the next batch (no offset: an offset over a shrinking set would skip cards). The done panel
 * says "Queue cleared" only when the server's latest count (the last grade's remainingDue) is 0;
 * otherwise "Session done" with the count and a button that fetches the cards due again (a card
 * graded Again returns after a short FSRS step). A card the server refused (NOT_DUE) is never
 * served again in this session, so a refetch can never loop on it.
 */
type Paging = 'idle' | 'loading' | 'error' | 'stalled';

function Session({ first, fetchPage, cap }: { first: ReviewQueueResponse | SessionPage; fetchPage?: () => Promise<SessionPage>; cap?: number }) {
  const api = useApi();
  const [cards, setCards] = useState<SessionItem[]>(first.items);
  // the server's due count: the queue response's, then each grade's remainingDue
  const [due, setDue] = useState(first.count);
  // the last fetched page was cut short: more due cards wait beyond it
  const [more, setMore] = useState(first.count > first.items.length);
  const [paging, setPaging] = useState<Paging>('idle');
  // cards the server refused (NOT_DUE) in this session: a refetch never serves them again
  const refused = useRef(new Set<number>());
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [xp, setXp] = useState(0);
  const [tally, setTally] = useState<Record<ReviewGrade, number>>({ again: 0, hard: 0, good: 0, easy: 0 });
  const [error, setError] = useState<string | null>(null);
  // fix/client-dash: a lapse on a Review-state card can demote its competency; say so, loudly
  const [demotions, setDemotions] = useState<Demotion[]>([]);
  // fix-wave 6b: the soonest GradeResponse.nextDueAt of this session's grades, shown once the queue
  // is cleared. Only graded cards carry one; the queue endpoint serves no next-due time, so a session
  // that ARRIVES empty ("Nothing due") deliberately shows no next-due line (skipped by design).
  const [nextDueAt, setNextDueAt] = useState<number | null>(null);
  const busy = useRef(false);
  const reportDue = useDueReport();
  // F8 / rv2: a capped session serves at most `cap` cards, whatever the paging brings
  const capped = cap !== undefined && index >= cap;
  const card = capped ? undefined : cards[index];
  const lastOfPage = index + 1 >= cards.length;
  const atCap = cap !== undefined && index + 1 >= cap;
  const special = card ? conceptKind(card.cardKey) : 'other';

  const fetchMore = async () => {
    if (atCap) return;
    setPaging('loading');
    try {
      const r = await (fetchPage ? fetchPage() : api.getReviewQueue());
      const fresh = r.items.filter((it) => !refused.current.has(it.id));
      setDue(r.count);
      setMore(r.count > r.items.length);
      setCards((cs) => [...cs, ...fresh]);
      // only cards the server already refused came back: stop instead of looping
      setPaging(fresh.length === 0 && r.count > 0 ? 'stalled' : 'idle');
      setError(null);
    } catch (e) {
      setError(errorText(e));
      setPaging('error');
    }
  };

  /** move past a card without a grade (a redo card is graded by its run; a finished re-check by its prompts) */
  const advance = () => {
    if (card) refused.current.add(card.id); // a refetch never serves a skipped card again this session
    setRevealed(false);
    setIndex((i) => i + 1);
    if (lastOfPage && more && !atCap) void fetchMore();
  };

  const grade = async (g: ReviewGrade) => {
    if (!card || !revealed || busy.current || special === 'redo' || special === 'recheck') return;
    busy.current = true;
    try {
      const r = await api.gradeReview(card.id, g);
      reportDue(r.remainingDue); // W11: the nav badge counts down live
      setDue(r.remainingDue);
      const dem = r.demotion;
      if (dem) setDemotions((ds) => [dem, ...ds]);
      setNextDueAt((n) => (n === null ? r.nextDueAt : Math.min(n, r.nextDueAt)));
      setXp((x) => x + r.xp.amount);
      setTally((t) => ({ ...t, [g]: t[g] + 1 }));
      setRevealed(false);
      setIndex((i) => i + 1);
      setError(null);
      if (lastOfPage && more && r.remainingDue > 0 && !atCap) void fetchMore();
    } catch (e) {
      setError(errorText(e));
      // NOT_DUE: the server will not take a grade for this card today; move on.
      if (isApiError(e, 'NOT_DUE')) {
        refused.current.add(card.id);
        setRevealed(false);
        setIndex((i) => i + 1);
        if (lastOfPage && more && !atCap) void fetchMore();
      }
    } finally {
      busy.current = false;
    }
  };

  useKeydown((e) => {
    if (!card || reviewKeyBlocked(e) || special === 'recheck') return;
    if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      setRevealed(true);
      return;
    }
    const hit = GRADES.find((g) => g.key === e.key);
    if (hit && revealed && special !== 'redo') {
      e.preventDefault();
      void grade(hit.grade);
    }
  });

  if (!card && (paging === 'loading' || paging === 'error')) {
    return (
      <div className="review">
        <Demotions items={demotions} />
        <div className="panel review-done" aria-live="polite" data-testid="review-next-page">
          {paging === 'loading' ? (
            <p className="muted">
              Batch done ({cards.length} cards). Loading the next {due} due…
            </p>
          ) : (
            <>
              <p className="error-text" role="alert">
                {error}
              </p>
              <button type="button" className="btn" onClick={() => void fetchMore()}>
                Load the next cards
              </button>
              <Link to="/" className="btn">
                Back to dashboard
              </Link>
            </>
          )}
        </div>
      </div>
    );
  }

  if (cards.length === 0 || !card) {
    // "Queue cleared" only on the server's word: its latest due count is 0
    const left = cards.length > 0 && due > 0 && !capped;
    return (
      <div className="review">
        <Demotions items={demotions} />
        <div className="panel review-done" role="status">
          <Icon name="check" size={24} />
          <h2>{cards.length === 0 ? 'Nothing due' : due > 0 ? 'Session done' : 'Queue cleared'}</h2>
          {capped && (
            <p className="muted small" data-testid="session-cap">
              Stop here: this session ends after {cap} cards{due > 0 ? ` (${due} still due for another day or a full session)` : ''}.
            </p>
          )}
          {cards.length > 0 && (
            <p>
              {cards.length} cards · +{xp} XP · {GRADES.map((g) => `${g.label} ${tally[g.grade]}`).join(' · ')}
            </p>
          )}
          {left && (
            <p className="muted small" data-testid="still-due">
              {due} {due === 1 ? 'card is' : 'cards are'} still due
              {paging === 'stalled' ? ', but the server would not take a grade for them now. Try again later.' : ' (a card graded Again comes back after a short step).'}
            </p>
          )}
          {left && paging !== 'stalled' && (
            <button type="button" className="btn btn-primary" onClick={() => void fetchMore()}>
              Review the {due} due
            </button>
          )}
          {cards.length > 0 && !left && nextDueAt !== null && (
            <p className="muted small" data-testid="next-due">
              Next card due {fmtWhen(nextDueAt)}.
            </p>
          )}
          <Link to="/" className="btn">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  // the session total counts the due cards beyond this page too (the queue serves 200 at a time); a cap bounds it
  const total = Math.min(more ? Math.max(cards.length, index + due) : cards.length, cap ?? Number.POSITIVE_INFINITY);

  return (
    <div className="review">
      <Demotions items={demotions} />
      <div className="review-progress">
        <span>
          Card <strong>{index + 1}</strong> of {total}
        </span>
        <ProgressBar value={index} max={total} label="Review progress" tone="info" />
        <span className="muted">+{xp} XP</span>
        {/* the running grade tally once a grade has landed (the done panel shows the final one).
            Plain text, never a live region: role=status belongs to the done panel */}
        {GRADES.some((g) => tally[g.grade] > 0) && (
          <span className="review-tally muted small" data-testid="session-tally">
            {GRADES.map((g) => `${g.label} ${tally[g.grade]}`).join(' · ')}
          </span>
        )}
      </div>

      {special === 'recheck' ? (
        <SectionRecap
          key={card.id}
          recheckItemId={card.id}
          onDone={(r) => {
            setXp((x) => x + (r.reviewXp?.amount ?? 0));
            setDue((d) => Math.max(0, d - 1));
            reportDue(Math.max(0, due - 1));
            window.setTimeout(advance, 0);
          }}
        />
      ) : (
      <>
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
                  {special === 'keyidea' && <KeyIdeaLinks itemId={card.id} known={card.keyIdea} />}
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
        {special === 'redo' ? (
          <RedoLinks itemId={card.id} onSkip={advance} />
        ) : revealed ? (
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
      </>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** rv2: a key-idea card's source units and tags (the card text names them; this links them). */
function KeyIdeaLinks({ itemId, known }: { itemId: number; known?: KeyIdeaRefDto }) {
  const api = useApi();
  const q = useAsync(() => (known ? Promise.resolve(known) : api.getConceptCard(itemId).then((c) => c.keyIdea ?? null)), [api, itemId, known]);
  const k = q.status === 'ready' ? q.data : null;
  if (!k) return null;
  const live = k.sources.filter((s) => s.unitId !== null);
  return (
    <p className="small" data-testid="keyidea-links">
      {live.map((s, i) => (
        <span key={s.key}>
          {i > 0 && ' · '}
          <Link to={`/play/${s.unitId}`}>{s.title ?? s.key}</Link>
        </span>
      ))}
      {k.tags.map((t) => (
        <span key={t}>
          {' '}
          <Link to={`/review?mode=keyideas&tag=${encodeURIComponent(t)}`}>#{t}</Link>
        </span>
      ))}
    </p>
  );
}

/** rv2: a redo card is done in the Player (practice mode); its run grades it. Here: the link, or skip. */
function RedoLinks({ itemId, onSkip }: { itemId: number; onSkip: () => void }) {
  const api = useApi();
  const q = useAsync(() => api.getConceptCard(itemId), [api, itemId]);
  const target = q.status === 'ready' ? (q.data.redo ?? null) : null;
  return (
    <>
      {target ? (
        <Link to={`/play/${target.unitId}?redo=${itemId}`} className="btn btn-primary" data-testid="redo-open">
          Redo {target.title} in practice mode
        </Link>
      ) : q.status === 'ready' ? (
        <span className="muted small">No drill of this key idea is loaded on this server.</span>
      ) : null}
      <button type="button" className="btn" onClick={onSkip}>
        Skip for now
      </button>
    </>
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
        <p className="muted small">A lapse (Again on a card you had already learned) drops its competency one notch: at most once per competency per day, and never below 1. Win it back with the three promotion legs.</p>
      </div>
    </div>
  );
}
