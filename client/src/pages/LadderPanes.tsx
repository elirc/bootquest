// W6 answer-first players: explain-back and patch-review kata.
// CONTRACT (spec §4, server-enforced): the learner's answer is stored IMMUTABLY first;
// only then is the key fetched; the self-score is filed against that stored answer.
// Nothing private is ever requested before the answer row exists.
//
// Client-side safety around those one-way doors (none of it changes what the server records):
// - unsent answers / findings are kept as a per-browser DRAFT (localStorage), keyed by unit id
//   plus a hash of the item's public content, so a re-seeded item never inherits a stale draft;
// - a self-score shows a live preview against the pass mark and asks for confirmation, because
//   it is permanent (evidence is append-only);
// - an explain-back that is promotion leg (b) of an unpassed artifact is shown read-only
//   (server: 409 ARTIFACT_REQUIRED), so its once-only answer cannot be burned early;
// - an answered unit whose key fails to load says so and offers Retry, never an empty form.

import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { G1_TARGET_RATE, PROMOTION_MIN_COVERAGE } from '@bootquest/shared/thresholds';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import {
  isApiError,
  type ExplainBackKeyResponse,
  type ExplainBackPublic,
  type ExplainBackScoreResponse,
  type KataFinding,
  type KataKeyResponse,
  type KataScoreResponse,
  type UnitDetail,
} from '../api/types';
import { Icon } from '../components/Icon';
import { Chip } from '../components/ui';
import { contentHash, useDirtyGuard, useJsonDraft } from '../lib/draft';
import { fmtWhen } from '../lib/format';
import { InlineProse } from '../lib/prose';
import { useTracksRefresh } from '../lib/tracks';

const fmtPct = (x: number) => `${Math.round(x * 1000) / 10}%`;

type ArtifactRef = NonNullable<ExplainBackPublic['artifactRequired']>[number];

const ARTIFACT_REQUIRED_TEXT =
  'Pass the linked project unit solo first: this explain-back is its promotion leg (b), and the set takes one answer only, so an answer stored now could never count. Your draft is kept.';

/**
 * errorText plus the ladder-specific lines: a NOT_ANSWERED that names a superseded answer explains
 * the re-seed (server text), and ARTIFACT_REQUIRED gets the pane's longer line (it says the draft
 * is kept). ALREADY_ANSWERED needs nothing here: errorText itself shows the server's text for it
 * (it names the stored answer and where to self-score it).
 */
function ladderErrorText(e: unknown): string {
  if (isApiError(e, 'ARTIFACT_REQUIRED')) return `${ARTIFACT_REQUIRED_TEXT} (ARTIFACT_REQUIRED)`;
  if (isApiError(e, 'NOT_ANSWERED') && /superseded/.test(e.message)) return `${e.message} (NOT_ANSWERED)`;
  return errorText(e);
}

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

// ---------------------------------------------------------------- drafts
// The hooks are lib/draft.ts (useJsonDraft + useDirtyGuard); only the key format lives here.

const DRAFT_PREFIX = 'bq:ladder-draft:';

/**
 * localStorage key (full, as stored) of the unsent draft for one item version. The hash is
 * lib/draft's FNV-1a of the item's public content, so a re-seeded item gets a fresh draft slot.
 * The format is stable: drafts already in a browser must keep restoring.
 */
export const ladderDraftKey = (kind: 'eb' | 'kata', unitId: number, content: string): string => `${DRAFT_PREFIX}${kind}:${unitId}:${contentHash(content)}`;
export const ebDraftKey = (unitId: number, pub: Pick<ExplainBackPublic, 'questions'>): string =>
  ladderDraftKey('eb', unitId, pub.questions.map((q) => q.prompt).join('\u0000'));
export const kataDraftKey = (unitId: number, diff: string): string => ladderDraftKey('kata', unitId, diff);

/** Ask before a tab close / reload while `dirty` (the draft is in storage: in-app navigation loses nothing). */
const useLadderDirtyGuard = (dirty: boolean): void => useDirtyGuard(dirty, { inApp: false });

