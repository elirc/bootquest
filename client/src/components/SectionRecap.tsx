import { useState } from 'react';
import { Link } from 'react-router-dom';
import { answerWords } from '@bootquest/shared/eb-weight';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import type { RecapMark, RecapPromptsResponse, RecapRevealResponse, RecapSubmitResponse } from '../api/types';
import { Prose } from '../lib/prose';
import { useAsync } from '../lib/useAsync';
import { LoadState } from './ui';

/** Mirrors RECAP_MIN_WORDS in shared/src/api-ext.ts (the client imports api-ext for types only; the server re-checks). */
export const RECAP_MIN_WORDS = 8;

/**
 * rv2 S1 (PLAN §2.1 items 2-3): the answer-first retrieval checkpoint, for a section recap (`section`) or a spaced
 * re-check card (`recheckItemId`). Each prompt takes typed free recall first (>= 8 words; the server checks it
 * again), then the answer is shown and the learner marks got it / partly / missed. Partly and missed ideas come
 * back as cards tomorrow. A recap pays 20 XP once; a re-check grades its card. Neither is evidence.
 */
export function SectionRecap({
  section,
  recheckItemId,
  onDone,
}: {
  section?: string;
  recheckItemId?: number;
  onDone?: (r: RecapSubmitResponse) => void;
}) {
  const api = useApi();
  const q = useAsync(
    () => (recheckItemId !== undefined ? api.getRecheck(recheckItemId) : api.getRecap(section ?? '')),
    [api, section, recheckItemId],
  );
  if (q.status !== 'ready') return <LoadState error={q.error} onRetry={q.reload} minHeight={160} />;
  return <Flow data={q.data} recheckItemId={recheckItemId} onDone={onDone} />;
}

type Done = { ideaId: string; recall: string; mark: RecapMark };

const MARKS: { mark: RecapMark; label: string }[] = [
  { mark: 'got', label: 'Got it' },
  { mark: 'partly', label: 'Partly' },
  { mark: 'missed', label: 'Missed' },
];

function Flow({ data, recheckItemId, onDone }: { data: RecapPromptsResponse; recheckItemId?: number; onDone?: (r: RecapSubmitResponse) => void }) {
  const api = useApi();
  const [index, setIndex] = useState(0);
  const [recall, setRecall] = useState('');
  const [answer, setAnswer] = useState<RecapRevealResponse | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecapSubmitResponse | null>(null);
  const prompt = data.prompts[index];
  const words = answerWords(recall);
  const label = data.kind === 'recap' ? 'Section recap' : 'Re-check';

  const reveal = async () => {
    if (!prompt || words < RECAP_MIN_WORDS || busy) return;
    setBusy(true);
    try {
      setAnswer(await api.revealIdea(data.section, { ideaId: prompt.ideaId, recall }));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const mark = async (m: RecapMark) => {
    if (!prompt || !answer || busy) return;
    const next = [...done, { ideaId: prompt.ideaId, recall, mark: m }];
    setDone(next);
    setAnswer(null);
    setRecall('');
    if (index + 1 < data.prompts.length) {
      setIndex(index + 1);
      return;
    }
    setBusy(true);
    try {
      const r = recheckItemId !== undefined ? await api.submitRecheck(recheckItemId, { items: next }) : await api.submitRecap(data.section, { items: next });
      setResult(r);
      setError(null);
      onDone?.(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="panel section-recap" role="status" data-testid="recap-done">
        <h3>
          {label} done: {data.title}
        </h3>
        <p>
          {result.xp ? `+${result.xp.amount} XP. ` : result.reviewXp ? `+${result.reviewXp.amount} XP (review). ` : ''}
          {result.reenrolled.length > 0
            ? `${result.reenrolled.length} idea${result.reenrolled.length === 1 ? '' : 's'} you marked partly or missed come${result.reenrolled.length === 1 ? 's' : ''} back as a card tomorrow.`
            : 'Every idea marked got it.'}
        </p>
        {data.kind === 'recap' && <p className="muted small">A re-check of this section comes back in 14 and in 45 days.</p>}
      </div>
    );
  }
  if (!prompt) return <p className="muted">No prompts in this checkpoint.</p>;
  return (
    <div className="panel section-recap" data-testid="section-recap">
      <header className="card-meta">
        <strong>
          {label}: {data.title}
        </strong>
        <span className="muted small">
          {index + 1} of {data.prompts.length}
        </span>
      </header>
      <div className="prose" data-testid="recap-prompt">
        <Prose text={prompt.prompt} />
      </div>
      <label className="small" htmlFor={`recall-${prompt.ideaId}`}>
        Your recall, in your own words (at least {RECAP_MIN_WORDS} words), before you see the answer
      </label>
      <textarea
        id={`recall-${prompt.ideaId}`}
        className="input"
        rows={4}
        value={recall}
        readOnly={answer !== null}
        onChange={(e) => setRecall(e.target.value)}
        data-testid="recap-recall"
      />
      {answer === null ? (
        <p>
          <button type="button" className="btn btn-primary" onClick={() => void reveal()} disabled={busy || words < RECAP_MIN_WORDS} data-testid="recap-reveal">
            Show the answer
          </button>{' '}
          <span className="muted small">{words < RECAP_MIN_WORDS ? `${words}/${RECAP_MIN_WORDS} words` : 'ready'}</span>
        </p>
      ) : (
        <div className="card-back" data-testid="recap-answer">
          <Prose text={answer.answer} />
          <p className="muted small">Why it matters: {answer.why}</p>
          {answer.sources.some((s) => s.unitId !== null) && (
            <p className="small">
              Sources:{' '}
              {answer.sources
                .filter((s) => s.unitId !== null)
                .map((s, i) => (
                  <span key={s.key}>
                    {i > 0 && ' · '}
                    <Link to={`/play/${s.unitId}`}>{s.title ?? s.key}</Link>
                  </span>
                ))}
            </p>
          )}
          <div className="grade-bar">
            {MARKS.map((m) => (
              <button key={m.mark} type="button" className="btn" onClick={() => void mark(m.mark)} disabled={busy} data-testid={`recap-mark-${m.mark}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
