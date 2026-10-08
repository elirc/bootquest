import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api/context';
import type { Exercise, QuizAnswerResult, RunResult, SubmitResult, TestCaseResult } from '../api/types';
import { Icon } from '../components/Icon';
import { Chip, Kbd, LoadState, PageHeader } from '../components/ui';
import { hasModifier, isEditableTarget, isMod, useKeydown } from '../lib/keys';
import { useAsync } from '../lib/useAsync';

export function PlayerPage() {
  const { unitId = '' } = useParams();
  const api = useApi();
  const q = useAsync(() => api.getExercise(unitId), [api, unitId]);
  if (q.status !== 'ready') {
    return (
      <>
        <PageHeader eyebrow="Exercise" title={q.status === 'error' ? 'Unit not found' : ' '} />
        <LoadState error={q.error} onRetry={q.reload} minHeight={560} />
      </>
    );
  }
  // Keyed so switching units resets editor + results state.
  return <Player key={q.data.id} ex={q.data} />;
}

type Outcome = { kind: 'run'; run: RunResult } | { kind: 'submit'; submit: SubmitResult };

function Player({ ex }: { ex: Exercise }) {
  const api = useApi();
  const [code, setCode] = useState(ex.starterCode);
  const [assisted, setAssisted] = useState(false);
  const [busy, setBusy] = useState<null | 'run' | 'submit'>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (kind: 'run' | 'submit') => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'run') setOutcome({ kind, run: await api.runExercise(ex.id, code) });
      else setOutcome({ kind, submit: await api.submitAttempt(ex.id, code, assisted ? 'self' : 'none') });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  useKeydown((e) => {
    if (ex.quiz || !isMod(e) || e.key !== 'Enter') return;
    e.preventDefault();
    void go(e.shiftKey ? 'submit' : 'run');
  });

  return (
    <>
      <PageHeader
        eyebrow={
          <nav aria-label="Breadcrumb" className="crumbs">
            {ex.breadcrumb.map((b, i) => (
              <span key={i}>{b}</span>
            ))}
          </nav>
        }
        title={ex.title}
        actions={
          <span className="chips">
            <Chip>{ex.kind}</Chip>
            <Chip>difficulty {ex.difficulty}</Chip>
            <Chip tone="accent">{ex.xp} XP</Chip>
          </span>
        }
      />
      <div className="player">
        <section className="panel player-instructions" aria-labelledby="ins-title">
          <h2 className="panel-title" id="ins-title">
            Instructions
          </h2>
          {ex.instructions.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <div className="ins-foot">
            <span className="muted">Competencies</span>
            <span className="chips">
              {ex.competencies.map((c) => (
                <Chip key={c}>{c}</Chip>
              ))}
            </span>
          </div>
        </section>

        {ex.quiz ? (
          <QuizPane ex={ex} />
        ) : (
          <section className="panel player-work" aria-label="Solution">
            <div className="editor-head">
              <span className="editor-lang">{ex.language}</span>
              <span className="muted">Editor stub — CodeMirror lands in W2</span>
            </div>
            <EditorStub value={code} onChange={setCode} language={ex.language} />
            <div className="toolbar">
              <label className="check">
                <input type="checkbox" checked={assisted} onChange={(e) => setAssisted(e.target.checked)} />
                I had help (self-flag assistance)
              </label>
              <span className="toolbar-spacer" />
              <button type="button" className="btn" onClick={() => void go('run')} disabled={busy !== null}>
                <Icon name="play" /> {busy === 'run' ? 'Running…' : 'Run'} <Kbd>Ctrl</Kbd>
                <Kbd>Enter</Kbd>
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void go('submit')} disabled={busy !== null}>
                <Icon name="check" /> {busy === 'submit' ? 'Submitting…' : 'Submit'} <Kbd>Ctrl</Kbd>
                <Kbd>Shift</Kbd>
                <Kbd>Enter</Kbd>
              </button>
            </div>
            <Results outcome={outcome} error={error} busy={busy !== null} />
          </section>
        )}
      </div>
    </>
  );
}

function EditorStub({ value, onChange, language }: { value: string; onChange: (v: string) => void; language: string }) {
  const lines = Math.max(value.split('\n').length, 12);
  const gutter = useRef<HTMLDivElement>(null);
  return (
    <div className="editor">
      <div className="editor-gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <textarea
        className="editor-text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={`Code editor (${language})`}
        rows={lines}
      />
    </div>
  );
}

const VERDICT_TEXT: Record<RunResult['verdict'], string> = {
  pass: 'All checks passed',
  fail: 'Checks failed',
  todo: 'Not attempted yet',
  crashed: 'Runner crashed',
  timeout: 'Timed out',
  error: 'Runner error',
};

