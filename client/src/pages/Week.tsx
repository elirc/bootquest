// rv2 S3 (PLAN F7): the weekly review. One GET /week (Monday..Sunday of the week holding ?start=, default this
// week): estimated time, units passed, XP, reviews, key ideas rated again twice, the notebook's top categories, and
// the three-question reflection (POST /week/reflection: 0 XP, a later save supersedes). Every number is the
// server's; this page only renders them.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import type { WeekResponse } from '../api/types';
import { LoadState, PageHeader, Panel } from '../components/ui';
import { NOTE_CATEGORY_LABEL } from './Player/NotebookLine';
import { useAsync } from '../lib/useAsync';

/** Shift a day key by n days (calendar arithmetic on UTC fields; day keys carry no zone). */
export function shiftDay(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const longDay = (key: string): string =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function WeekPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const start = params.get('start') ?? undefined;
  const q = useAsync(() => api.getWeek(start), [api, start]);
  const go = (key: string) => setParams({ start: key });
  return (
    <div className="page-col">
      <PageHeader
        eyebrow="Weekly review"
        title={q.data ? `${longDay(q.data.start)} – ${longDay(q.data.end)}` : 'This week'}
        actions={
          q.data && (
            <span className="toolbar">
              <button type="button" className="btn btn-sm" onClick={() => go(shiftDay(q.data!.start, -7))} data-testid="week-prev">
                Previous week
              </button>
              {q.data.end < q.data.today && (
                <button type="button" className="btn btn-sm" onClick={() => go(shiftDay(q.data!.start, 7))} data-testid="week-next">
                  Next week
                </button>
              )}
            </span>
          )
        }
      />
      {q.status !== 'ready' ? <LoadState error={q.error} onRetry={q.reload} minHeight={400} /> : <WeekBody key={q.data.start} w={q.data} />}
    </div>
  );
}

function WeekBody({ w }: { w: WeekResponse }) {
  const h = Math.floor(w.time.estMinutes / 60);
  const m = w.time.estMinutes % 60;
  return (
    <div className="week" data-testid="week">
      <div className="tiles">
        <div className="tile" data-testid="week-time" title={w.time.rule}>
          <h2 className="tile-label">Time (estimated)</h2>
          <div className="tile-value">
            {h > 0 ? `${h} h ` : ''}
            {m} min
          </div>
          <p className="muted small">
            {plural(w.time.sittings, 'sitting')} on {plural(w.time.activeDays, 'day')}
          </p>
        </div>
        <div className="tile" data-testid="week-passes">
          <h2 className="tile-label">Units passed</h2>
          <div className="tile-value">{w.passes.units}</div>
          <p className="muted small">
            {w.passes.firstTime} for the first time{w.passes.selfScored > 0 ? ` · ${plural(w.passes.selfScored, 'answer')} self-scored` : ''}
          </p>
        </div>
        <div className="tile" data-testid="week-xp">
          <h2 className="tile-label">XP</h2>
          <div className="tile-value">{w.xp}</div>
        </div>
        <div className="tile" data-testid="week-reviews">
          <h2 className="tile-label">Reviews</h2>
          <div className="tile-value">{w.reviews.graded}</div>
          <p className="muted small">{w.reviews.again} rated again</p>
        </div>
      </div>
      {w.passes.byKind.length > 0 && (
        <p className="small" data-testid="week-kinds">
          Passed by kind: {w.passes.byKind.map((k) => `${k.units} ${k.kind}`).join(' · ')}
        </p>
      )}
      <Panel title="Key ideas to revisit">
        {w.shakyIdeas.length === 0 ? (
          <p className="muted" data-testid="week-shaky-empty">
            No key idea was rated again twice this week.
          </p>
        ) : (
          <>
            <ul className="week-shaky" data-testid="week-shaky">
              {w.shakyIdeas.map((s) => (
                <li key={s.cardKey}>
                  {s.idea ?? `${s.section} / ${s.ideaId}`} <span className="muted small">· rated again {s.again} times</span>
                </li>
              ))}
            </ul>
            <p className="small">
              <Link to="/review?mode=keyideas">Key ideas session</Link>
            </p>
          </>
        )}
      </Panel>
      <Panel title="Notebook">
        {w.notebook.entries === 0 ? (
          <p className="muted" data-testid="week-notebook-empty">
            No notebook entries this week.
          </p>
        ) : (
          <p data-testid="week-notebook">
            {plural(w.notebook.entries, 'entry', 'entries')}. Most often:{' '}
            {w.notebook.topCategories.map((c, i) => (
              <span key={c.category}>
                {i > 0 && ', '}
                {NOTE_CATEGORY_LABEL[c.category]} ({c.count})
              </span>
            ))}
            .
          </p>
        )}
      </Panel>
      <Reflection w={w} />
    </div>
  );
}

function Reflection({ w }: { w: WeekResponse }) {
  const api = useApi();
  const [answers, setAnswers] = useState<string[]>(() => w.reflection.questions.map((_, i) => w.reflection.answers?.[i] ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [answers]);
  const future = w.start > w.today;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveWeekReflection({ start: w.start, answers });
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Reflection">
      <p className="muted small">
        Three questions, in your own words. Not graded, no XP; a later save replaces this one on the page.
        {w.reflection.savedAt !== null && ` Last saved ${new Date(w.reflection.savedAt).toLocaleString()}.`}
      </p>
      <ol className="week-reflection">
        {w.reflection.questions.map((question, i) => (
          <li key={question}>
            <label>
              <span>{question}</span>
              <textarea
                className="answer-text"
                rows={3}
                maxLength={1000}
                value={answers[i] ?? ''}
                aria-label={`Reflection ${i + 1}`}
                onChange={(e) => {
                  const v = e.target.value;
                  setAnswers((p) => p.map((a, j) => (j === i ? v : a)));
                }}
                disabled={future}
              />
            </label>
          </li>
        ))}
      </ol>
      <div className="toolbar">
        <span className="toolbar-spacer" />
        {saved && (
          <span className="muted small" role="status" data-testid="week-saved">
            Saved.
          </span>
        )}
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || future || answers.every((a) => a.trim() === '')}>
          Save reflection
        </button>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}
