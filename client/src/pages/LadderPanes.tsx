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
  type ApiError,
  type ExplainBackKeyResponse,
  type ExplainBackPublic,
  type ExplainBackScoreResponse,
  type KataFinding,
  type KataKeyResponse,
  type KataScoreResponse,
  type TolerantSuperseded,
  type UnitDetail,
  type UnitSourceResponse,
} from '../api/types';
import { Icon } from '../components/Icon';
import { Chip } from '../components/ui';
import { contentHash, useDirtyGuard, useJsonDraft } from '../lib/draft';
import { ebMeetsGate, ebTally, kpWeight, stripKpWeight, type EbTally } from '../lib/eb-weights';
import { answerWords, EB_MAX_W3_MISSED, EB_MIN_ANSWER_WORDS } from '@bootquest/shared/eb-weight';
import { INTERVIEW_FRAMEWORK, INTERVIEW_TIME_BOX_MS } from '@bootquest/shared/api-ext';
import { buildClaudePrompt, CopyPromptButton } from '../lib/claude-prompt';
import { fmtWhen } from '../lib/format';
import { InlineProse } from '../lib/prose';
import { useTracksRefresh } from '../lib/tracks';
import { competencyLabel } from '../lib/view';
import { NotebookLine } from './Player/NotebookLine';
import { ConfidencePick } from './StudyQuestPane';
import type { Confidence } from '../api/types';

const fmtPct = (x: number) => `${Math.round(x * 1000) / 10}%`;

type ArtifactRef = NonNullable<ExplainBackPublic['artifactRequired']>[number];

const ARTIFACT_REQUIRED_TEXT =
  'Pass the linked project unit solo first: this explain-back is its promotion leg (b), and the set takes one answer only, so an answer stored now could never count. Your draft is kept.';

/**
 * errorText plus the ladder-specific line: ARTIFACT_REQUIRED gets the pane's longer line (it says
 * the draft is kept). ALREADY_ANSWERED needs nothing here: errorText itself shows the server's text
 * for it (it names the stored answer and where to self-score it). A NOT_ANSWERED never lands here:
 * every path routes it to the superseded notice (supersededNotice).
 */
function ladderErrorText(e: unknown): string {
  if (isApiError(e, 'ARTIFACT_REQUIRED')) return `${ARTIFACT_REQUIRED_TEXT} (ARTIFACT_REQUIRED)`;
  return errorText(e);
}

// ---------------------------------------------------------------- superseded (re-seeded) answers

/** Earlier-version answers of the learner, superseded by a re-seed (ids; the server's text on an older server). */
interface Superseded {
  ids: number[];
  text: string | null;
}

/** The structured `supersededAnswerIds` of a public half; undefined when the server does not send it. */
const supersededIdsOf = (pub: object | null | undefined): number[] | undefined => {
  const ids = (pub as TolerantSuperseded | null | undefined)?.supersededAnswerIds;
  return Array.isArray(ids) ? ids : undefined;
};

/**
 * The notice to show over a fresh answer form. The structured field wins when the server sends
 * it; an older server only names the superseded answer inside its NOT_ANSWERED message, so that
 * text is the fallback.
 */