function Results({ outcome, error, busy }: { outcome: Outcome | null; error: string | null; busy: boolean }) {
  const run = outcome ? (outcome.kind === 'run' ? outcome.run : outcome.submit.run) : null;
  return (
    <div className="results" aria-live="polite" aria-busy={busy} data-testid="results">
      {error ? (
        <div className="verdict verdict-error" role="alert">
          <Icon name="warn" /> {error}
        </div>
      ) : !run ? (
        <div className="results-empty">
          <p>
            Run checks to see structured results here. Runs are free; <strong>Submit</strong> records an immutable attempt.
          </p>
        </div>
      ) : (
        <>
          <div className={`verdict verdict-${run.verdict}`}>
            <Icon name={run.verdict === 'pass' ? 'check' : 'warn'} />
            <strong>{VERDICT_TEXT[run.verdict]}</strong>
            <span className="muted">
              {run.tests.filter((t) => t.status === 'pass').length}/{run.tests.length} · {run.durationMs} ms
              {outcome?.kind === 'run' ? ' · practice run (not recorded)' : ''}
            </span>
            {outcome?.kind === 'submit' && (
              <span className="verdict-xp">
                {outcome.submit.xpAwarded > 0 ? `+${outcome.submit.xpAwarded} XP` : outcome.submit.xpZeroReason ? `0 XP (${outcome.submit.xpZeroReason})` : '0 XP'}
                {' · attempt '}
                <code>{outcome.submit.attemptId}</code>
              </span>
            )}
          </div>
          <ol className="tests">
            {run.tests.map((t) => (
              <TestRow key={t.name} t={t} />
            ))}
          </ol>
          {(run.stdout || run.stderr) && (
            <details className="streams">
              <summary>Output</summary>
              {run.stdout && <pre className="stream">{run.stdout}</pre>}
              {run.stderr && <pre className="stream stream-err">{run.stderr}</pre>}
            </details>
          )}
        </>
      )}
    </div>
  );
}

function TestRow({ t }: { t: TestCaseResult }) {
  return (
    <li className={`test test-${t.status}`}>
      <span className="test-status">{t.status}</span>
      <span className="test-name">{t.name}</span>
      {t.message && <span className="test-msg">{t.message}</span>}
      {(t.expected !== null || t.actual !== null) && (
        <dl className="diff">
          <div>
            <dt>expected</dt>
            <dd>
              <code>{t.expected ?? '—'}</code>
            </dd>
          </div>
          <div>
            <dt>actual</dt>
            <dd>
              <code>{t.actual ?? '—'}</code>
            </dd>
          </div>
        </dl>
      )}
    </li>
  );
}

function QuizPane({ ex }: { ex: Exercise }) {
  const api = useApi();
  const [choice, setChoice] = useState<number | null>(null);
  const [result, setResult] = useState<QuizAnswerResult | null>(null);
  const quiz = ex.quiz!;
  const firstRadio = useRef<HTMLInputElement>(null);

  useEffect(() => firstRadio.current?.focus({ preventScroll: true }), []);

  const submit = async () => {
    if (choice === null || result) return;
    setResult(await api.submitQuizAnswer(ex.id, choice));
  };

  useKeydown((e) => {
    if (result || hasModifier(e) || (isEditableTarget(e.target) && !(e.target instanceof HTMLInputElement))) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= quiz.choices.length) {
      e.preventDefault();
      setChoice(n - 1);
    } else if (e.key === 'Enter' && choice !== null) {
      e.preventDefault();
      void submit();
    }
  });

  return (
    <section className="panel player-work" aria-labelledby="quiz-q">
      <h2 className="panel-title" id="quiz-q">
        {quiz.prompt}
      </h2>
      <pre className="code-block">{ex.starterCode}</pre>
      <fieldset className="choices" disabled={result !== null}>
        <legend className="sr-only">Answer choices</legend>
        {quiz.choices.map((c, i) => {
          const tone = result ? (i === result.correctIndex ? ' choice-right' : i === choice ? ' choice-wrong' : '') : '';
          return (
            <label key={i} className={`choice${choice === i ? ' choice-on' : ''}${tone}`}>
              <input ref={i === 0 ? firstRadio : undefined} type="radio" name="quiz" checked={choice === i} onChange={() => setChoice(i)} />
              <Kbd>{i + 1}</Kbd>
              <code>{c}</code>
            </label>
          );
        })}
      </fieldset>
      <div className="toolbar">
        <span className="toolbar-spacer" />
        <button type="button" className="btn btn-primary" disabled={choice === null || result !== null} onClick={() => void submit()}>
          Check answer <Kbd>Enter</Kbd>
        </button>
      </div>
      <div className="results" aria-live="polite">
        {result ? (
          <div className={`verdict verdict-${result.correct ? 'pass' : 'fail'}`}>
            <Icon name={result.correct ? 'check' : 'warn'} />
            <strong>{result.correct ? 'Correct' : 'Not quite'}</strong>
            <span className="verdict-xp">+{result.xpAwarded} XP</span>
            <p className="verdict-explain">{result.explanation}</p>
          </div>
        ) : (
          <div className="results-empty">Pick an answer with 1–{quiz.choices.length}, then Enter. Answers are final.</div>
        )}
      </div>
      <Link to="/campaign" className="muted small">
        Back to campaign
      </Link>
    </section>
  );
}