function DraftNote({ restored }: { restored: boolean }) {
  return (
    <p className="muted small draft-note" data-testid="draft-note">
      {restored && (
        <span data-testid="draft-restored">
          <Icon name="info" size={14} /> Restored your unsent draft.
        </span>
      )}
      <span>Unsent drafts are kept in this browser only; nothing is recorded until you submit.</span>
    </p>
  );
}

// ---------------------------------------------------------------- the key, if an answer exists

type KeyPhase = 'checking' | 'answering' | 'loaded' | 'unavailable';

/**
 * Loads the key on mount if an answer already exists. W9 (ui-audit #10): the unit detail says
 * whether it does (`answered`), so an unanswered unit makes NO key request (no expected 403 in
 * the console); an older server without the flag is probed as before (403 = still answering).
 * Any OTHER failure is `unavailable` (with Retry): an answered unit must never fall back to an
 * empty answer form, where the learner would retype everything only to hit ALREADY_ANSWERED.
 */
function useExistingKey<T>(load: () => Promise<T>, answered: boolean | undefined) {
  const [key, setKeyState] = useState<T | null>(null);
  const [phase, setPhase] = useState<KeyPhase>(answered === false ? 'answering' : 'checking');
  const [error, setError] = useState<string | null>(null);
  /** a NOT_ANSWERED that names a superseded (re-seeded) earlier answer */
  const [notice, setNotice] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (answered === false && tries === 0) return;
    let live = true;
    setPhase('checking');
    loadRef.current().then(
      (k) => {
        if (!live) return;
        setKeyState(k);
        setError(null);
        setPhase('loaded');
      },
      (e: unknown) => {
        if (!live) return;
        if (isApiError(e, 'NOT_ANSWERED')) {
          // no answer for THIS item version (never answered, or the old one was superseded by a re-seed)
          setNotice(/superseded/.test(e.message) ? e.message : null);
          setPhase('answering');
        } else {
          setError(errorText(e));
          setPhase('unavailable');
        }
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tries]);

  return {
    key,
    phase,
    error,
    notice,
    setKey: (k: T) => {
      setKeyState(k);
      setError(null);
      setPhase('loaded');
    },
    retry: () => setTries((n) => n + 1),
    /** the answer is stored, but its key did not load */
    fail: (message: string) => {
      setError(message);
      setPhase('unavailable');
    },
    /** the server says this version is unanswered after all (a re-seed under our feet): answer again */
    reopen: (message: string | null) => {
      setKeyState(null);
      setNotice(message);
      setPhase('answering');
    },
  };
}