function supersededNotice(ids: number[] | undefined, message: string | null): Superseded | null {
  if (ids !== undefined) return ids.length > 0 ? { ids, text: null } : null;
  if (message === null || !/superseded/.test(message)) return null;
  return { ids: [...message.matchAll(/#(\d+)/g)].map((m) => Number(m[1])), text: message };
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

const LADDER_LEAVE_MESSAGE = 'Your unsent answers are not saved anywhere (this browser is not storing drafts). Leave this page and lose them?';

/**
 * Leaving loses work only when it exists nowhere else: the draft is dirty AND storage refused it
 * (private window, blocked site data, quota). A stored draft restores on the next visit, so then
 * neither a reload nor an in-app navigation asks. Both halves are armed (tab close + in-app).
 */
const useLadderDirtyGuard = (dirty: boolean, persisted: boolean): void => useDirtyGuard(!persisted && dirty, LADDER_LEAVE_MESSAGE);

function DraftNote({ restored, persisted }: { restored: boolean; persisted: boolean }) {
  return (
    <>
      {!persisted && (
        <p className="draft-warn" data-testid="draft-unsaved">
          <Icon name="warn" size={14} /> Draft not saved (this browser is not storing drafts): leaving this page will lose it.
        </p>
      )}
      <p className="muted small draft-note" data-testid="draft-note">
        {restored && (
          <span data-testid="draft-restored">
            <Icon name="info" size={14} /> Restored your unsent draft.
          </span>
        )}
        <span>Unsent drafts are kept in this browser only; nothing is recorded until you submit.</span>
      </p>
    </>
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
function useExistingKey<T>(load: () => Promise<T>, answered: boolean | undefined, superseded: number[] | undefined) {
  const [key, setKeyState] = useState<T | null>(null);
  const [phase, setPhase] = useState<KeyPhase>(answered === false ? 'answering' : 'checking');
  const [error, setError] = useState<string | null>(null);
  /**
   * earlier-version answers superseded by a re-seed: from the unit detail itself (so a fresh form
   * never appears unexplained), or, on an older server, from a NOT_ANSWERED message
   */
  const [notice, setNotice] = useState<Superseded | null>(() => supersededNotice(superseded, null));
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
          setNotice(supersededNotice(superseded, e.message));
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
    reopen: (next: Superseded | null) => {
      setKeyState(null);
      setNotice(next);
      setPhase('answering');
    },
  };
}

/**
 * A self-score answered NOT_ANSWERED: the item was re-seeded while its key view was open. Re-read
 * the unit for the structured superseded ids (the detail held by the page predates the re-seed);
 * the error's own text is the fallback for an older server or a failed re-read.
 */
async function staleNotice(e: ApiError, reread: () => Promise<object | null | undefined>): Promise<Superseded | null> {
  let ids: number[] | undefined;
  try {
    ids = supersededIdsOf(await reread());
  } catch {
    ids = undefined;
  }
  return supersededNotice(ids, e.message);
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

function SupersededNote({ notice }: { notice: Superseded | null }) {
  if (!notice) return null;
  const { ids, text } = notice;
  const which = ids.length === 0 ? 'your earlier answer' : `your earlier answer${ids.length === 1 ? '' : 's'} ${ids.map((n) => `#${n}`).join(', ')}`;
  const pron = ids.length > 1 ? 'those answers are' : 'that answer is';
  return (
    <div className="verdict verdict-todo" data-testid="superseded-note">
      <Icon name="info" /> This item was re-seeded since {which}, so {pron} superseded (kept, never keyed against the new version). Answer the
      new version below.{text && <span className="muted"> {text}</span>}
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

/**
 * A5: an explain-back key point. A `[wN]` prefix renders as a weight chip and the text without it
 * (display only: the served and stored text keep the prefix).
 */
function KpText({ text }: { text: string }) {
  const w = kpWeight(text);
  return (
    <>
      {w !== null && (
        <span className="kp-weight" title={w === 3 ? 'weight 3: must be covered to pass' : `weight ${w}`} data-testid="kp-weight">
          <Chip tone={w === 3 ? 'accent' : w === 2 ? 'info' : 'neutral'}>w{w}</Chip>{' '}
        </span>
      )}
      <InlineProse text={w !== null ? stripKpWeight(text) : text} />
    </>
  );
}

/** "q1k3, q2k1" for [w3] ids */
const idList = (ids: readonly string[]) => ids.join(', ');

/**
 * The explain-back live preview: plain covered/total for a legacy set (exactly the old preview);
 * weighted coverage plus the "at most one [w3] missed" rule for a weighted set (rv B, D4).
 */
function EbScorePreview({ t, gatePct, gateName }: { t: EbTally; gatePct: number; gateName: string }) {
  if (!t.weighted) return <ScorePreview hit={t.covered} marked={t.marked} total={t.total} verb="covered" gatePct={gatePct} gateName={gateName} />;
  const ok = ebMeetsGate(t, gatePct);
  const unmarked = t.total - t.marked;
  const w3 = t.w3Missed.length
    ? `[w3] missed: ${idList(t.w3Missed)} (${t.w3Missed.length > EB_MAX_W3_MISSED ? `more than ${EB_MAX_W3_MISSED} missed fails, whatever the coverage` : `${EB_MAX_W3_MISSED} miss allowed`})`
    : t.w3Unmarked.length
      ? `at most ${EB_MAX_W3_MISSED} [w3] may be missed (${t.w3Unmarked.length} [w3] still unmarked)`
      : 'every [w3] covered';
  return (
    <span className={`score-preview ${ok ? 'is-pass' : 'is-fail'}`} data-testid="score-preview" aria-live="polite">
      <strong>
        weighted {t.hitWeight}/{t.allWeight} = {fmtPct(t.coverage)}
      </strong>{' '}
      ({t.covered}/{t.total} key points) — {ok ? 'meets' : 'below'} the {gatePct}% {gateName}; {w3}
      {unmarked > 0 ? ` (${unmarked} still unmarked)` : ''}
    </span>
  );
}

/** The [w3] key points (id + display text) of a weighted key response among `missed`. */
function w3MissedOf(keyResp: ExplainBackKeyResponse, missed: readonly string[]): { id: string; text: string }[] {
  if (!isWeightedKey(keyResp)) return [];
  return keyResp.questions
    .flatMap((q) => q.keyPoints)
    .filter((k) => missed.includes(k.id) && kpWeight(k.text) === 3)
    .map((k) => ({ id: k.id, text: stripKpWeight(k.text) }));
}

function isWeightedKey(keyResp: ExplainBackKeyResponse): boolean {
  return ebTally(keyResp.questions.flatMap((q) => q.keyPoints), {}).weighted;
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

type AltSets = NonNullable<ExplainBackPublic['altSets']>;

/**
 * Explain-back ALTERNATE sets: the sibling question sets over the same source. Each chip links to
 * its unit and says whether that set is answered / self-scored; the current set is marked.
 */
function AltSetStrip({ altSets, current }: { altSets: AltSets; current: number }) {
  return (
    <nav className="alt-sets" aria-label="Alternate question sets" data-testid="alt-sets">
      <span className="muted small">Question sets on this source:</span>{' '}
      {altSets.siblings.map((s) => {
        const state = s.scored ? 'scored' : s.answered ? 'answered' : 'new';
        const text = `Set ${s.label} · ${state}`;
        const tone = s.scored ? 'chip-success' : s.answered ? 'chip-info' : '';
        return s.unitId === current ? (
          <span key={s.unitId} className="chip chip-accent" aria-current="page" data-testid={`alt-set-${s.label}`}>
            {text} (this set)
          </span>
        ) : (
          <Link key={s.unitId} to={`/play/${s.unitId}`} className={`chip ${tone}`.trim()} data-testid={`alt-set-${s.label}`}>
            {text}
          </Link>
        );
      })}
    </nav>
  );
}

/** The rotation gate of an alternate set (server: 409 NOT_DUE): the form stays read-only until it opens. */
function SetGateLock({ label, opensAt }: { label: string; opensAt: number | null }) {
  return (
    <div className="verdict verdict-todo" role="note" data-testid="set-gate-lock">
      <Icon name="lock" />
      <span>
        <strong>
          Alternate set {label} opens {opensAt === null ? 'later' : fmtWhen(opensAt)}
        </strong>{' '}
        — spaced repetition: fresh sets are at least 2 days apart. Read the questions now; answering opens then.
      </span>
    </div>
  );
}

const BLIND_MARKER = 'Write your design before you look:';

/**
 * A5 blind mode (client-only, display only): a `[senior]` DESIGN IT prompt that carries the marker
 * sentence can hide everything after it (the section list) until the answer is stored. Prompts
 * without the marker get no toggle (no guessing). Returns null when the prompt is not blindable.
 */
export function blindSplit(prompt: string): { head: string; rest: string } | null {
  if (!prompt.includes('[senior]')) return null;
  const i = prompt.indexOf(BLIND_MARKER);
  if (i < 0) return null;
  const end = i + BLIND_MARKER.length;
  return { head: prompt.slice(0, end), rest: prompt.slice(end) };
}

// ---------------------------------------------------------------- rv2 S3 (F5): interview mode S

/** mm:ss of a duration (negative = 0). */
export const fmtClock = (ms: number): string => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** A ticking "now" while `on` (one render a second). */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/**
 * Interview mode S (R4-round2 "do first", PLAN F5) for a DESIGN IT set: a 45-minute time box on screen, blind on
 * (the section list stays hidden), and the six delivery-framework headings to walk in order. It changes nothing
 * the server grades: the answer is the same answer of record, stored before any key point is shown; the elapsed
 * time and the blind flag are filed with it (POST .../interview) before the key is read.
 */
function InterviewBar({ startedAt, onStart, disabled }: { startedAt: number | null; onStart: () => void; disabled: boolean }) {
  const now = useNow(startedAt !== null);
  if (startedAt === null) {
    return (
      <div className="interview-offer small" data-testid="interview-offer">
        <strong>Interview mode:</strong> <span className="muted">a {INTERVIEW_TIME_BOX_MS / 60_000}-minute time box, blind, the six framework headings. Graded exactly the same; the time is kept with your answer.</span>{' '}
        <button type="button" className="btn btn-sm" onClick={onStart} disabled={disabled} data-testid="interview-start">
          Start the interview
        </button>
      </div>
    );
  }
  const elapsed = now - startedAt;
  const over = elapsed > INTERVIEW_TIME_BOX_MS;
  return (
    <div className="interview-bar" data-testid="interview-bar" data-over={over ? 'true' : 'false'}>
      <p className="small" role="timer" aria-live="off" data-testid="interview-timer">
        <strong>Interview</strong> · {fmtClock(elapsed)} of {fmtClock(INTERVIEW_TIME_BOX_MS)}
        {over ? <span className="neg"> · over time by {fmtClock(elapsed - INTERVIEW_TIME_BOX_MS)}: wrap up with the trade-offs</span> : <span className="muted"> · {fmtClock(INTERVIEW_TIME_BOX_MS - elapsed)} left</span>}
      </p>
      <ol className="interview-framework small" aria-label="Delivery framework" data-testid="interview-framework">
        {INTERVIEW_FRAMEWORK.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ol>
      <p className="muted small">Say an envelope number before you draw, name what you give up in every trade-off. Blind mode stays on.</p>
    </div>
  );
}

export function ExplainBackPane({ detail }: { detail: UnitDetail }) {
  const api = useApi();
  const id = detail.unit.id;
  const pub = detail.explainBack ?? null;
  const ks = useExistingKey<ExplainBackKeyResponse>(() => api.getExplainBackKey(id), pub?.answered, supersededIdsOf(pub));
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
  const [gateOverride, setGateOverride] = useState<{ label: string; opensAt: number | null } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // rv B (R3-07): blind mode is ON by default for a [senior] DESIGN IT set; showing the sections is assisted
  const [blind, setBlind] = useState(true);
  // rv2 S3 (F5): interview mode S on a DESIGN IT set (sysdesign track); null = not started
  const designIt = detail.unit.trackId === 'sysdesign' && detail.unit.kind === 'explain-back';
  const [interviewAt, setInterviewAt] = useState<number | null>(null);
  const [metaNote, setMetaNote] = useState<string | null>(null);
  // rv2 S3 (F9): the optional confidence tag of the answer of record (picked before the key is shown)
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const { answers, assisted } = draft.value;
  // rv B (R3-05): a G2 delegation brief is OPEN-BOOK, with the repo tree pinned at the set's sha
  const g2 = detail.unit.key.startsWith('ladder/g2/');
  const [source, setSource] = useState<UnitSourceResponse | null>(null);
  useEffect(() => {
    if (!g2) return;
    let live = true;
    api.getUnitSource(id).then((s) => live && setSource(s), () => undefined);
    return () => {
      live = false;
    };
  }, [api, id, g2]);

  // the server holds the answer once its key is readable: the draft is spent
  useEffect(() => {
    if (ks.key) draft.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ks.key]);
  useLadderDirtyGuard(ks.phase === 'answering' && !ebDraftEmpty(draft.value), draft.persisted);

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
  // alternate sets: a fresh answer opens >= 2 days after the newest one in the set group
  const setGate = gateOverride ?? (pub.altSets && pub.answered !== true && !pub.altSets.gate.open ? { label: pub.altSets.label, opensAt: pub.altSets.gate.opensAt } : null);
  const locked = artifacts.length > 0 || setGate !== null;
  const strip = pub.altSets ? <AltSetStrip altSets={pub.altSets} current={id} /> : null;

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
      const rec = await api.answerExplainBack(id, { answers, selfAssisted: assisted });
      // rv2 S3 (F5): the interview's time goes with the answer just stored, BEFORE the key is read; a failure
      // here never blocks the key (the meta is an extra, not part of the answer of record)
      if (interviewAt !== null) {
        try {
          await api.recordInterviewMeta(id, { attemptId: rec.attemptId, elapsedMs: Math.min(86_400_000, Math.max(0, Date.now() - interviewAt)), timeBoxMs: INTERVIEW_TIME_BOX_MS, blind });
        } catch (e) {
          setMetaNote(`The interview time was not saved: ${errorText(e)}`);
        }
      }
      if (confidence !== null) {
        try {
          await api.tagConfidence(rec.attemptId, confidence);
        } catch {
          // never part of the answer of record: the key opens regardless
        }
      }
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
      } else if (isApiError(e, 'NOT_DUE')) {
        // raced: a sibling set was answered since the page loaded. Re-read the rotation gate.
        setError(ladderErrorText(e));
        try {
          const alt = (await api.getUnit(id)).explainBack?.altSets;
          if (alt && !alt.gate.open) {
            setGateOverride({ label: alt.label, opensAt: alt.gate.opensAt });
            setError(null); // the banner says it
          }
        } catch {
          // keep the friendly error line
        }
      } else setError(ladderErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const onStale = (e: ApiError) => void staleNotice(e, async () => (await api.getUnit(id)).explainBack).then(ks.reopen);
  if (ks.key) {
    return (
      <>
        {strip}
        {metaNote && (
          <p className="muted small" role="status" data-testid="interview-meta-error">
            {metaNote}
          </p>
        )}
        <ExplainBackKeyView unitId={id} keyResp={ks.key} gatePct={pub.minCoveragePct ?? PROMOTION_MIN_COVERAGE * 100} altSets={pub.altSets ?? null} onStale={onStale} />
      </>
    );
  }

  const ready = answers.length > 0 && answers.every((a) => a.trim() !== '');
  const frozen = busy || locked;

  return (
    <section className="panel player-work" aria-labelledby="eb-title">
      <h2 className="panel-title" id="eb-title">
        Explain it back
      </h2>
      {g2 ? (
        <p className="code-hidden-note" data-testid="open-book">
          <Icon name="info" size={14} /> Open book: write the brief with the repo open, as you would for a real delegation. Reading the repo is not &ldquo;help&rdquo;; your answers
          are still stored before the rubric is shown.{' '}
          {source && (
            <a href={source.url} target="_blank" rel="noopener noreferrer" data-testid="source-link">
              {source.repo} @ <code>{source.sha.slice(0, 7)}</code>
            </a>
          )}
        </p>
      ) : (
        <p className="code-hidden-note" data-testid="code-hidden">
          <Icon name="lock" size={14} /> Code hidden. Answer from memory, in your own words. Your answers are stored before the key points are shown.
        </p>
      )}
      {strip}
      {ks.phase === 'checking' && <p className="muted small">Checking for an earlier answer…</p>}
      {ks.phase === 'unavailable' && <KeyUnavailable noun="answers" stored={stored || pub.answered === true} error={ks.error} onRetry={ks.retry} />}
      {ks.phase === 'answering' && (
        <>
          <SupersededNote notice={ks.notice} />
          {artifacts.length > 0 && <ArtifactLock artifacts={artifacts} />}
          {setGate && <SetGateLock label={setGate.label} opensAt={setGate.opensAt} />}
          {pub.questions.some((q) => blindSplit(q.prompt) !== null) && (
            <p className="blind-toggle small" data-testid="blind-mode">
              {blind ? (
                <>
                  Blind mode (interview conditions): the section list after &ldquo;{BLIND_MARKER}&rdquo; is hidden until your answer is stored.{' '}
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={frozen || interviewAt !== null}
                    title={interviewAt !== null ? 'Blind mode stays on in interview mode' : undefined}
                    onClick={() => {
                      setBlind(false);
                      draft.set((d) => ({ ...d, assisted: true }));
                    }}
                  >
                    Show sections (assisted)
                  </button>
                </>
              ) : (
                <span className="muted">Sections shown: this answer is marked &ldquo;I had help&rdquo;.</span>
              )}
            </p>
          )}
          {designIt && (
            <InterviewBar
              startedAt={interviewAt}
              disabled={frozen}
              onStart={() => {
                setInterviewAt(Date.now());
                setBlind(true);
              }}
            />
          )}
          <ol className="eb-questions">
            {pub.questions.map((q, i) => {
              const split = blind ? blindSplit(q.prompt) : null;
              return (
                <li key={i} className="eb-question">
                  <label>
                    <span className="eb-prompt" data-testid={`eb-prompt-${i + 1}`}>
                      <InlineProse text={split ? split.head : q.prompt} />
                      {split && <span className="muted small"> (sections hidden: blind mode)</span>}
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
                  {/* rv B (R4-07): the server refuses an answer of record under EB_MIN_ANSWER_WORDS words */}
                  {(answers[i] ?? '').trim() !== '' && answerWords(answers[i] ?? '') < EB_MIN_ANSWER_WORDS && (
                    <span className="muted small eb-words" data-testid={`eb-words-${i + 1}`}>
                      {answerWords(answers[i] ?? '')} words: an answer needs at least {EB_MIN_ANSWER_WORDS}, in your own words.
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="toolbar">
            <HelpBox checked={assisted} onChange={(v) => draft.set((d) => ({ ...d, assisted: v }))} disabled={frozen} />
            <ConfidencePick value={confidence} onChange={setConfidence} disabled={frozen} name={`eb-confidence-${id}`} />
            <span className="toolbar-spacer" />
            <button type="button" className="btn btn-primary" disabled={!ready || frozen} onClick={() => setConfirming(true)}>
              <Icon name={locked ? 'lock' : 'check'} /> Submit answers
            </button>
          </div>
          {!locked && <DraftNote restored={draft.restored} persisted={draft.persisted} />}
          {confirming && !locked && (
            <div className="confirm" role="alertdialog" onKeyDown={(e) => e.key === 'Escape' && !busy && setConfirming(false)} aria-labelledby="eb-confirm-title" aria-describedby="eb-confirm-desc">
              <h3 id="eb-confirm-title">Submit your answers?</h3>
              <p id="eb-confirm-desc">
                Your answers cannot be edited afterwards. The key points appear only after this.
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

/** rv B (D6): the explain-back as a prompt: each question, the stored answer and its key points (the rubric). */
function ebPrompt(keyResp: ExplainBackKeyResponse): string {
  return buildClaudePrompt(
    keyResp.questions.map((q, qi) => ({
      source: `Explain-back question ${qi + 1}`,
      question: q.prompt,
      mine: keyResp.answers[qi] ?? '',
      keyed: q.keyPoints.map((k) => `\n  - ${k.id}${kpWeight(k.text) ? ` [w${kpWeight(k.text)}]` : ''}: ${stripKpWeight(k.text)}`).join(''),
    })),
    'I answered this explain-back in my study app. Compare my answers with the key points: say which points I covered, which I missed, and what a stronger answer would add.',
  );
}

function ExplainBackKeyView({
  unitId,
  keyResp,
  gatePct,
  altSets,
  onStale,
}: {
  unitId: number;
  keyResp: ExplainBackKeyResponse;
  /** the unit's own pass mark, percent (ExplainBackPublic.minCoveragePct) */
  gatePct: number;
  /** the unit's alternate-set group (ExplainBackPublic.altSets), null when it has none */
  altSets: AltSets | null;
  /** the self-score answered NOT_ANSWERED: the item was re-seeded since the key loaded */
  onStale: (e: ApiError) => void;
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
  // A5: weighted coverage + every [w3] for a weighted set; plain covered/total otherwise
  const tally = ebTally(keyResp.questions.flatMap((q) => q.keyPoints), marks);
  const { covered } = tally;
  const passes = ebMeetsGate(tally, gatePct);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.selfScoreExplainBack(unitId, { perKeyPoint: marks }));
      refreshTracks(); // W10: a self-score completes the unit (track progress)
    } catch (e) {
      // re-seeded since the key loaded: this answer is superseded, the new version takes a fresh one
      if (isApiError(e, 'NOT_ANSWERED')) onStale(e);
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
        Your answer was stored {fmtWhen(keyResp.answeredAt)} (immutable). Mark each key point your answer covered.{' '}
        {/* rv B (D6): a prompt for the learner's own Claude session; the app sends nothing */}
        <CopyPromptButton text={() => ebPrompt(keyResp)} testId="copy-prompt-eb" />
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
                      <KpText text={kp.text} />
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
          <EbScorePreview t={tally} gatePct={gatePct} gateName="promotion gate" />
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
          summary={
            tally.weighted
              ? `Weighted ${tally.hitWeight}/${tally.allWeight} = ${fmtPct(tally.coverage)} (${covered}/${allIds.length} key points): ${passes ? 'meets' : 'below'} the ${gatePct}% promotion gate${tally.w3Missed.length ? `; [w3] missed: ${idList(tally.w3Missed)} (at most ${EB_MAX_W3_MISSED} may be missed)` : ', every [w3] covered'}.`
              : `${covered}/${allIds.length} covered = ${fmtPct(covered / allIds.length)}: ${passes ? 'meets' : 'below'} the ${gatePct}% promotion gate.`
          }
          consequence={
            passes
              ? 'It counts toward promotion leg (b) only when this set is linked to an artifact you passed solo and your answers were unassisted.'
              : "It files a fail against this unit's gate: no XP and no retest."
          }
          confirmLabel="File self-score"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void send()}
        />
      )}
      <div className="results" aria-live="polite" data-testid="results">
        <ErrorLine error={error} />
        {result && <ExplainBackResult r={result} keyResp={keyResp} hasAltSets={altSets !== null && altSets.siblings.length > 1} />}
        {/* rv2 S3 (PLAN F6): after a self-score with a missed key point, the optional notebook line (0 XP, never blocks) */}
        {result && result.missed.length > 0 && <NotebookLine key={result.attemptId} unitId={unitId} attemptId={result.attemptId} />}
        {!result && scoredBefore && (
          <div className="verdict verdict-todo">
            <Icon name="check" /> Already self-scored: {fmtPct(scoredBefore.score)} {tally.weighted ? 'weighted ' : ''}coverage (evidence #{scoredBefore.evidenceIds.join(', #')}).
          </div>
        )}
      </div>
      {/* practice retakes open once the answer of record is self-scored (absent on older servers) */}
      {done && keyResp.practice !== undefined && <PracticeSection unitId={unitId} keyResp={keyResp} gatePct={gatePct} />}
    </section>
  );
}

// ---------------------------------------------------------------- explain-back PRACTICE retakes

type PracticeAttempt = NonNullable<ExplainBackKeyResponse['practice']>[number];

const PRACTICE_COPY = '0 XP, recorded as an assisted practice attempt — never counts toward promotion.';

/**
 * Practice retakes of a self-scored set: re-answer the same questions (the key was already read,
 * so the attempt is recorded ASSISTED with assistance 'practice'), then self-score it for feedback
 * only — no XP, no retest, never a promotion leg. One unscored practice attempt at a time; the
 * answer of record above is never touched. No localStorage draft: practice is repeatable.
 */
function PracticeSection({ unitId, keyResp, gatePct }: { unitId: number; keyResp: ExplainBackKeyResponse; gatePct: number }) {
  const api = useApi();
  const n = keyResp.questions.length;
  const [list, setList] = useState<PracticeAttempt[]>(keyResp.practice ?? []);
  const [writing, setWriting] = useState(false);
  const [answers, setAnswers] = useState<string[]>(() => Array.from({ length: n }, () => ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ExplainBackScoreResponse | null>(null);
  const unscored = list.find((p) => p.scored === null) ?? null;
  const ready = answers.every((a) => a.trim() !== '');

  const refresh = async () => {
    try {
      setList((await api.getExplainBackKey(unitId)).practice ?? []);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.practiceExplainBack(unitId, { answers });
      setWriting(false);
      setAnswers(Array.from({ length: n }, () => ''));
      await refresh();
    } catch (e) {
      setError(ladderErrorText(e));
      // ALREADY_ANSWERED: an unscored practice attempt exists (another tab): show it
      if (isApiError(e, 'ALREADY_ANSWERED')) await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="practice" data-testid="practice">
      <h3>Practice</h3>
      <p className="muted small" data-testid="practice-copy">
        Re-answer this set from memory as often as you like. {PRACTICE_COPY}
      </p>
      {list.length > 0 && (
        <ol className="practice-history" aria-label="Practice attempts">
          {/* the served list is oldest-first (ORDER BY id), so the index IS the per-unit ordinal the server's messages use */}
          {list.map((p, i) => (
            <li key={p.attemptId} className="practice-attempt" data-testid={`practice-${p.attemptId}`}>
              <p className="muted small">
                Practice attempt {i + 1} · stored {fmtWhen(p.answeredAt)}
                {p.scored ? ` — self-scored ${fmtPct(p.scored.score)} ${isWeightedKey(keyResp) ? 'weighted ' : ''}coverage (practice: 0 XP).` : ' — not scored yet.'}
              </p>
              {p.scored ? (
                <ol className="practice-answers">
                  {p.answers.map((a, i) => (
                    <li key={i}>
                      <p className="eb-stored">{a}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <PracticeScorer
                  unitId={unitId}
                  attempt={p}
                  keyResp={keyResp}
                  gatePct={gatePct}
                  onScored={(r) => {
                    setLastResult(r);
                    void refresh();
                  }}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      {!writing && (
        <div className="toolbar">
          <button
            type="button"
            className="btn"
            disabled={busy || unscored !== null}
            title={unscored ? 'Score your latest practice attempt first.' : undefined}
            onClick={() => {
              setError(null);
              setLastResult(null);
              setWriting(true);
            }}
          >
            <Icon name="cards" /> Practice again
          </button>
          {unscored && <span className="muted small">Score your latest practice attempt first.</span>}
        </div>
      )}
      {writing && (
        <>
          <ol className="eb-questions">
            {keyResp.questions.map((q, i) => (
              <li key={i} className="eb-question">
                <label>
                  <span className="eb-prompt">
                    <InlineProse text={q.prompt} />
                  </span>
                  <textarea
                    className="answer-text eb-answer"
                    rows={3}
                    value={answers[i] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAnswers((prev) => prev.map((a, j) => (j === i ? v : a)));
                    }}
                    aria-label={`Practice answer ${i + 1}`}
                    disabled={busy}
                  />
                </label>
              </li>
            ))}
          </ol>
          <div className="toolbar">
            <button type="button" className="btn" onClick={() => setWriting(false)} disabled={busy}>
              Cancel
            </button>
            <span className="toolbar-spacer" />
            <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void submit()}>
              <Icon name="check" /> Store practice answers
            </button>
          </div>
        </>
      )}
      {lastResult && <PracticeResult r={lastResult} keyResp={keyResp} />}
      <ErrorLine error={error} />
    </div>
  );
}

function PracticeResult({ r, keyResp }: { r: ExplainBackScoreResponse; keyResp: ExplainBackKeyResponse }) {
  const weighted = isWeightedKey(keyResp);
  const w3 = w3MissedOf(keyResp, r.missed);
  return (
    <div className={`verdict verdict-${r.passed ? 'pass' : 'fail'}`} data-testid="practice-result">
      <Icon name={r.passed ? 'check' : 'warn'} />
      <strong>
        {weighted ? `Practice weighted coverage ${fmtPct(r.coverage)} (${r.covered}/${r.total} key points)` : `Practice coverage ${fmtPct(r.coverage)} (${r.covered}/${r.total})`}
      </strong>
      <span className="muted">
        {r.passed ? 'meets' : w3.length ? `[w3] missed: ${idList(w3.map((k) => k.id))}, so below` : 'below'} the {r.minCoveragePct}% mark — feedback only: 0 XP, no retest, never a promotion leg
      </span>
    </div>
  );
}

/** Self-score ONE practice attempt against the key (feedback only; the record's own score is unchanged). */
function PracticeScorer({
  unitId,
  attempt,
  keyResp,
  gatePct,
  onScored,
}: {
  unitId: number;
  attempt: PracticeAttempt;
  keyResp: ExplainBackKeyResponse;
  gatePct: number;
  onScored: (r: ExplainBackScoreResponse) => void;
}) {
  const api = useApi();
  const allIds = keyResp.questions.flatMap((q) => q.keyPoints.map((k) => k.id));
  const [marks, setMarks] = useState<Record<string, 'covered' | 'missed'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tally = ebTally(keyResp.questions.flatMap((q) => q.keyPoints), marks);
  const ready = tally.marked === allIds.length;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      onScored(await api.practiceScoreExplainBack(unitId, { attemptId: attempt.attemptId, perKeyPoint: marks }));
    } catch (e) {
      setError(ladderErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="practice-scorer" data-testid={`practice-scorer-${attempt.attemptId}`}>
      <ol className="eb-questions">
        {keyResp.questions.map((q, qi) => (
          <li key={qi} className="eb-question">
            <span className="eb-prompt">
              <InlineProse text={q.prompt} />
            </span>
            <div className="eb-split">
              <div className="eb-mine">
                <span className="muted small">Your practice answer</span>
                <p className="eb-stored" data-testid={`practice-answer-${qi + 1}`}>
                  {attempt.answers[qi] ?? ''}
                </p>
              </div>
              <ul className="checklist" aria-label={`Practice key points for question ${qi + 1}`}>
                {q.keyPoints.map((kp) => (
                  <li key={kp.id} className={`checklist-item${marks[kp.id] ? ` is-${marks[kp.id]}` : ''}`}>
                    <span className="checklist-text">
                      <KpText text={kp.text} />
                    </span>
                    <span className="seg" role="radiogroup" aria-label={`practice ${kp.id} coverage`}>
                      {(['covered', 'missed'] as const).map((m) => (
                        <label key={m} className={`seg-opt${marks[kp.id] === m ? ' on' : ''}`}>
                          <input
                            type="radio"
                            name={`pkp-${attempt.attemptId}-${kp.id}`}
                            checked={marks[kp.id] === m}
                            disabled={busy}
                            onChange={() => setMarks((prev) => ({ ...prev, [kp.id]: m }))}
                            aria-label={`practice ${kp.id} ${m}`}
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
      <div className="toolbar">
        <EbScorePreview t={tally} gatePct={gatePct} gateName="pass mark (practice: feedback only)" />
        <span className="toolbar-spacer" />
        <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void send()}>
          <Icon name="check" /> File practice score
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/**
 * hasAltSets: the unit rotates alternate question sets (>= 2 siblings). Such a unit has no
 * changed-example retest by design — its spaced repetition is the next fresh set, so a passing
 * score with no retest names that path instead of "no variation is seeded yet".
 */
function ExplainBackResult({ r, keyResp, hasAltSets }: { r: ExplainBackScoreResponse; keyResp: ExplainBackKeyResponse; hasAltSets: boolean }) {
  // A5: `r.coverage` is the score of record (weighted for a weighted set); a weighted set also fails on any missed [w3]
  const weighted = isWeightedKey(keyResp);
  const w3 = w3MissedOf(keyResp, r.missed);
  const tooManyW3 = w3.length > EB_MAX_W3_MISSED;
  const verdictText = r.passed
    ? `meets the ${r.minCoveragePct}% promotion threshold${weighted ? (w3.length ? `, ${w3.length} [w3] missed (at most ${EB_MAX_W3_MISSED} allowed)` : ', every [w3] covered') : ''}`
    : tooManyW3
      ? `not a pass: at most ${EB_MAX_W3_MISSED} [w3] key point may be missed, whatever the coverage (the ${r.minCoveragePct}% threshold applies to the weighted coverage)`
      : `below the ${r.minCoveragePct}% promotion threshold`;
  return (
    <>
      <div className={`verdict verdict-${r.passed ? 'pass' : 'fail'}`} data-testid="coverage-result">
        <Icon name={r.passed ? 'check' : 'warn'} />
        <strong>
          {weighted ? `Weighted coverage ${fmtPct(r.coverage)} (${r.covered}/${r.total} key points)` : `Coverage ${fmtPct(r.coverage)} (${r.covered}/${r.total})`}
        </strong>
        <span className="muted">{verdictText}</span>
        <span className="verdict-xp">{r.xp ? (r.xp.amount > 0 ? `+${r.xp.amount} XP` : `0 XP${r.xp.reason ? ` (${r.xp.reason})` : ''}`) : '0 XP'}</span>
      </div>
      {w3.length > 0 && (
        <div className={`verdict verdict-${tooManyW3 ? 'fail' : 'todo'}`} data-testid="w3-missed">
          <Icon name="warn" /> Missed [w3] key point{w3.length > 1 ? 's' : ''}:{' '}
          {w3.map((k, i) => (
            <Fragment key={k.id}>
              {i > 0 && '; '}
              <strong>{k.id}</strong> <InlineProse text={k.text} />
            </Fragment>
          ))}
        </div>
      )}
      {r.retests.length > 0 ? (
        r.retests.map((t) => (
          <div key={t.reviewItemId} className="verdict verdict-todo" data-testid="retest-notice">
            <Icon name="cards" /> Retest scheduled: <Link to={`/play/${t.unitId}`}>{t.title}</Link> opens {fmtWhen(t.dueAt)} (a changed example, at least 2 days later, no help).
          </div>
        ))
      ) : r.passed && hasAltSets ? (
        <div className="verdict verdict-todo" data-testid="retest-notice">
          <Icon name="cards" /> No changed-example retest for this unit — its spaced repetition is the rotating question sets (see the set pills above): the next fresh set opens at least 2 days after this answer.
        </div>
      ) : (
        <div className="verdict verdict-todo" data-testid="retest-notice">
          <Icon name="warn" /> No retest scheduled
          {r.passed ? ' (no changed-example variation is seeded for this artifact yet).' : tooManyW3 ? ` — more than ${EB_MAX_W3_MISSED} [w3] key point was missed.` : ' — coverage is below the promotion threshold.'}
        </div>
      )}
      {r.promotions.map((p) => (
        <div key={p.evidenceId} className="verdict verdict-pass">
          <Icon name="bolt" /> Promoted {competencyLabel(p.competency)}: {p.from} → {p.to}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- patch-review kata

type DiffLineClass = 'diff-file' | 'diff-hunk' | 'diff-add' | 'diff-del' | 'diff-ctx';

const HUNK_RE = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

/**
 * Classify every line of a unified diff. Inside a hunk the first character alone decides (`-` is a
 * removal, `+` an addition): a removed SQL comment reads `-- note` and a removed `-- x` line reads
 * `--- x`, and neither is a file header. `---` / `+++` are headers only between hunks; the hunk's
 * own line counts say where it ends.
 */
export function classifyDiff(lines: readonly string[]): DiffLineClass[] {
  let oldLeft = 0;
  let newLeft = 0;
  let open = false; // a hunk whose header carried no usable counts: open until the next header
  return lines.map((line) => {
    const inHunk = open || oldLeft > 0 || newLeft > 0;
    if (line.startsWith('@@')) {
      const m = HUNK_RE.exec(line);
      oldLeft = m ? Number(m[1] ?? 1) : 0;
      newLeft = m ? Number(m[2] ?? 1) : 0;
      open = !m;
      return 'diff-hunk';
    }
    if (line.startsWith('diff ')) {
      oldLeft = newLeft = 0;
      open = false;
      return 'diff-file';
    }
    if (!inHunk) {
      if (line.startsWith('+++') || line.startsWith('---')) return 'diff-file';
      return line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : 'diff-ctx';
    }
    if (line.startsWith('+')) {
      newLeft = Math.max(0, newLeft - 1);
      return 'diff-add';
    }
    if (line.startsWith('-')) {
      oldLeft = Math.max(0, oldLeft - 1);
      return 'diff-del';
    }
    if (!line.startsWith('\\')) {
      // a context line counts on both sides ("\ No newline at end of file" counts on neither)
      oldLeft = Math.max(0, oldLeft - 1);
      newLeft = Math.max(0, newLeft - 1);
    }
    return 'diff-ctx';
  });
}

/** Which comment forms a file type has. A file type that is not listed has none: nothing in it folds. */
export interface CommentSyntax {
  /** `// x` */
  line: boolean;
  /** a C-style block comment (and, only inside one, its `* x` lines) */
  block: boolean;
  /** `# x` */
  hash: boolean;
  /** `-- x` */
  dash: boolean;
  /** an HTML / XML comment on one line */
  html: boolean;
}
const NO_COMMENTS: CommentSyntax = { line: false, block: false, hash: false, dash: false, html: false };
const syntaxOf = (on: Partial<CommentSyntax>): CommentSyntax => ({ ...NO_COMMENTS, ...on });
const C_LIKE = syntaxOf({ line: true, block: true });
const HASH = syntaxOf({ hash: true });
const MARKUP = syntaxOf({ html: true });
const all = (exts: readonly string[], sx: CommentSyntax): Record<string, CommentSyntax> => Object.fromEntries(exts.map((e) => [e, sx]));
const SYNTAX_BY_EXT: Readonly<Record<string, CommentSyntax>> = {
  ...all(
    ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'java', 'cs', 'c', 'h', 'cc', 'cpp', 'hpp', 'go', 'rs', 'kt', 'kts', 'swift', 'scala', 'dart', 'groovy', 'gradle', 'proto', 'scss', 'less', 'jsonc', 'json5'],
    C_LIKE,
  ),
  ...all(['py', 'rb', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'dockerfile', 'env', 'mk', 'pl', 'r', 'ps1', 'properties', 'conf'], HASH),
  ...all(['html', 'htm', 'xml', 'svg', 'xaml', 'csproj', 'props', 'targets'], MARKUP),
  css: syntaxOf({ block: true }),
  php: syntaxOf({ line: true, block: true, hash: true }),
  tf: syntaxOf({ line: true, block: true, hash: true }),
  sql: syntaxOf({ dash: true, block: true }),
  lua: syntaxOf({ dash: true }),
  hs: syntaxOf({ dash: true }),
};
/** Files named for what they are: `Dockerfile`, `Dockerfile.dev`, `Makefile`, `.env`, `.env.local`, `.gitignore`. */
const HASH_NAME_RE = /^(dockerfile(\..+)?|makefile|gnumakefile|\.env(\..+)?|\.gitignore|\.dockerignore)$/;

/**
 * The comment forms of a file, by its path. `#` is a comment in Python or YAML and a heading in
 * markdown; `--` is a comment in SQL and an operator elsewhere: what folds depends on the file.
 * Markdown, and every file type that is not known, has no foldable comments at all.
 */
export function commentSyntaxOf(path: string | null | undefined): CommentSyntax {
  if (!path) return NO_COMMENTS;
  const name = path.split(/[\\/]/).pop()!.toLowerCase();
  if (HASH_NAME_RE.test(name)) return HASH;
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? SYNTAX_BY_EXT[name.slice(dot + 1)] : undefined) ?? NO_COMMENTS;
}

/** The file a `diff --git a/x b/y`, `+++ b/y` or `--- a/x` header names (null: none, or /dev/null). */
export function diffHeaderPath(line: string): string | null {
  const git = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
  if (git) return git[2]!.trim();
  const side = /^(?:\+\+\+|---) ([^\t]+)/.exec(line);
  if (!side) return null;
  const p = side[1]!.trim();
  return p === '/dev/null' ? null : p.replace(/^[ab]\//, '');
}

/**
 * One line of a file (no diff marker): is it nothing but a comment in this syntax, and is a block
 * comment still open after it? A block opens only at the START of a line (a comment that begins
 * after code is left alone), so a glob such as `'src/*.ts'` in code never opens one.
 */
function scanCommentLine(text: string, sx: CommentSyntax, inBlock: boolean): { comment: boolean; inBlock: boolean } {
  let t = text.trim();
  let open = inBlock;
  let seen = inBlock; // comment text was on this line
  for (;;) {
    if (open) {
      const end = t.indexOf('*/');
      if (end === -1) return { comment: true, inBlock: true };
      t = t.slice(end + 2).trimStart();
      open = false;
      continue;
    }
    if (t === '') return { comment: seen, inBlock: false };
    if (sx.block && t.startsWith('/*')) {
      t = t.slice(2);
      open = seen = true;
      continue;
    }
    if (sx.line && t.startsWith('//')) return { comment: true, inBlock: false };
    if (!seen && ((sx.hash && t.startsWith('#')) || (sx.dash && t.startsWith('--')) || (sx.html && /^<!--.*-->$/.test(t)))) return { comment: true, inBlock: false };
    return { comment: false, inBlock: false }; // code
  }
}

/**
 * A removed line that holds nothing but a comment, for the file at `path` (commentSyntaxOf).
 * `inBlock`: the line sits inside a block comment that an earlier line opened; only then is a
 * `* x` line a comment. Without a known file type nothing is a comment.
 */
export function isRemovedCommentLine(line: string, path?: string | null, inBlock = false): boolean {
  if (!line.startsWith('-')) return false;
  return scanCommentLine(line.slice(1), commentSyntaxOf(path), inBlock).comment;
}

/**
 * Per line: is it a removed comment-only line? The file type comes from the header of the line's
 * own file section, and block-comment context is followed down the OLD side of each hunk (context
 * and removed lines; an added line is not part of the old file).
 */
export function removedCommentLines(lines: readonly string[], cls: readonly DiffLineClass[]): boolean[] {
  let sx = NO_COMMENTS;
  let inBlock = false;
  return lines.map((line, i) => {
    const c = cls[i];
    if (c === 'diff-file') {
      const p = diffHeaderPath(line);
      if (p !== null) sx = commentSyntaxOf(p);
      inBlock = false;
      return false;
    }
    if (c === 'diff-hunk') {
      inBlock = false;
      return false;
    }
    if (c === 'diff-add' || line.startsWith('\\')) return false;
    const r = scanCommentLine(line.slice(1), sx, inBlock);
    inBlock = r.inBlock;
    return c === 'diff-del' && r.comment;
  });
}

type DiffRow = { kind: 'line'; i: number } | { kind: 'fold'; from: number; to: number } | { kind: 'harness'; from: number; to: number; path: string };

/** The kata harness mirror (R2-14): a copy of the seeded change under `bootquest-kata/` that shows the defect twice. */
export const KATA_HARNESS_PREFIX = 'bootquest-kata/';

/** Per line: the path of the diff file section it belongs to (from its `diff --git` / `---` / `+++` header). */
export function diffSectionPaths(lines: readonly string[], cls: readonly DiffLineClass[]): (string | null)[] {
  let path: string | null = null;
  return lines.map((line, i) => {
    if (cls[i] === 'diff-file') {
      const p = diffHeaderPath(line);
      if (p !== null) path = p;
      else if (line.startsWith('diff ')) path = null;
    }
    return path;
  });
}

/**
 * rv B (R3-03): finding markers left in the source point straight at the defect ("finding T4", "(F10)",
 * "Step-6 answer", "exercise 3"): they render as "[ref]". Display only; the stored diff is untouched.
 */
export const FINDING_MARKER_RE = /finding [A-Z]?\d+|\(F\d+\)|Step-\d+ answer|exercise \d+/gi;
export const maskFindingMarkers = (text: string): string => text.replace(FINDING_MARKER_RE, '[ref]');

/**
 * Runs of two or more removed comment-only lines (inside a hunk) fold into one row; rv B (R2-14): every file
 * section under `bootquest-kata/` (the harness mirror) folds into one row as a whole.
 */
function diffRows(lines: readonly string[], cls: readonly DiffLineClass[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const comment = removedCommentLines(lines, cls);
  const paths = diffSectionPaths(lines, cls);
  const harness = (i: number) => paths[i]?.startsWith(KATA_HARNESS_PREFIX) === true;
  const foldable = (i: number) => comment[i] === true;
  for (let i = 0; i < lines.length; ) {
    if (harness(i)) {
      let h = i;
      while (h < lines.length && harness(h)) h++;
      // the section's own `diff --git` header line came before its path was known: pull it into the fold
      const from = rows.length > 0 && rows[rows.length - 1]!.kind === 'line' && lines[(rows[rows.length - 1] as { i: number }).i]!.startsWith('diff ') ? (rows.pop() as { i: number }).i : i;
      rows.push({ kind: 'harness', from, to: h, path: paths[i]! });
      i = h;
      continue;
    }
    let j = i;
    while (j < lines.length && foldable(j)) j++;
    if (j - i >= 2) {
      rows.push({ kind: 'fold', from: i, to: j });
      i = j;
    } else {
      rows.push({ kind: 'line', i });
      i++;
    }
  }
  return rows;
}

/**
 * Plain unified-diff viewer: one span per line, colored by what the line is. Removed comments are
 * noise in a review (the patch under review rarely hides its defect in one), so a run of them is
 * collapsed to "N comment lines removed" and opens on click.
 */
export function DiffView({ diff, wrap = false }: { diff: string; wrap?: boolean }) {
  const lines = diff.split('\n');
  const cls = classifyDiff(lines);
  const span = (i: number) => (
    <span key={i} className={`diff-line ${cls[i]}`}>
      {maskFindingMarkers(lines[i]!)}
      {'\n'}
    </span>
  );
  return (
    <pre className={`code-block diff-view${wrap ? ' diff-wrap' : ''}`} data-testid="diff">
      {diffRows(lines, cls).map((row) =>
        row.kind === 'line' ? (
          span(row.i)
        ) : row.kind === 'harness' ? (
          <details key={`harness-${row.from}`} className="diff-fold" data-testid="diff-harness">
            <summary>
              Test harness mirror <code>{row.path}</code> ({row.to - row.from} lines): the same change copied for the checks, not part of the review
            </summary>
            {Array.from({ length: row.to - row.from }, (_, k) => span(row.from + k))}
          </details>
        ) : (
          <details key={`fold-${row.from}`} className="diff-fold" data-testid="diff-fold">
            <summary>{row.to - row.from} comment lines removed</summary>
            {Array.from({ length: row.to - row.from }, (_, k) => span(row.from + k))}
          </details>
        ),
      )}
    </pre>
  );
}

/**
 * rv B (R3-03): a kata context file is the PRE-patch source, so the explanatory comment the patch removed is
 * still in it, verbatim (14/14 katas that remove one). Runs of two or more comment-only lines fold here too, and
 * finding markers render as "[ref]". Display only.
 */
export type ContextRow = { kind: 'line'; text: string } | { kind: 'fold'; lines: string[] };
export function contextRows(content: string, path: string): ContextRow[] {
  const sx = commentSyntaxOf(path);
  const lines = content.split('\n');
  let inBlock = false;
  const comment = lines.map((l) => {
    const r = scanCommentLine(l, sx, inBlock);
    inBlock = r.inBlock;
    return r.comment;
  });
  const rows: ContextRow[] = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j < lines.length && comment[j]) j++;
    if (j - i >= 2) {
      rows.push({ kind: 'fold', lines: lines.slice(i, j) });
      i = j;
    } else {
      rows.push({ kind: 'line', text: lines[i]! });
      i++;
    }
  }
  return rows;
}

function ContextFile({ path, content }: { path: string; content: string }) {
  const rows = contextRows(content, path);
  return (
    <pre className="code-block" data-testid="context-file">
      {rows.map((r, i) =>
        r.kind === 'line' ? (
          <span key={i}>
            {maskFindingMarkers(r.text)}
            {'\n'}
          </span>
        ) : (
          <details key={i} className="diff-fold" data-testid="context-fold">
            <summary>{r.lines.length} comment lines</summary>
            {r.lines.map((l, k) => (
              <span key={k}>
                {maskFindingMarkers(l)}
                {'\n'}
              </span>
            ))}
          </details>
        ),
      )}
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
  const ks = useExistingKey<KataKeyResponse>(() => api.getKataKey(id), kata?.answered, supersededIdsOf(kata));
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
  useLadderDirtyGuard(ks.phase === 'answering' && !kataDraftEmpty(draft.value), draft.persisted);

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
        Review this patch like a PR. Find every seeded defect you can: how many there are is shown with the key, after your findings are recorded. Runs
        of removed comment lines are collapsed; click one to expand it.
      </p>
      <DiffView diff={kata.diff} wrap={wrap} />
      {kata.contextFiles.map((f) => (
        <details key={f.path} className="streams">
          <summary>
            Context: <code>{f.path}</code>
          </summary>
          <ContextFile path={f.path} content={f.content} />
        </details>
      ))}
      {ks.key ? (
        <KataKeyView unitId={id} keyResp={ks.key} onStale={(e) => void staleNotice(e, async () => (await api.getUnit(id)).kata).then(ks.reopen)} />
      ) : ks.phase === 'checking' ? (
        <p className="muted small">Checking for earlier findings…</p>
      ) : ks.phase === 'unavailable' ? (
        <KeyUnavailable noun="findings" stored={stored || kata.answered === true} error={ks.error} onRetry={ks.retry} />
      ) : (
        <>
          <SupersededNote notice={ks.notice} />
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
              <Icon name="check" /> Submit findings
            </button>
          </div>
          <p className="muted small submit-note" data-testid="findings-final">
            You can&apos;t edit them afterwards. The seeded-defect key is shown only after you submit.
          </p>
          <DraftNote restored={draft.restored} persisted={draft.persisted} />
          <ErrorLine error={error} />
        </>
      )}
    </section>
  );
}

function KataKeyView({ unitId, keyResp, onStale }: { unitId: number; keyResp: KataKeyResponse; onStale: (e: ApiError) => void }) {
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
      if (isApiError(e, 'NOT_ANSWERED')) onStale(e);
      else setError(ladderErrorText(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="kata-key" data-testid="kata-key">
      <h3 className="small">Your findings (stored {fmtWhen(keyResp.answeredAt)})</h3>
      <ul className="findings-stored">
        {keyResp.findings.map((f, i) => (
          <li key={i}>
            <strong>{f.scenario}</strong> · <code>{f.evidence}</code> · {f.consequence}
          </li>
        ))}
      </ul>
      {/* rv B (R3-04): the defect (evidenced in the patched lines) first, then its consequences / context */}
      {(['patched', 'repo'] as const).map((where) => {
        const group = keyResp.defects.filter((d) => (where === 'patched' ? d.evidence.in === 'patched' : d.evidence.in !== 'patched'));
        if (group.length === 0) return null;
        return (
          <Fragment key={where}>
      <h3 className="small" data-testid={`kata-group-${where}`}>
        {where === 'patched' ? 'The defect (in the patched lines)' : 'Consequences and context (elsewhere in the repo)'}
      </h3>
      {where === 'repo' && <p className="muted small">These still count toward this kata&apos;s catch rate; the G1 gate counts only the defects in the patched lines.</p>}
      <ul className="checklist">
        {group.map((d) => (
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
          </Fragment>
        );
      })}
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
