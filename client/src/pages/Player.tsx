import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import {
  ApiError,
  isApiError,
  type CanonicalRunResult,
  type PublicCheck,
  type RevealResponse,
  type RunFailure,
  type RunVerdict,
  type SelfAttestResponse,
  type Submission,
  type SubmitResponse,
  type UnitDetail,
} from '../api/types';
import { Icon } from '../components/Icon';
import { Chip, Kbd, LoadState, PageHeader } from '../components/ui';
import { hasModifier, isEditableTarget, isMod, useKeydown } from '../lib/keys';
import { useAsync } from '../lib/useAsync';
import { InlineProse, Prose, ProseBlocks, splitPrompt } from '../lib/prose';
import { TRACK_LABEL, languageOf, unitProse } from '../lib/view';
import { ExplainBackPane, KataPane } from './LadderPanes';
import { StudyQuestPane } from './StudyQuestPane';

type Solution = RevealResponse['solution'];

const ID_RE = /^[1-9]\d{0,14}$/;

export function PlayerPage() {
  const { unitId = '' } = useParams();
  const api = useApi();
  const q = useAsync(
    () => (ID_RE.test(unitId) ? api.getUnit(Number(unitId)) : Promise.reject(new ApiError(404, 'NOT_FOUND', `unit ${unitId} not found`))),
    [api, unitId],
  );
  if (q.status === 'error' && isApiError(q.error, 'NOT_FOUND')) {
    // W9 (ui-audit #13): a permanent 404 — a short message and a way out, no Retry, no empty 560px box
    return (
      <>
        <PageHeader eyebrow="Exercise" title="Unit not found" />
        <div className="panel notfound" role="alert">
          <p className="error-text">{errorText(q.error)}</p>
          <p>
            There is no unit <code>{unitId}</code>. It may have been retired, or the link is mistyped.
          </p>
          <p>
            <Link to="/campaign/js">Open the campaign map</Link> · <Link to="/">Back to the dashboard</Link>
          </p>
        </div>
      </>
    );
  }
  if (q.status !== 'ready') {
    return (
      <>
        <PageHeader eyebrow="Exercise" title={q.status === 'error' ? 'Unit not found' : ' '} />
        <LoadState error={q.error} onRetry={q.reload} minHeight={560} />
      </>
    );
  }
  // Keyed so switching units resets editor + results state.
  return <Player key={q.data.unit.id} detail={q.data} />;
}

