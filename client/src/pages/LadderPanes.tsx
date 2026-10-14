// W6 answer-first players: explain-back and patch-review kata.
// CONTRACT (spec §4, server-enforced): the learner's answer is stored IMMUTABLY first;
// only then is the key fetched; the self-score is filed against that stored answer.
// Nothing private is ever requested before the answer row exists.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import {
  isApiError,
  type ExplainBackKeyResponse,
  type ExplainBackScoreResponse,
  type KataFinding,
  type KataKeyResponse,
  type KataScoreResponse,
  type UnitDetail,
} from '../api/types';
import { Icon } from '../components/Icon';
import { Chip } from '../components/ui';
import { InlineProse } from '../lib/prose';

const fmtPct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const fmtWhen = (ms: number) =>
  new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

function HelpBox({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />I had help
    </label>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="verdict verdict-error" role="alert">
      <Icon name="warn" /> {error}
    </div>
  );
}

/**
 * Loads the key on mount if an answer already exists. W9 (ui-audit #10): the unit detail says
 * whether it does (`answered`), so an unanswered unit makes NO key request (no expected 403 in
 * the console); an older server without the flag is probed as before (403 = still answering).
 */
function useExistingKey<T>(load: () => Promise<T>, answered: boolean | undefined): { key: T | null; setKey: (k: T) => void; checked: boolean } {
  const [key, setKey] = useState<T | null>(null);
  const [checked, setChecked] = useState(answered === false);
  useEffect(() => {
    if (answered === false) return;
    let live = true;
    load()
      .then((k) => live && setKey(k))
      .catch(() => undefined) // NOT_ANSWERED (or anything else): stay in the answering phase
      .finally(() => live && setChecked(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { key, setKey, checked };
}

// ---------------------------------------------------------------- explain-back

export function ExplainBackPane({ detail }: { detail: UnitDetail }) {
  const api = useApi();
  const id = detail.unit.id;
  const pub = detail.explainBack ?? null;
  const { key, setKey, checked } = useExistingKey<ExplainBackKeyResponse>(() => api.getExplainBackKey(id), pub?.answered);
  const [answers, setAnswers] = useState<string[]>(() => (pub ? pub.questions.map(() => '') : []));
  const [assisted, setAssisted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pub) {
    return (
      <section className="panel player-work" aria-label="Explain-back">
        <div className="verdict verdict-todo" data-testid="content-pending">
          <Icon name="warn" /> The question set for this explain-back is not loaded yet (content pending).
        </div>
      </section>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.answerExplainBack(id, { answers, selfAssisted: assisted });
      setKey(await api.getExplainBackKey(id));
      setConfirming(false);
    } catch (e) {
      if (isApiError(e, 'ALREADY_ANSWERED')) {
        try {
          setKey(await api.getExplainBackKey(id));
        } catch (e2) {
          setError(errorText(e2));
        }
      } else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (key) return <ExplainBackKeyView unitId={id} keyResp={key} />;
  const ready = answers.length > 0 && answers.every((a) => a.trim() !== '');

  return (
    <section className="panel player-work" aria-labelledby="eb-title">
      <h2 className="panel-title" id="eb-title">
        Explain it back
      </h2>
      <p className="code-hidden-note" data-testid="code-hidden">
        <Icon name="lock" size={14} /> Code hidden. Answer from memory, in your own words. Your answers are stored before the key points are shown.
      </p>
      {!checked && <p className="muted small">Checking for an earlier answer…</p>}
      <ol className="eb-questions">
        {pub.questions.map((q, i) => (
          <li key={i} className="eb-question">
            <label>
              <span className="eb-prompt">
                <InlineProse text={q.prompt} />
              </span>
              <textarea
                className="editor-text eb-answer"
                rows={4}
                value={answers[i] ?? ''}
                onChange={(e) => setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))}
                aria-label={`Answer ${i + 1}`}
                disabled={busy}
              />
            </label>
          </li>
        ))}
      </ol>
      <div className="toolbar">
        <HelpBox checked={assisted} onChange={setAssisted} disabled={busy} />
        <span className="toolbar-spacer" />
        <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => setConfirming(true)}>
          <Icon name="check" /> Submit answers
        </button>
      </div>
      {confirming && (
        <div className="confirm" role="alertdialog" onKeyDown={(e) => e.key === 'Escape' && !busy && setConfirming(false)} aria-labelledby="eb-confirm-title" aria-describedby="eb-confirm-desc">
          <h3 id="eb-confirm-title">Submit your answers?</h3>
          <p id="eb-confirm-desc">
            Answers are stored <strong>immutably</strong> and cannot be edited afterwards. The key points appear only after this.
          </p>
          <div className="toolbar">
            <button type="button" className="btn" autoFocus onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
              Store answers and show the key
            </button>
          </div>
        </div>
      )}
      <ErrorLine error={error} />
    </section>
  );
}

function ExplainBackKeyView({ unitId, keyResp }: { unitId: number; keyResp: ExplainBackKeyResponse }) {
  const api = useApi();
  const allIds = keyResp.questions.flatMap((q) => q.keyPoints.map((k) => k.id));
  const [marks, setMarks] = useState<Record<string, 'covered' | 'missed'>>({});
  const [result, setResult] = useState<ExplainBackScoreResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scoredBefore = keyResp.scored;
  const done = result !== null || scoredBefore !== null;
  const ready = allIds.every((k) => marks[k] !== undefined);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.selfScoreExplainBack(unitId, { perKeyPoint: marks }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel player-work" aria-labelledby="eb-key-title">
      <h2 className="panel-title" id="eb-key-title">
        Key points — self-score your stored answers
      </h2>
      <p className="muted small">
        Answer <code>#{keyResp.attemptId}</code> stored {fmtWhen(keyResp.answeredAt)} (immutable). Mark each key point your answer covered.
      </p>
      <ol className="eb-questions">
        {keyResp.questions.map((q, qi) => (
          <li key={qi} className="eb-question">
            <span className="eb-prompt">
              <InlineProse text={q.prompt} />
            </span>
            <div className="eb-split">
              <div className="eb-mine">
                <span className="muted small">Your answer</span>
                <p className="eb-stored" data-testid={`stored-answer-${qi + 1}`}>
                  {keyResp.answers[qi] ?? ''}
                </p>
              </div>
              <ul className="checklist" aria-label={`Key points for question ${qi + 1}`}>
                {q.keyPoints.map((kp) => (
                  <li key={kp.id} className={`checklist-item${marks[kp.id] ? ` is-${marks[kp.id]}` : ''}`}>
                    <span className="checklist-text">
                      <InlineProse text={kp.text} />
                    </span>
                    {kp.quote && <q className="checklist-quote">{kp.quote}</q>}
                    {kp.cite && (
                      <code className="checklist-cite">
                        {kp.cite.path}:{kp.cite.lineStart}
                        {kp.cite.lineEnd !== kp.cite.lineStart ? `-${kp.cite.lineEnd}` : ''}
                      </code>
                    )}
                    <span className="seg" role="radiogroup" aria-label={`${kp.id} coverage`}>
                      {(['covered', 'missed'] as const).map((m) => (
                        <label key={m} className={`seg-opt${marks[kp.id] === m ? ' on' : ''}`}>
                          <input
                            type="radio"
                            name={`kp-${kp.id}`}
                            checked={marks[kp.id] === m}
                            disabled={done || busy}
                            onChange={() => setMarks((prev) => ({ ...prev, [kp.id]: m }))}
                            aria-label={`${kp.id} ${m}`}
                          />
                          {m}
                        </label>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
      {!done && (
        <div className="toolbar">
          <span className="muted small">
            {Object.keys(marks).length}/{allIds.length} marked
          </span>
          <span className="toolbar-spacer" />
          <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void send()}>
            <Icon name="check" /> Submit self-score
          </button>
        </div>
      )}
      <div className="results" aria-live="polite" data-testid="results">
        <ErrorLine error={error} />
        {result && <ExplainBackResult r={result} />}
        {!result && scoredBefore && (
          <div className="verdict verdict-todo">
            <Icon name="check" /> Already self-scored: {fmtPct(scoredBefore.score)} coverage (evidence #{scoredBefore.evidenceIds.join(', #')}).
          </div>
        )}
      </div>
    </section>
  );
}

function ExplainBackResult({ r }: { r: ExplainBackScoreResponse }) {
  return (
    <>
      <div className={`verdict verdict-${r.passed ? 'pass' : 'fail'}`} data-testid="coverage-result">
        <Icon name={r.passed ? 'check' : 'warn'} />
        <strong>
          Coverage {fmtPct(r.coverage)} ({r.covered}/{r.total})
        </strong>
        <span className="muted">
          {r.passed ? `meets the ${r.minCoveragePct}% promotion threshold` : `below the ${r.minCoveragePct}% promotion threshold`}
        </span>
        <span className="verdict-xp">{r.xp ? (r.xp.amount > 0 ? `+${r.xp.amount} XP` : `0 XP${r.xp.reason ? ` (${r.xp.reason})` : ''}`) : '0 XP'}</span>
      </div>
      {r.retests.length > 0 ? (
        r.retests.map((t) => (
          <div key={t.reviewItemId} className="verdict verdict-todo" data-testid="retest-notice">
            <Icon name="cards" /> Retest scheduled: <Link to={`/play/${t.unitId}`}>{t.title}</Link> opens {fmtWhen(t.dueAt)} (a changed example, at least 2 days later, no help).
          </div>
        ))
      ) : (
        <div className="verdict verdict-todo" data-testid="retest-notice">
          <Icon name="warn" /> No retest scheduled
          {r.passed ? ' (no changed-example variation is seeded for this artifact yet).' : ' — coverage is below the promotion threshold.'}
        </div>
      )}
      {r.promotions.map((p) => (
        <div key={p.evidenceId} className="verdict verdict-pass">
          <Icon name="bolt" /> Promoted {p.competency}: {p.from} → {p.to}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- patch-review kata

/** Plain unified-diff viewer: one span per line, colored by its first character. */
export function DiffView({ diff, wrap = false }: { diff: string; wrap?: boolean }) {
  return (
    <pre className={`code-block diff-view${wrap ? ' diff-wrap' : ''}`} data-testid="diff">
      {diff.split('\n').map((line, i) => {
        const cls =
          line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')
            ? 'diff-file'
            : line.startsWith('@@')
              ? 'diff-hunk'
              : line.startsWith('+')
                ? 'diff-add'
                : line.startsWith('-')
                  ? 'diff-del'
                  : 'diff-ctx';
        return (
          <span key={i} className={`diff-line ${cls}`}>
            {line}
            {'\n'}
          </span>
        );
      })}
    </pre>
  );
}

const EMPTY_FINDING: KataFinding = { scenario: '', evidence: '', consequence: '' };

export function KataPane({ detail }: { detail: UnitDetail }) {
  const api = useApi();
  const id = detail.unit.id;
  const kata = detail.kata ?? null;
  const { key, setKey } = useExistingKey<KataKeyResponse>(() => api.getKataKey(id), kata?.answered);
  const [wrap, setWrap] = useState(false);
  const [rows, setRows] = useState<KataFinding[]>([{ ...EMPTY_FINDING }]);
  const [assisted, setAssisted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!kata) {
    return (
      <section className="panel player-work" aria-label="Patch kata">
        <div className="verdict verdict-todo" data-testid="content-pending">
          <Icon name="warn" /> This kata's diff is not loaded yet (content pending).
        </div>
      </section>
    );
  }

  const ready = rows.length > 0 && rows.every((r) => r.scenario.trim() && r.evidence.trim() && r.consequence.trim());
  const setCell = (i: number, f: keyof KataFinding, v: string) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [f]: v } : r)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.submitKataFindings(id, { findings: rows, selfAssisted: assisted });
      setKey(await api.getKataKey(id));
    } catch (e) {
      if (isApiError(e, 'ALREADY_ANSWERED')) {
        try {
          setKey(await api.getKataKey(id));
        } catch (e2) {
          setError(errorText(e2));
        }
      } else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel player-work" aria-labelledby="kata-title">
      {/* W9 (ui-audit #11): the kata title is already the page title — no uppercased duplicate */}
      <header className="panel-head">
        <h2 className="panel-title" id="kata-title">
          Review the patch
        </h2>
        <button type="button" className="btn btn-sm" aria-pressed={wrap} onClick={() => setWrap((w) => !w)}>
          {wrap ? 'No wrap' : 'Wrap lines'}
        </button>
      </header>
      <p className="muted small">
        Review this patch like a PR. Find every seeded defect you can: how many there are is shown with the key, after your findings are recorded.
      </p>
      <DiffView diff={kata.diff} wrap={wrap} />
      {kata.contextFiles.map((f) => (
        <details key={f.path} className="streams">
          <summary>
            Context: <code>{f.path}</code>
          </summary>
          <pre className="code-block">{f.content}</pre>
        </details>
      ))}
      {key ? (
        <KataKeyView unitId={id} keyResp={key} />
      ) : (
        <>
          <table className="table findings-table">
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Evidence (file:line)</th>
                <th scope="col">Consequence</th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {(['scenario', 'evidence', 'consequence'] as const).map((f) => (
                    <td key={f}>
                      <textarea
                        className="editor-text finding-cell"
                        rows={2}
                        value={r[f]}
                        onChange={(e) => setCell(i, f, e.target.value)}
                        aria-label={`Finding ${i + 1} ${f}`}
                        disabled={busy}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={rows.length === 1 || busy}
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={`Remove finding ${i + 1}`}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setRows((prev) => [...prev, { ...EMPTY_FINDING }])}>
              Add finding
            </button>
            <HelpBox checked={assisted} onChange={setAssisted} disabled={busy} />
            <span className="toolbar-spacer" />
            <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void submit()}>
              <Icon name="check" /> Submit findings (immutable)
            </button>
          </div>
          <p className="muted small">Findings are stored immutably; the seeded-defect key is shown only after.</p>
          <ErrorLine error={error} />
        </>
      )}
    </section>
  );
}

function KataKeyView({ unitId, keyResp }: { unitId: number; keyResp: KataKeyResponse }) {
  const api = useApi();
  const [marks, setMarks] = useState<Record<string, 'caught' | 'missed'>>({});
  const [result, setResult] = useState<KataScoreResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = result !== null || keyResp.scored !== null;
  const ready = keyResp.defects.every((d) => marks[d.id] !== undefined);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.selfScoreKata(unitId, { perDefect: marks }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kata-key" data-testid="kata-key">
      <h3 className="small">Your findings (stored #{keyResp.attemptId})</h3>
      <ul className="findings-stored">
        {keyResp.findings.map((f, i) => (
          <li key={i}>
            <strong>{f.scenario}</strong> · <code>{f.evidence}</code> · {f.consequence}
          </li>
        ))}
      </ul>
      <h3 className="small">Seeded defects</h3>
      <ul className="checklist">
        {keyResp.defects.map((d) => (
          <li key={d.id} className={`checklist-item${marks[d.id] ? ` is-${marks[d.id]}` : ''}`}>
            <span className="checklist-text">
              <InlineProse text={d.scenario} />
            </span>
            <code className="checklist-cite">
              {d.evidence.path}:{d.evidence.lineStart}
              {d.evidence.lineEnd !== d.evidence.lineStart ? `-${d.evidence.lineEnd}` : ''}
            </code>
            <Chip>{d.evidence.in}</Chip>
            <span className="checklist-quote">
              <InlineProse text={d.consequence} />
            </span>
            <span className="seg" role="radiogroup" aria-label={`${d.id} catch`}>
              {(['caught', 'missed'] as const).map((m) => (
                <label key={m} className={`seg-opt${marks[d.id] === m ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name={`def-${d.id}`}
                    checked={marks[d.id] === m}
                    disabled={done || busy}
                    onChange={() => setMarks((prev) => ({ ...prev, [d.id]: m }))}
                    aria-label={`${d.id} ${m}`}
                  />
                  {m}
                </label>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {!done && (
        <div className="toolbar">
          <span className="toolbar-spacer" />
          <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void send()}>
            <Icon name="check" /> Submit catch score
          </button>
        </div>
      )}
      <div className="results" aria-live="polite" data-testid="results">
        <ErrorLine error={error} />
        {result && (
          <div className={`verdict verdict-${result.catchRate >= 0.8 ? 'pass' : 'fail'}`} data-testid="catch-result">
            <Icon name={result.catchRate >= 0.8 ? 'check' : 'warn'} />
            <strong>
              Caught {result.caught}/{result.total} ({fmtPct(result.catchRate)})
            </strong>
            <span className="verdict-xp">{result.xp ? (result.xp.amount > 0 ? `+${result.xp.amount} XP` : `0 XP${result.xp.reason ? ` (${result.xp.reason})` : ''}`) : '0 XP'}</span>
          </div>
        )}
        {!result && keyResp.scored && (
          <div className="verdict verdict-todo">
            <Icon name="check" /> Already self-scored: {fmtPct(keyResp.scored.score)} caught.
          </div>
        )}
      </div>
    </div>
  );
}