function KeyUnavailable({ noun, stored, error, onRetry }: { noun: 'answers' | 'findings'; stored: boolean; error: string | null; onRetry: () => void }) {
  return (
    <div className="verdict verdict-error" role="alert" data-testid="key-unavailable">
      <Icon name="warn" />
      <span>
        {stored
          ? `Your ${noun} are recorded, but the key could not be loaded. Nothing is lost and there is nothing to retype: retry to open the key.`
          : `Could not check whether your ${noun} are already recorded, so the form stays closed (they can be stored only once).`}{' '}
        {error}
      </span>
      <button type="button" className="btn btn-sm" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function SupersededNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="verdict verdict-todo" data-testid="superseded-note">
      <Icon name="info" /> This item was re-seeded since your earlier answer, so that answer is superseded (kept, never keyed against the new
      version). Answer the new version below. <span className="muted">{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------- self-score preview + confirm

/** Is `hit / total` at or over `gatePct` percent? Integer math: 4/5 vs 80% is exactly a pass. */
const meetsGate = (hit: number, total: number, gatePct: number) => total > 0 && hit * 100 >= gatePct * total;

function ScorePreview({ hit, marked, total, verb, gatePct, gateName }: { hit: number; marked: number; total: number; verb: string; gatePct: number; gateName: string }) {
  const ok = meetsGate(hit, total, gatePct);
  const unmarked = total - marked;
  return (
    <span className={`score-preview ${ok ? 'is-pass' : 'is-fail'}`} data-testid="score-preview" aria-live="polite">
      <strong>
        {hit}/{total} {verb} = {fmtPct(total ? hit / total : 0)}
      </strong>{' '}
      — {ok ? 'meets' : 'below'} the {gatePct}% {gateName}
      {unmarked > 0 ? ` (${unmarked} still unmarked)` : ''}
    </span>
  );
}

function ScoreConfirm({
  id,
  title,
  summary,
  consequence,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  id: string;
  title: string;
  summary: string;
  consequence: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="confirm" role="alertdialog" onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()} aria-labelledby={`${id}-title`} aria-describedby={`${id}-desc`}>
      <h3 id={`${id}-title`}>{title}</h3>
      <p id={`${id}-desc`}>
        <strong>{summary}</strong> {consequence} A self-score is <strong>permanent</strong>: evidence is append-only, and this answer can never be re-scored.
      </p>
      <div className="toolbar">
        <button type="button" className="btn" autoFocus onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- explain-back

interface EbDraft {
  answers: string[];
  assisted: boolean;
}
const ebDraftEmpty = (d: EbDraft) => !d.assisted && d.answers.every((a) => a.trim() === '');

function ArtifactLock({ artifacts }: { artifacts: ArtifactRef[] }) {
  return (
    <div className="verdict verdict-todo" role="note" data-testid="artifact-lock">
      <Icon name="lock" />
      <span>
        <strong>
          Pass{' '}
          {artifacts.map((a, i) => (
            <Fragment key={a.unitId}>
              {i > 0 && (i === artifacts.length - 1 ? ' and ' : ', ')}
              <Link to={`/play/${a.unitId}`}>{a.title}</Link>
            </Fragment>
          ))}{' '}
          solo first.
        </strong>{' '}
        This explain-back is promotion leg (b) of {artifacts.length === 1 ? 'that unit' : 'those units'} and takes one answer only, so an answer stored before a
        verified solo pass could never count. Read the questions now; answering opens after that pass.
      </span>
    </div>
  );
}

export function ExplainBackPane({ detail }: { detail: UnitDetail }) {
  const api = useApi();
  const id = detail.unit.id;
  const pub = detail.explainBack ?? null;
  const ks = useExistingKey<ExplainBackKeyResponse>(() => api.getExplainBackKey(id), pub?.answered);
  const n = pub?.questions.length ?? 0;
  const draft = useJsonDraft<EbDraft>(pub ? ebDraftKey(id, pub) : null, { answers: Array.from({ length: n }, () => ''), assisted: false }, {
    parse: (raw) => {
      const d = raw as Partial<EbDraft> | null;
      return d && Array.isArray(d.answers) && d.answers.length === n && d.answers.every((a) => typeof a === 'string')
        ? { answers: d.answers, assisted: d.assisted === true }
        : null;
    },
    isEmpty: ebDraftEmpty,
  });
  const [stored, setStored] = useState(pub?.answered === true);
  const [lockOverride, setLockOverride] = useState<ArtifactRef[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { answers, assisted } = draft.value;

  // the server holds the answer once its key is readable: the draft is spent
  useEffect(() => {
    if (ks.key) draft.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ks.key]);
  useLadderDirtyGuard(ks.phase === 'answering' && !ebDraftEmpty(draft.value));

  if (!pub) {
    return (
      <section className="panel player-work" aria-label="Explain-back">
        <div className="verdict verdict-todo" data-testid="content-pending">
          <Icon name="warn" /> The question set for this explain-back is not loaded yet (content pending).
        </div>
      </section>
    );
  }

  const artifacts = lockOverride ?? pub.artifactRequired ?? [];
  const locked = artifacts.length > 0;

  const loadKey = async () => {
    try {
      ks.setKey(await api.getExplainBackKey(id));
    } catch (e) {
      ks.fail(errorText(e));
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.answerExplainBack(id, { answers, selfAssisted: assisted });
      setStored(true);
      setConfirming(false);
      draft.clear();
      await loadKey();
    } catch (e) {
      setConfirming(false);
      if (isApiError(e, 'ALREADY_ANSWERED')) {
        // recorded earlier (another tab, or a retired unit's stranded answer that is scored here)
        setStored(true);
        try {
          ks.setKey(await api.getExplainBackKey(id));
        } catch (e2) {
          ks.fail(`${ladderErrorText(e)} ${errorText(e2)}`);
        }
      } else if (isApiError(e, 'ARTIFACT_REQUIRED')) {
        // raced: the artifact lost (or never had) its solo pass since the page loaded. Re-read the lock list.
        setError(ladderErrorText(e));
        try {
          const fresh = (await api.getUnit(id)).explainBack?.artifactRequired ?? [];
          if (fresh.length > 0) {
            setLockOverride(fresh);
            setError(null); // the banner says it, with the links
          }
        } catch {
          // keep the friendly error line
        }
      } else setError(ladderErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (ks.key) return <ExplainBackKeyView unitId={id} keyResp={ks.key} gatePct={pub.minCoveragePct ?? PROMOTION_MIN_COVERAGE * 100} onStale={ks.reopen} />;

  const ready = answers.length > 0 && answers.every((a) => a.trim() !== '');
  const frozen = busy || locked;

  return (
    <section className="panel player-work" aria-labelledby="eb-title">
      <h2 className="panel-title" id="eb-title">
        Explain it back
      </h2>
      <p className="code-hidden-note" data-testid="code-hidden">
        <Icon name="lock" size={14} /> Code hidden. Answer from memory, in your own words. Your answers are stored before the key points are shown.
      </p>
      {ks.phase === 'checking' && <p className="muted small">Checking for an earlier answer…</p>}
      {ks.phase === 'unavailable' && <KeyUnavailable noun="answers" stored={stored || pub.answered === true} error={ks.error} onRetry={ks.retry} />}
      {ks.phase === 'answering' && (
        <>
          <SupersededNote text={ks.notice} />
          {locked && <ArtifactLock artifacts={artifacts} />}
          <ol className="eb-questions">
            {pub.questions.map((q, i) => (
              <li key={i} className="eb-question">
                <label>
                  <span className="eb-prompt">
                    <InlineProse text={q.prompt} />
                  </span>
                  <textarea
                    className="answer-text eb-answer"
                    rows={4}
                    value={answers[i] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      draft.set((d) => ({ ...d, answers: d.answers.map((a, j) => (j === i ? v : a)) }));
                    }}
                    aria-label={`Answer ${i + 1}`}
                    disabled={frozen}
                    readOnly={locked}
                  />
                </label>
              </li>
            ))}
          </ol>
          <div className="toolbar">
            <HelpBox checked={assisted} onChange={(v) => draft.set((d) => ({ ...d, assisted: v }))} disabled={frozen} />
            <span className="toolbar-spacer" />
            <button type="button" className="btn btn-primary" disabled={!ready || frozen} onClick={() => setConfirming(true)}>
              <Icon name={locked ? 'lock' : 'check'} /> Submit answers
            </button>
          </div>
          {!locked && <DraftNote restored={draft.restored} />}
          {confirming && !locked && (
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
        </>
      )}
      <ErrorLine error={error} />
    </section>
  );
}

function ExplainBackKeyView({
  unitId,
  keyResp,
  gatePct,
  onStale,
}: {
  unitId: number;
  keyResp: ExplainBackKeyResponse;
  /** the unit's own pass mark, percent (ExplainBackPublic.minCoveragePct) */
  gatePct: number;
  onStale: (message: string | null) => void;
}) {
  const api = useApi();
  const allIds = keyResp.questions.flatMap((q) => q.keyPoints.map((k) => k.id));
  const [marks, setMarks] = useState<Record<string, 'covered' | 'missed'>>({});
  const refreshTracks = useTracksRefresh();
  const [result, setResult] = useState<ExplainBackScoreResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scoredBefore = keyResp.scored;
  const done = result !== null || scoredBefore !== null;
  const ready = allIds.every((k) => marks[k] !== undefined);
  const covered = allIds.filter((k) => marks[k] === 'covered').length;
  const marked = allIds.filter((k) => marks[k] !== undefined).length;
  const passes = meetsGate(covered, allIds.length, gatePct);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.selfScoreExplainBack(unitId, { perKeyPoint: marks }));
      refreshTracks(); // W10: a self-score completes the unit (track progress)
    } catch (e) {
      // re-seeded since the key loaded: this answer is superseded, the new version takes a fresh one
      if (isApiError(e, 'NOT_ANSWERED')) onStale(/superseded/.test(e.message) ? e.message : null);
      else setError(ladderErrorText(e));
    } finally {
      setBusy(false);
      setConfirming(false);
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
                            disabled={done || busy || confirming}
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
          <ScorePreview hit={covered} marked={marked} total={allIds.length} verb="covered" gatePct={gatePct} gateName="promotion gate" />
          <span className="toolbar-spacer" />
          <button type="button" className="btn btn-primary" disabled={!ready || busy || confirming} onClick={() => setConfirming(true)}>
            <Icon name="check" /> Submit self-score
          </button>
        </div>
      )}
      {!done && confirming && (
        <ScoreConfirm
          id="eb-score-confirm"
          title="File this self-score?"
          summary={`${covered}/${allIds.length} covered = ${fmtPct(covered / allIds.length)}: ${passes ? 'meets' : 'below'} the ${gatePct}% promotion gate.`}
          consequence={passes ? 'It counts as promotion leg (b) and schedules the changed-example retest.' : 'It files a FAIL for promotion leg (b): no XP and no retest.'}
          confirmLabel="File self-score"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void send()}
        />
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
const FINDING_FIELDS = ['scenario', 'evidence', 'consequence'] as const;

interface KataDraft {
  rows: KataFinding[];
  assisted: boolean;
}
const kataDraftEmpty = (d: KataDraft) => !d.assisted && d.rows.every((r) => FINDING_FIELDS.every((f) => r[f].trim() === ''));
const parseKataDraft = (raw: unknown): KataDraft | null => {
  const d = raw as Partial<KataDraft> | null;
  if (!d || !Array.isArray(d.rows) || d.rows.length === 0) return null;
  const rows = d.rows.filter((r): r is KataFinding => typeof r === 'object' && r !== null && FINDING_FIELDS.every((f) => typeof (r as Record<string, unknown>)[f] === 'string'));
  return rows.length === d.rows.length ? { rows: rows.map((r) => ({ scenario: r.scenario, evidence: r.evidence, consequence: r.consequence })), assisted: d.assisted === true } : null;
};

export function KataPane({ detail }: { detail: UnitDetail }) {
  const api = useApi();
  const id = detail.unit.id;
  const kata = detail.kata ?? null;
  const ks = useExistingKey<KataKeyResponse>(() => api.getKataKey(id), kata?.answered);
  const [wrap, setWrap] = useState(false);
  const draft = useJsonDraft<KataDraft>(kata ? kataDraftKey(id, kata.diff) : null, { rows: [{ ...EMPTY_FINDING }], assisted: false }, { parse: parseKataDraft, isEmpty: kataDraftEmpty });
  const [stored, setStored] = useState(kata?.answered === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rows, assisted } = draft.value;

  useEffect(() => {
    if (ks.key) draft.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ks.key]);
  useLadderDirtyGuard(ks.phase === 'answering' && !kataDraftEmpty(draft.value));

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
  const setRows = (f: (prev: KataFinding[]) => KataFinding[]) => draft.set((d) => ({ ...d, rows: f(d.rows) }));
  const setCell = (i: number, f: keyof KataFinding, v: string) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [f]: v } : r)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.submitKataFindings(id, { findings: rows, selfAssisted: assisted });
      setStored(true);
      draft.clear();
      try {
        ks.setKey(await api.getKataKey(id));
      } catch (e2) {
        ks.fail(errorText(e2));
      }
    } catch (e) {
      if (isApiError(e, 'ALREADY_ANSWERED')) {
        setStored(true);
        try {
          ks.setKey(await api.getKataKey(id));
        } catch (e2) {
          ks.fail(`${ladderErrorText(e)} ${errorText(e2)}`);
        }
      } else setError(ladderErrorText(e));
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
      {ks.key ? (
        <KataKeyView unitId={id} keyResp={ks.key} onStale={ks.reopen} />
      ) : ks.phase === 'checking' ? (
        <p className="muted small">Checking for earlier findings…</p>
      ) : ks.phase === 'unavailable' ? (
        <KeyUnavailable noun="findings" stored={stored || kata.answered === true} error={ks.error} onRetry={ks.retry} />
      ) : (
        <>
          <SupersededNote text={ks.notice} />
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
                  {FINDING_FIELDS.map((f) => (
                    <td key={f}>
                      <textarea
                        className={`answer-text finding-cell${f === 'evidence' ? ' is-mono' : ''}`}
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
            <HelpBox checked={assisted} onChange={(v) => draft.set((d) => ({ ...d, assisted: v }))} disabled={busy} />
            <span className="toolbar-spacer" />
            <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void submit()}>
              <Icon name="check" /> Submit findings (immutable)
            </button>
          </div>
          <p className="muted small">Findings are stored immutably; the seeded-defect key is shown only after.</p>
          <DraftNote restored={draft.restored} />
          <ErrorLine error={error} />
        </>
      )}
    </section>
  );
}

function KataKeyView({ unitId, keyResp, onStale }: { unitId: number; keyResp: KataKeyResponse; onStale: (message: string | null) => void }) {
  const api = useApi();
  const [marks, setMarks] = useState<Record<string, 'caught' | 'missed'>>({});
  const refreshTracks = useTracksRefresh();
  const [result, setResult] = useState<KataScoreResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = result !== null || keyResp.scored !== null;
  const ready = keyResp.defects.every((d) => marks[d.id] !== undefined);
  const total = keyResp.defects.length;
  const caught = keyResp.defects.filter((d) => marks[d.id] === 'caught').length;
  const marked = keyResp.defects.filter((d) => marks[d.id] !== undefined).length;
  const targetPct = G1_TARGET_RATE * 100;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.selfScoreKata(unitId, { perDefect: marks }));
      refreshTracks(); // W10: a self-score completes the unit (track progress)
    } catch (e) {
      if (isApiError(e, 'NOT_ANSWERED')) onStale(/superseded/.test(e.message) ? e.message : null);
      else setError(ladderErrorText(e));
    } finally {
      setBusy(false);
      setConfirming(false);
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
                    disabled={done || busy || confirming}
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
          <ScorePreview hit={caught} marked={marked} total={total} verb="caught" gatePct={targetPct} gateName="G1 target" />
          <span className="toolbar-spacer" />
          <button type="button" className="btn btn-primary" disabled={!ready || busy || confirming} onClick={() => setConfirming(true)}>
            <Icon name="check" /> Submit catch score
          </button>
        </div>
      )}
      {!done && confirming && (
        <ScoreConfirm
          id="kata-score-confirm"
          title="File this catch score?"
          summary={`${caught}/${total} caught = ${fmtPct(total ? caught / total : 0)}: ${meetsGate(caught, total, targetPct) ? 'meets' : 'below'} the ${targetPct}% G1 target.`}
          consequence="It feeds the G1 catch rate (solo, unassisted katas only)."
          confirmLabel="File catch score"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void send()}
        />
      )}
      <div className="results" aria-live="polite" data-testid="results">
        <ErrorLine error={error} />
        {result && (
          <div className={`verdict verdict-${result.catchRate >= G1_TARGET_RATE ? 'pass' : 'fail'}`} data-testid="catch-result">
            <Icon name={result.catchRate >= G1_TARGET_RATE ? 'check' : 'warn'} />
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