function Player({ detail }: { detail: UnitDetail }) {
  const { unit, check } = detail;
  const spec = check?.spec ?? null;
  const prose = unitProse(detail);
  const [revealed, setRevealed] = useState(unit.revealed);
  const [solution, setSolution] = useState<Solution | null>(null);
  const isReading = unit.kind === 'reading';
  // W6 answer-first units: no reveal, and (explain-back) no code shown while answering
  // W8 study quests: no reveal either (missed keys arrive as review cards)
  const answerFirst = spec?.type === 'explain-back' || spec?.type === 'patch-kata' || spec?.type === 'study-quiz';
  // W9 (ui-audit #1): a locked campaign act serves no playable content at all
  if (detail.actGate?.locked) return <ActLocked detail={detail} />;
  const promptOnRight = prose.prompt !== null && (spec?.type === 'quiz' || spec?.type === 'predict-output');

  return (
    <>
      <PageHeader
        eyebrow={
          <nav aria-label="Breadcrumb" className="crumbs">
            <span>{TRACK_LABEL[unit.trackId]}</span>
            {unit.code && <span>{unit.code}</span>}
          </nav>
        }
        title={unit.title}
        actions={
          <span className="chips">
            <Chip>{unit.kind}</Chip>
            {unit.difficulty !== null && <Chip>difficulty {unit.difficulty}</Chip>}
            {revealed && (
              <span data-testid="zero-xp-badge">
                <Chip tone="warning">Guided · 0 XP</Chip>
              </span>
            )}
          </span>
        }
      />
      <div className="player">
        <section className="panel player-instructions" aria-labelledby="ins-title">
          <h2 className="panel-title" id="ins-title">
            Instructions
          </h2>
          {detail.retestGate && !detail.retestGate.open ? (
            <RetestClosed gate={detail.retestGate} />
          ) : prose.instructions.trim() !== '' ? (
            <Prose text={prose.instructions} className="ins-prose" />
          ) : promptOnRight ? (
            <p className="muted">The question is in the answer pane.</p>
          ) : (
            <p className="muted">No written instructions are served for this unit yet.</p>
          )}
          {detail.refs && detail.refs.length > 0 && <RefList refs={detail.refs} />}
          {detail.retestGate?.reason === 'practice' && (
            <p className="muted small" data-testid="retest-practice">
              Practice retest: the artifact&apos;s solution was revealed, so attempts here are guided and never count as the retest leg.
            </p>
          )}
          {unit.competencies.length > 0 && (
            <div className="ins-foot">
              <span className="muted">Competencies</span>
              <span className="chips">
                {unit.competencies.map((c) => (
                  <Chip key={c}>{c}</Chip>
                ))}
              </span>
            </div>
          )}
          {check && !isReading && !answerFirst && (
            <RevealPanel
              unitId={unit.id}
              revealed={revealed}
              solution={solution}
              onRevealed={(s) => {
                setRevealed(true);
                setSolution(s);
              }}
            />
          )}
        </section>

        {isReading ? (
          <ReadingPane unitId={unit.id} initiallyDone={unit.state === 'done'} />
        ) : !spec ? (
          <section className="panel player-work" aria-label="Solution">
            <p className="muted">This unit has no browser check. It is completed outside the player.</p>
          </section>
        ) : spec.type === 'explain-back' ? (
          <ExplainBackPane detail={detail} />
        ) : spec.type === 'patch-kata' ? (
          <KataPane detail={detail} />
        ) : spec.type === 'study-quiz' ? (
          <StudyQuestPane detail={detail} />
        ) : spec.type === 'quiz' ? (
          <QuizPane detail={detail} spec={spec} prompt={prose.prompt} solution={solution} />
        ) : spec.type === 'predict-output' ? (
          <PredictPane detail={detail} prompt={prose.prompt} />
        ) : (
          <CodePane detail={detail} spec={spec} />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- reveal

/** W7 (audit #1): a closed changed-example retest shows WHY it is closed, never its task. */
function RetestClosed({ gate }: { gate: NonNullable<UnitDetail['retestGate']> }) {
  return (
    <div className="verdict verdict-todo" data-testid="retest-closed">
      <Icon name="warn" />
      <span>
        {gate.reason === 'not-due' && gate.opensAt !== null
          ? `This changed-example retest opens ${new Date(gate.opensAt).toLocaleString()}. Until then its task is hidden and it cannot be run or submitted, so the delay measures what you retained.`
          : 'This changed-example retest is not scheduled. Pass its project artifact solo, then that artifact\'s explain-back with at least 80% coverage; the retest opens two or more days later.'}
      </span>
    </div>
  );
}

/**
 * W9 (ui-audit #1): the unit belongs to a campaign act that is still locked. The server sent no
 * check, prose or quest content (actGate); show why and where to go instead of a dead player.
 */
function ActLocked({ detail }: { detail: UnitDetail }) {
  const { unit } = detail;
  return (
    <>
      <PageHeader
        eyebrow={
          <nav aria-label="Breadcrumb" className="crumbs">
            <span>{TRACK_LABEL[unit.trackId]}</span>
            {unit.code && <span>{unit.code}</span>}
          </nav>
        }
        title={unit.title}
        actions={
          <span className="chips">
            <Chip>{unit.kind}</Chip>
            <Chip>locked</Chip>
          </span>
        }
      />
      <section className="panel act-locked" aria-labelledby="act-locked-title" data-testid="act-locked">
        <h2 className="act-locked-title" id="act-locked-title">
          <Icon name="lock" /> This quest&apos;s campaign act is locked
        </h2>
        <p>
          Its reading list, questions and checks open together with the act. Clear the previous act&apos;s core quests and reach the act&apos;s level to
          unlock it; nothing on this unit can be read, run or submitted until then.
        </p>
        <p>
          <Link to={`/campaign/${unit.trackId}`} className="btn btn-primary">
            <Icon name="map" /> See the unlock rule on the campaign map
          </Link>
        </p>
      </section>
    </>
  );
}

/** GitHub blob link of a content ref, pinned to its sha (+ line range when known). */
type Ref = NonNullable<UnitDetail['refs']>[number];
const refUrl = (r: Ref) =>
  `https://github.com/${r.repo}/blob/${r.sha}/${r.path.split('/').map(encodeURIComponent).join('/')}` +
  (r.lineStart !== null ? `#L${r.lineStart}${r.lineEnd !== null && r.lineEnd !== r.lineStart ? `-L${r.lineEnd}` : ''}` : '');

/** W9 (ui-audit #8): the material a unit reads from (program milestone, lesson guide). */
function RefList({ refs }: { refs: Ref[] }) {
  return (
    <div className="ref-list" data-testid="ref-list">
      <span className="muted small">Material</span>
      <ul>
        {refs.map((r) => (
          <li key={`${r.role}-${r.id}`}>
            <a href={refUrl(r)} target="_blank" rel="noopener noreferrer">
              {r.title}
            </a>{' '}
            <span className="muted small">
              {r.repo}@{r.sha.slice(0, 7)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RevealPanel({
  unitId,
  revealed,
  solution,
  onRevealed,
}: {
  unitId: number;
  revealed: boolean;
  solution: Solution | null;
  onRevealed: (s: Solution) => void;
}) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (kind: 'reveal' | 'fetch') => {
    setBusy(true);
    setError(null);
    try {
      // The solution only ever arrives AFTER the server has written the reveal row.
      const r = kind === 'reveal' ? await api.revealUnit(unitId) : await api.getSolution(unitId);
      onRevealed(r.solution);
      setConfirming(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reveal-box">
      {!revealed ? (
        <button type="button" className="btn btn-sm" onClick={() => setConfirming(true)} disabled={busy}>
          <Icon name="warn" size={14} /> Reveal solution
        </button>
      ) : !solution ? (
        <button type="button" className="btn btn-sm" onClick={() => void act('fetch')} disabled={busy}>
          Show revealed solution
        </button>
      ) : (
        <SolutionView solution={solution} />
      )}
      {confirming && (
        <div className="confirm" role="alertdialog" onKeyDown={(e) => e.key === 'Escape' && !busy && setConfirming(false)} aria-labelledby="reveal-title" aria-describedby="reveal-desc">
          <h3 id="reveal-title">Reveal the solution?</h3>
          <p id="reveal-desc">
            This exercise will be worth <strong>0 XP forever</strong>. Later submits still record, as guided attempts.
          </p>
          <div className="toolbar">
            <button type="button" className="btn" autoFocus onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void act('reveal')} disabled={busy}>
              Reveal (0 XP forever)
            </button>
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

function SolutionView({ solution }: { solution: Solution }) {
  return (
    <div className="solution" data-testid="solution">
      <h3 className="small">Reference solution (revealed)</h3>
      {solution.kind === 'code' && <pre className="code-block">{solution.code}</pre>}
      {solution.kind === 'output' && <pre className="code-block">{solution.expected}</pre>}
      {solution.kind === 'answer' && (
        <p>
          Answer: <InlineProse text={solution.choice ?? String(solution.answer)} />
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- shared submit bits

function HelpCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  // The ONLY assistance signal the client sends: a boolean. Reveal is derived server-side.
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />I had help
    </label>
  );
}

function XpLine({ submit }: { submit: SubmitResponse }) {
  const xp = submit.xp;
  const text = xp === null ? '0 XP' : xp.amount > 0 ? `+${xp.amount} XP` : xp.reason ? `0 XP (${xp.reason})` : '0 XP';
  return (
    <span className="verdict-xp">
      {text}
      {' · '}
      {submit.attempt.mode}
      {' attempt '}
      <code>#{submit.attempt.id}</code>
    </span>
  );
}

const VERDICT_TEXT: Record<RunVerdict, string> = {
  pass: 'All checks passed',
  fail: 'Checks failed',
  todo: 'Not attempted yet',
  crashed: 'Runner crashed',
  timeout: 'Timed out',
  error: 'Runner error',
};

const show = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v) ?? String(v));

// ---------------------------------------------------------------- code drills

type Outcome = { kind: 'run'; result: CanonicalRunResult } | { kind: 'submit'; submit: SubmitResponse };

function CodePane({ detail, spec }: { detail: UnitDetail; spec: PublicCheck }) {
  const api = useApi();
  const id = detail.unit.id;
  const [code, setCode] = useState(detail.starter ?? '');
  const [assisted, setAssisted] = useState(false);
  const [busy, setBusy] = useState<null | 'run' | 'submit'>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const language = languageOf(spec) ?? 'code';

  const go = async (kind: 'run' | 'submit') => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'run') setOutcome({ kind, result: (await api.runUnit(id, { code })).result });
      else setOutcome({ kind, submit: await api.submitUnit(id, { code, selfAssisted: assisted }) });
    } catch (e) {
      // W6: a changed-example retest submitted before its >= 2-day schedule opens is refused (409 NOT_DUE)
      if (isApiError(e, 'NOT_DUE') && detail.unit.kind === 'retest') setError(`Retest not open yet: ${e.message} (NOT_DUE)`);
      else if (isApiError(e, 'RETEST_NOT_OPEN')) setError(`Retest not scheduled: ${e.message} (RETEST_NOT_OPEN)`);
      else setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  useKeydown((e) => {
    if (!isMod(e) || e.key !== 'Enter') return;
    e.preventDefault();
    void go(e.shiftKey ? 'submit' : 'run');
  });

  return (
    <section className="panel player-work" aria-label="Solution">
      <div className="editor-head">
        <span className="editor-lang">{language}</span>
        <span className="muted">Editor stub — CodeMirror lands in W2</span>
      </div>
      <EditorStub value={code} onChange={setCode} language={language} />
      <div className="toolbar">
        <HelpCheckbox checked={assisted} onChange={setAssisted} />
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

function Results({ outcome, error, busy }: { outcome: Outcome | null; error: string | null; busy: boolean }) {
  const result = outcome ? (outcome.kind === 'run' ? outcome.result : outcome.submit.result) : null;
  const verdict: RunVerdict | null = outcome ? (outcome.kind === 'submit' ? outcome.submit.verdict : outcome.result.pass ? 'pass' : 'fail') : null;
  return (
    <div className="results" aria-live="polite" aria-busy={busy} data-testid="results">
      {error ? (
        <div className="verdict verdict-error" role="alert">
          <Icon name="warn" /> {error}
        </div>
      ) : !result || !verdict ? (
        <div className="results-empty">
          <p>
            Run checks to see structured results here. Runs are free; <strong>Submit</strong> records an immutable attempt.
          </p>
        </div>
      ) : (
        <>
          <div className={`verdict verdict-${verdict}`}>
            <Icon name={verdict === 'pass' ? 'check' : 'warn'} />
            <strong>{VERDICT_TEXT[verdict]}</strong>
            <span className="muted">
              {result.failures.length} failing · {result.durationMs} ms
              {outcome?.kind === 'run' ? ' · practice run (not recorded)' : ''}
            </span>
            {outcome?.kind === 'submit' && <XpLine submit={outcome.submit} />}
          </div>
          {result.failures.length > 0 && (
            <ol className="tests">
              {result.failures.map((f, i) => (
                <FailureRow key={`${f.name}-${i}`} f={f} />
              ))}
            </ol>
          )}
          {result.output && (
            <details className="streams">
              <summary>Output</summary>
              <pre className="stream">{result.output}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function FailureRow({ f }: { f: RunFailure }) {
  const hasDiff = f.expected !== undefined || f.actual !== undefined;
  return (
    <li className="test test-fail">
      <span className="test-status">fail</span>
      <span className="test-name">{f.name}</span>
      {f.message && <span className="test-msg">{f.message}</span>}
      {hasDiff && (
        <dl className="diff">
          <div>
            <dt>expected</dt>
            <dd>
              <code>{f.expected === undefined ? '—' : show(f.expected)}</code>
            </dd>
          </div>
          <div>
            <dt>actual</dt>
            <dd>
              <code>{f.actual === undefined ? '—' : show(f.actual)}</code>
            </dd>
          </div>
        </dl>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- quiz / predict (submit-only: no Run)

/**
 * W9 (ui-audit #2): the question is BODY text in its original case (never the uppercased
 * .panel-title), with inline code; a fenced block in it renders as a real code block below.
 */
function PromptHead({ id, prompt, fallback }: { id: string; prompt: string | null; fallback: string }) {
  const { heading, rest } = splitPrompt(prompt ?? '');
  return (
    <>
      <h2 className="prompt-title" id={id}>
        <InlineProse text={heading || fallback} />
      </h2>
      {rest.length > 0 && (
        <div className="prose prompt-body">
          <ProseBlocks blocks={rest} />
        </div>
      )}
    </>
  );
}

function AnswerVerdict({ submit, error, idle }: { submit: SubmitResponse | null; error: string | null; idle: ReactNode }) {
  if (error) {
    return (
      <div className="verdict verdict-error" role="alert">
        <Icon name="warn" /> {error}
      </div>
    );
  }
  if (!submit) return <div className="results-empty">{idle}</div>;
  const pass = submit.result.pass;
  return (
    <div className={`verdict verdict-${pass ? 'pass' : 'fail'}`}>
      <Icon name={pass ? 'check' : 'warn'} />
      {/* A wrong answer is "incorrect" and nothing more: the key only ever comes from POST /reveal. */}
      <strong>{pass ? 'Correct' : 'Incorrect'}</strong>
      <XpLine submit={submit} />
    </div>
  );
}

function useAnswerSubmit(unitId: number) {
  const api = useApi();
  const [submit, setSubmit] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (s: Submission) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSubmit(await api.submitUnit(unitId, s));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { submit, error, busy, send };
}

function QuizPane({
  detail,
  spec,
  prompt,
  solution,
}: {
  detail: UnitDetail;
  spec: Extract<PublicCheck, { type: 'quiz' }>;
  prompt: string | null;
  solution: Solution | null;
}) {
  const choices = spec.choices ?? [];
  const byChoice = choices.length > 0;
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [assisted, setAssisted] = useState(false);
  const { submit, error, busy, send } = useAnswerSubmit(detail.unit.id);
  const passed = submit?.result.pass === true;
  const [lastPick, setLastPick] = useState<number | null>(null);
  const firstRadio = useRef<HTMLInputElement>(null);
  const revealedIndex = solution?.kind === 'answer' && typeof solution.answer === 'number' ? solution.answer : null;

  useEffect(() => firstRadio.current?.focus({ preventScroll: true }), []);

  const go = async () => {
    if (passed || busy) return;
    if (byChoice) {
      if (choice === null) return;
      setLastPick(choice);
      await send({ answer: choice, selfAssisted: assisted });
    } else {
      if (text.trim() === '') return;
      await send({ answer: text, selfAssisted: assisted });
    }
  };

  useKeydown((e) => {
    if (!byChoice || passed || hasModifier(e) || (isEditableTarget(e.target) && !(e.target instanceof HTMLInputElement))) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
      e.preventDefault();
      setChoice(n - 1);
    } else if (e.key === 'Enter' && choice !== null) {
      e.preventDefault();
      void go();
    }
  });

  return (
    <section className="panel player-work" aria-labelledby="quiz-q">
      <PromptHead id="quiz-q" prompt={prompt} fallback="Choose the answer" />
      {detail.starter && <pre className="code-block">{detail.starter}</pre>}
      {byChoice ? (
        <fieldset className="choices" disabled={passed || busy}>
          <legend className="sr-only">Answer choices</legend>
          {choices.map((c, i) => {
            // The right choice is only ever marked from a revealed solution or the learner's own
            // passing pick; a wrong submit marks just the learner's pick as wrong.
            const tone =
              revealedIndex === i ? ' choice-right' : submit && lastPick === i ? (passed ? ' choice-right' : ' choice-wrong') : '';
            return (
              <label key={i} className={`choice${choice === i ? ' choice-on' : ''}${tone}`}>
                <input ref={i === 0 ? firstRadio : undefined} type="radio" name="quiz" checked={choice === i} onChange={() => setChoice(i)} />
                <Kbd>{i + 1}</Kbd>
                <span className="choice-text">
                  <InlineProse text={c} />
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : (
        <label className="answer-field">
          <span className="sr-only">Your answer</span>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} disabled={passed} aria-label="Your answer" />
        </label>
      )}
      <div className="toolbar">
        <HelpCheckbox checked={assisted} onChange={setAssisted} />
        <span className="toolbar-spacer" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={passed || busy || (byChoice ? choice === null : text.trim() === '')}
          onClick={() => void go()}
        >
          {submit && !passed ? 'Try again' : 'Check answer'} <Kbd>Enter</Kbd>
        </button>
      </div>
      <div className="results" aria-live="polite" data-testid="results">
        <AnswerVerdict
          submit={submit}
          error={error}
          idle={byChoice ? `Pick an answer with 1–${choices.length}, then Enter. Every check is a recorded attempt.` : 'Type your answer, then check it.'}
        />
      </div>
      <Link to={`/campaign/${detail.unit.trackId}`} className="muted small">
        Back to campaign
      </Link>
    </section>
  );
}

function PredictPane({ detail, prompt }: { detail: UnitDetail; prompt: string | null }) {
  const [text, setText] = useState('');
  const [assisted, setAssisted] = useState(false);
  const { submit, error, busy, send } = useAnswerSubmit(detail.unit.id);
  const passed = submit?.result.pass === true;
  const go = () => {
    if (!passed && text.trim() !== '') void send({ answer: text, selfAssisted: assisted });
  };

  useKeydown((e) => {
    if (!isMod(e) || !e.shiftKey || e.key !== 'Enter') return;
    e.preventDefault();
    go();
  });

  return (
    <section className="panel player-work" aria-labelledby="predict-q">
      <PromptHead id="predict-q" prompt={prompt} fallback="Predict the output" />
      {detail.snippet && <pre className="code-block">{detail.snippet}</pre>}
      {!detail.snippet && detail.starter && <pre className="code-block">{detail.starter}</pre>}
      <textarea
        className="editor-text predict-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Predicted output"
        rows={4}
        disabled={passed}
        spellCheck={false}
      />
      <div className="toolbar">
        <HelpCheckbox checked={assisted} onChange={setAssisted} />
        <span className="toolbar-spacer" />
        <button type="button" className="btn btn-primary" onClick={go} disabled={passed || busy || text.trim() === ''}>
          <Icon name="check" /> Submit <Kbd>Ctrl</Kbd>
          <Kbd>Shift</Kbd>
          <Kbd>Enter</Kbd>
        </button>
      </div>
      <div className="results" aria-live="polite" data-testid="results">
        <AnswerVerdict submit={submit} error={error} idle="Predict the exact output, then submit. There is no free run for predict-output units." />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- reading (self-attest)

function ReadingPane({ unitId, initiallyDone }: { unitId: number; initiallyDone: boolean }) {
  const api = useApi();
  const [state, setState] = useState<'open' | 'busy' | 'attested' | 'already'>(initiallyDone ? 'already' : 'open');
  const [result, setResult] = useState<SelfAttestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attest = async () => {
    if (state !== 'open') return;
    setState('busy');
    setError(null);
    try {
      setResult(await api.selfAttest(unitId));
      setState('attested');
    } catch (e) {
      if (isApiError(e, 'ALREADY_ATTESTED')) setState('already');
      else {
        setError(errorText(e));
        setState('open');
      }
    }
  };

  return (
    <section className="panel player-work" aria-label="Reading">
      <p>Reading units have no automated check. Mark the unit as read once you have worked through it — this is a one-time self-attestation.</p>
      <div className="toolbar">
        <span className="toolbar-spacer" />
        <button type="button" className="btn btn-primary" onClick={() => void attest()} disabled={state !== 'open'}>
          <Icon name="check" /> {state === 'open' || state === 'busy' ? 'Mark as read' : 'Marked as read'}
        </button>
      </div>
      <div className="results" aria-live="polite" data-testid="results">
        {state === 'attested' && result && (
          <div className="verdict verdict-pass">
            <Icon name="check" /> <strong>Marked as read</strong>
            <span className="verdict-xp">{result.xp.amount > 0 ? `+${result.xp.amount} XP` : `0 XP${result.xp.reason ? ` (${result.xp.reason})` : ''}`}</span>
          </div>
        )}
        {state === 'already' && (
          <div className="verdict verdict-todo" data-testid="already-attested">
            <Icon name="check" /> Already marked as read.
          </div>
        )}
        {error && (
          <div className="verdict verdict-error" role="alert">
            <Icon name="warn" /> {error}
          </div>
        )}
      </div>
    </section>
  );
}
