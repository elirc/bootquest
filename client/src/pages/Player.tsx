import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import {
  ApiError,
  isApiError,
  type CanonicalRunResult,
  type PublicCheck,
  type RatingChangeDto,
  type RunFailure,
  type RunVerdict,
  type SelfAttestResponse,
  type Submission,
  type SubmitResponse,
  type TrackId,
  type UnitDetail,
} from '../api/types';
import { Icon } from '../components/Icon';
import { Chip, Kbd, LoadState, PageHeader } from '../components/ui';
import { contentHash, storedGet, storedSet, useDirtyGuard, useDraft } from '../lib/draft';
import { hasModifier, isEditableTarget, isMod, useKeydown } from '../lib/keys';
import { enterActsOnFocus, shortcutBlocked } from '../lib/shortcuts';
import { useAsync } from '../lib/useAsync';
import { useTracksRefresh } from '../lib/tracks';
import { InlineProse, Prose, ProseBlocks, splitPrompt } from '../lib/prose';
import { TRACK_LABEL, campaignSourceOf, competencyLabel, languageOf, readingTitle, unitProse } from '../lib/view';
import { ExplainBackPane, KataPane } from './LadderPanes';
import { StudyQuestPane } from './StudyQuestPane';
import { LearnMoreButton } from '../components/LearnMore';
import { WrittenPane } from './WrittenPane';
import { CodeEditor } from './Player/Editor';
import { RevealPanel, promotionLeg, type Solution } from './Player/RevealFlow';

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
  // B4: a written unit's question lives in its answer pane (with the answer box under it)
  const isWritten = unit.kind === 'written';
  // W6 answer-first units: no reveal, and (explain-back) no code shown while answering
  // W8 study quests: no reveal either (missed keys arrive as review cards)
  const answerFirst = spec?.type === 'explain-back' || spec?.type === 'patch-kata' || spec?.type === 'study-quiz';
  // W9 (ui-audit #1): a locked campaign act serves no playable content at all
  if (detail.actGate?.locked) return <ActLocked detail={detail} />;
  // fix/client-review 6: a closed retest withholds its check and task, so the regular two-pane
  // player would contradict itself ("no browser check… completed outside the player" beside
  // "opens <date>"). One closed-retest view instead.
  if (detail.retestGate && !detail.retestGate.open) return <RetestClosedView detail={detail} gate={detail.retestGate} />;
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
            <LearnMoreButton unitId={unit.id} hotkey />
          </span>
        }
      />
      <div className="player">
        <section className="panel player-instructions" aria-labelledby="ins-title">
          <h2 className="panel-title" id="ins-title">
            Instructions
          </h2>
          {isWritten ? (
            <p className="muted" data-testid="written-ins">
              The question is in the answer pane. Write your answer first; the model answer and its rubric open only after your answer is stored.
            </p>
          ) : prose.instructions.trim() !== '' ? (
            <Prose text={prose.instructions} className="ins-prose" />
          ) : promptOnRight ? (
            <p className="muted">The question is in the answer pane.</p>
          ) : answerFirst && spec && (spec.type === 'study-quiz' ? detail.studyQuest : spec.type === 'patch-kata' ? detail.kata : detail.explainBack) ? (
            // W10: answer-first units carry their task in the work pane (cf. ui-audit #23)
            <p className="muted" data-testid="task-in-pane">
              {spec.type === 'study-quiz'
                ? 'The reading list and the quiz gate are in the study pane.'
                : spec.type === 'patch-kata'
                  ? 'The patch to review is in the review pane.'
                  : 'The questions are in the answer pane.'}
            </p>
          ) : isReading && (detail.refs ?? []).length === 0 ? (
            <ReadingEmpty unitId={unit.id} unitKey={unit.key} trackId={unit.trackId} />
          ) : (
            <p className="muted">No written instructions are served for this unit yet.</p>
          )}
          {detail.refs && detail.refs.length > 0 && <RefList refs={detail.refs} />}
          {detail.uncoveredLegs && detail.uncoveredLegs.length > 0 && <UncoveredLegs legs={detail.uncoveredLegs} />}
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
          {/* a closed retest never reaches here (RetestClosedView): the server refuses its reveal */}
          {check && !isReading && !answerFirst && (
            <RevealPanel
              unitId={unit.id}
              leg={promotionLeg(detail)}
              competencies={unit.competencies}
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
        ) : isWritten ? (
          <WrittenPane detail={detail} />
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
 * fix/client-review 6: a changed-example retest whose gate is closed. The server withholds its
 * check, task and starter (and refuses run / submit / reveal), so this is the whole page: why it
 * is closed, when it opens, and where to go meanwhile.
 */
function RetestClosedView({ detail, gate }: { detail: UnitDetail; gate: NonNullable<UnitDetail['retestGate']> }) {
  const { unit } = detail;
  const opens = gate.reason === 'not-due' && gate.opensAt !== null;
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
            <Chip>{opens ? 'not open yet' : 'not scheduled'}</Chip>
          </span>
        }
      />
      <section className="panel unit-locked" aria-labelledby="retest-closed-title" data-testid="retest-closed-view">
        <h2 className="unit-locked-title" id="retest-closed-title">
          <Icon name="lock" /> {opens ? 'This retest is not open yet' : 'This retest is not scheduled'}
        </h2>
        <RetestClosed gate={gate} />
        <p>
          {unit.variationOfUnitId !== null && (
            <>
              <Link to={`/play/${unit.variationOfUnitId}`}>Open the unit this is a changed example of</Link>
              {' · '}
            </>
          )}
          <Link to="/">Back to the dashboard</Link> (its Due now panel lists every scheduled retest)
        </p>
      </section>
    </>
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
      <section className="panel unit-locked" aria-labelledby="act-locked-title" data-testid="act-locked">
        <h2 className="unit-locked-title" id="act-locked-title">
          <Icon name="lock" /> This quest&apos;s campaign act is locked
        </h2>
        <p>
          Its reading list, questions and checks open together with the act. Clear the previous act&apos;s core quests and reach the act&apos;s level to
          unlock it; nothing on this unit can be read, run or submitted until then.
        </p>
        <p>
          <Link to={`/campaign/${unit.trackId}?unit=${unit.id}`} className="btn btn-primary">
            <Icon name="map" /> See the unlock rule on the campaign map
          </Link>
        </p>
      </section>
    </>
  );
}

/**
 * W10 (ui-audit #8): a reading unit that serves no prose and no material refs (a campaign quest
 * whose reading content has not been seeded). Say so honestly and point at what the unit's own
 * data names (its campaign quest and source repo); nothing is invented, so no GitHub link is
 * built for a repo whose owner the unit does not carry.
 */
function ReadingEmpty({ unitId, unitKey, trackId }: { unitId: number; unitKey: string; trackId: UnitDetail['unit']['trackId'] }) {
  const src = campaignSourceOf(unitKey);
  // W11: the map link targets THIS quest (Campaign's `?unit=` focus: scrolled to, focused, marked)
  return (
    <div className="reading-empty" data-testid="reading-empty">
      <p>No reading material is served for this unit yet: it has no written instructions and no linked guide.</p>
      {src ? (
        <p>
          It is a reading quest on the <Link to={`/campaign/${trackId}?unit=${unitId}`}>{TRACK_LABEL[trackId]} campaign map</Link>, sourced from the repo{' '}
          <code>{src.repo}</code>. Work through that repo directly, then mark the unit as read.
        </p>
      ) : (
        <p className="muted">
          The unit does not name its source. <Link to={`/campaign/${trackId}`}>Open the campaign map</Link>.
        </p>
      )}
    </div>
  );
}

/**
 * W10 (OPS uncovered_legs): program-unit acceptance legs the machine check deliberately does NOT
 * cover. A green result on this unit says nothing about them.
 */
function UncoveredLegs({ legs }: { legs: string[] }) {
  return (
    <div className="uncovered" role="note" aria-labelledby="uncovered-title" data-testid="uncovered-legs">
      <h3 className="uncovered-title" id="uncovered-title">
        <Icon name="warn" size={14} /> Not machine-checked
      </h3>
      <p className="small">A passing check on this unit does not cover {legs.length === 1 ? 'this acceptance leg' : `these ${legs.length} acceptance legs`}; verify {legs.length === 1 ? 'it' : 'them'} yourself:</p>
      <ul>
        {legs.map((l, i) => (
          <li key={i}>
            <InlineProse text={l} />
          </li>
        ))}
      </ul>
    </div>
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
              <InlineProse text={readingTitle(r.title, r.path)} />
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
      {' attempt recorded'}
    </span>
  );
}

/**
 * The ladder moments of a submit: competencies the server promoted (a passing artifact or
 * retest can complete a three-leg chain). Old → new notch, with the evidence on Stats.
 */
function Promotions({ promotions }: { promotions: RatingChangeDto[] }) {
  return (
    <div className="verdict verdict-pass promotions" role="status" data-testid="promotions">
      <Icon name="chart" />
      <strong>{promotions.length === 1 ? 'Competency promoted' : `${promotions.length} competencies promoted`}</strong>
      <ul className="promotion-list">
        {promotions.map((p) => (
          <li key={`${p.competency}-${p.evidenceId}`} data-testid={`promotion-${p.competency}`}>
            <span className="promotion-name">{competencyLabel(p.competency)}</span>{' '}
            <span className="promotion-notch" aria-label={`rating ${p.from} to ${p.to}`}>
              {p.from} → {p.to}
            </span>{' '}
            <Link to={`/stats?competency=${encodeURIComponent(p.competency)}#evidence-${p.evidenceId}`}>See the evidence on Stats</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * After a verified pass: the next open unit on the same track, from the same server-derived
 * "Next up" the dashboard shows (GET /dashboard nextUp; no extra endpoint). Read when the pass
 * lands, so it already reflects this unit being done.
 */
function NextUnit({ unitId, trackId }: { unitId: number; trackId: TrackId }) {
  const api = useApi();
  const q = useAsync(() => api.getDashboard(), [api]);
  if (q.status === 'loading') return null;
  const next = q.status === 'ready' ? (q.data.nextUp.find((n) => n.trackId === trackId)?.unit ?? null) : null;
  return (
    <p className="next-unit" data-testid="next-unit">
      {next && next.id !== unitId ? (
        <Link to={`/play/${next.id}`} className="btn btn-sm">
          Next unit: <InlineProse text={next.title} /> →
        </Link>
      ) : (
        <>
          <span className="muted">{q.status === 'error' ? 'Could not read what is next.' : 'Nothing else is open on this track right now.'}</span>{' '}
          <Link to={`/campaign/${trackId}`}>Open the campaign map</Link>
        </>
      )}
    </p>
  );
}

/** What follows a recorded submit under its verdict: promotions, then (on a pass) the next unit. */
function SubmitFollowUp({ submit, unit }: { submit: SubmitResponse; unit: UnitDetail['unit'] }) {
  const promotions = submit.promotions ?? [];
  return (
    <>
      {promotions.length > 0 && <Promotions promotions={promotions} />}
      {submit.verdict === 'pass' && <NextUnit unitId={unit.id} trackId={unit.trackId} />}
    </>
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

/** localStorage key (under bq:) of the last attempt this browser recorded on a unit. */
const lastAttemptKey = (unitId: number) => `last-attempt:v1:${unitId}`;
const readLastAttempt = (unitId: number): number | null => {
  const raw = storedGet(lastAttemptKey(unitId));
  return raw !== null && /^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : null;
};

/** The learner's own code from an attempt's stored submission ({ code } for code drills). */
const attemptCode = (answer: unknown): string | null =>
  typeof answer === 'object' && answer !== null && typeof (answer as { code?: unknown }).code === 'string' ? (answer as { code: string }).code : null;

function CodePane({ detail, spec }: { detail: UnitDetail; spec: PublicCheck }) {
  const api = useApi();
  const id = detail.unit.id;
  const starter = detail.starter ?? '';
  // Drafts are keyed by unit + content hash: a re-seed (new check row or starter) starts clean.
  const family = `code:${id}:`;
  const draft = useDraft(`${family}${contentHash(detail.check?.id, starter)}`, starter, { family });
  const code = draft.value;
  // the code that is safe without the draft: the starter, or what the last submit recorded
  const [savedCode, setSavedCode] = useState(starter);
  // the last attempt THIS browser recorded here: read on mount, then kept in step with every submit
  // (fix/client-review 5: the offer never names an older attempt than the one just recorded)
  const [lastAttempt, setLastAttempt] = useState(() => readLastAttempt(id));
  const [loadBusy, setLoadBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ code: string; note: string } | null>(null);
  const [assisted, setAssisted] = useState(false);
  const [busy, setBusy] = useState<null | 'run' | 'submit'>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const language = languageOf(spec) ?? 'code';
  const refreshTracks = useTracksRefresh();

  // Leaving only loses work when it exists nowhere else: storage refused the draft AND it differs
  // from what is already safe (the starter or the last recorded submit).
  useDirtyGuard(!draft.persisted && code !== savedCode);

  // once the learner replaced the editor content (reset / load), "restored" is old news
  const [replaced, setReplaced] = useState(false);
  // Defect 3 (restore race): GET /attempts/:id is async, so the learner can type while it is in
  // flight. editSeq counts every learner-originated change of the editor text (typing, reset,
  // undo, a held-code replace); a load that resolves after the count moved never replaces the
  // editor — it is HELD (`pending`) until the learner asks for it. codeRef is the live text, so
  // the Undo snapshot is what the editor shows at replace time, not a stale click-time closure.
  const editSeq = useRef(0);
  const codeRef = useRef(code);
  codeRef.current = code;
  // bumped by every recorded submit: a load started before it refers to an older attempt
  const loadGen = useRef(0);
  const [pending, setPending] = useState<{ code: string } | null>(null);
  const replaceCode = (next: string, note: string) => {
    editSeq.current++;
    setUndo({ code: codeRef.current, note });
    setReplaced(true);
    draft.setValue(next);
  };
  const edit = (v: string) => {
    editSeq.current++;
    setUndo(null); // typing after a reset / load: Undo would now also discard the new edits
    draft.setValue(v);
  };

  const loadLastSubmitted = async () => {
    if (lastAttempt === null || loadBusy) return;
    setLoadBusy(true);
    setLoadError(null);
    setPending(null);
    const seqAtStart = editSeq.current;
    const genAtStart = loadGen.current;
    try {
      const a = await api.getAttempt(lastAttempt);
      if (loadGen.current !== genAtStart) return; // a newer submit superseded this attempt
      const submitted = a.unitId === id ? attemptCode(a.answer) : null;
      if (submitted === null) setLoadError('Your last submitted attempt has no stored code for this unit.');
      else if (editSeq.current === seqAtStart) {
        // nothing changed the editor while the load was in flight: apply it, as before
        replaceCode(submitted, 'Loaded your last submitted code.');
        setSavedCode(submitted);
        setLoaded(true);
      } else setPending({ code: submitted }); // edits arrived meanwhile: keep them, offer the code
    } catch (e) {
      if (loadGen.current === genAtStart) setLoadError(errorText(e));
    } finally {
      setLoadBusy(false);
    }
  };

  const applyPending = () => {
    if (pending === null) return;
    replaceCode(pending.code, 'Loaded your last submitted code.');
    setSavedCode(pending.code);
    setLoaded(true);
    setPending(null);
  };

  const go = async (kind: 'run' | 'submit') => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'run') setOutcome({ kind, result: (await api.runUnit(id, { code })).result });
      else {
        const submit = await api.submitUnit(id, { code, selfAssisted: assisted });
        setOutcome({ kind, submit });
        storedSet(lastAttemptKey(id), String(submit.attempt.id));
        setLastAttempt(submit.attempt.id);
        setLoaded(false); // a new attempt to offer (an earlier "loaded" referred to an older one)
        loadGen.current++; // an in-flight load of the older attempt is now stale
        setPending(null); // a held load referred to the older attempt too
        setLoadError(null);
        setSavedCode(code); // recorded on the attempt now: nothing to lose
        if (submit.verdict === 'pass') draft.clear(); // verified pass: the draft is done
        refreshTracks(); // W10: a recorded submit can change the track's done count
      }
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
    if (!isMod(e) || e.key !== 'Enter' || shortcutBlocked(e)) return;
    e.preventDefault();
    void go(e.shiftKey ? 'submit' : 'run');
  });

  const showRestored = draft.restored && !replaced;
  const showBar =
    showRestored || draft.discardedStale || (lastAttempt !== null && !loaded) || pending !== null || undo !== null || loadError !== null || !draft.persisted;
  return (
    <section className="panel player-work" aria-label="Solution">
      <div className="editor-head">
        <span className="editor-lang">{language}</span>
        <span className="muted" id={`editor-help-${id}`}>
          <Kbd>Tab</Kbd> indents · <Kbd>Esc</Kbd> then <Kbd>Tab</Kbd> leaves the editor
        </span>
      </div>
      {showBar && (
        <div className="draft-bar" data-testid="draft-bar" aria-live="polite">
          {!draft.persisted && (
            <p className="draft-warn" data-testid="draft-unsaved">
              <Icon name="warn" size={14} /> This browser is not saving drafts (storage unavailable): your changes exist only in this tab until you submit.
            </p>
          )}
          {draft.discardedStale && (
            <p className="muted small" data-testid="draft-stale">
              A draft saved for an earlier version of this exercise was discarded: the exercise was re-seeded since.
            </p>
          )}
          {undo ? (
            <p className="small" data-testid="draft-undo">
              {undo.note}{' '}
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  editSeq.current++;
                  draft.setValue(undo.code);
                  setUndo(null);
                }}
              >
                Undo
              </button>
            </p>
          ) : (
            showRestored && (
              <p className="small" data-testid="draft-restored">
                Restored your unsubmitted draft from this browser.{' '}
                <button type="button" className="linkish" onClick={() => replaceCode(starter, 'Reset to the starter code.')}>
                  Reset to starter
                </button>
              </p>
            )
          )}
          {pending !== null ? (
            <p className="small" data-testid="load-held">
              Your last submitted code loaded while you were typing; your edits were kept.{' '}
              <button type="button" className="btn btn-sm" onClick={applyPending}>
                Replace with my last submitted code
              </button>
            </p>
          ) : (
            lastAttempt !== null &&
            !loaded && (
              <p className="small">
                <button type="button" className="btn btn-sm" onClick={() => void loadLastSubmitted()} disabled={loadBusy} data-attempt={lastAttempt}>
                  {loadBusy ? 'Loading…' : 'Load my last submitted code'}
                </button>
              </p>
            )
          )}
          {loadError && (
            <p className="error-text small" role="alert">
              {loadError}
            </p>
          )}
        </div>
      )}
      <CodeEditor value={code} onChange={edit} language={language} describedBy={`editor-help-${id}`} />
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
      <Results outcome={outcome} error={error} busy={busy !== null} unit={detail.unit} />
    </section>
  );
}

function Results({ outcome, error, busy, unit }: { outcome: Outcome | null; error: string | null; busy: boolean; unit: UnitDetail['unit'] }) {
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
          {outcome?.kind === 'submit' && <SubmitFollowUp submit={outcome.submit} unit={unit} />}
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
  const refreshTracks = useTracksRefresh();
  const send = async (s: Submission) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSubmit(await api.submitUnit(unitId, s));
      refreshTracks(); // W10: a recorded submit can change the track's done count
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
  const answerInput = useRef<HTMLInputElement>(null);
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
    if (passed || hasModifier(e) || shortcutBlocked(e)) return;
    if (e.key === 'Enter') {
      // an IME composition's Enter commits the composed text, never an answer (fix/client-review 7d)
      if (e.isComposing) return;
      // Enter on a focused button / link / checkbox is THAT control's Enter (Back to campaign,
      // Learn more, "I had help"): never a recorded attempt. In a text field only the answer
      // field itself submits.
      if (enterActsOnFocus(e.target)) return;
      if (isEditableTarget(e.target) && e.target !== answerInput.current) return;
      if (byChoice ? choice === null : text.trim() === '') return;
      e.preventDefault();
      void go();
      return;
    }
    if (!byChoice || isEditableTarget(e.target)) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
      e.preventDefault();
      setChoice(n - 1);
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
          <input ref={answerInput} type="text" value={text} onChange={(e) => setText(e.target.value)} disabled={passed} aria-label="Your answer" />
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
          idle={
            byChoice
              ? `Pick an answer with 1–${choices.length}, then Enter. Every check is a recorded attempt.`
              : 'Type your answer, then press Enter to check it. Every check is a recorded attempt.'
          }
        />
        {submit && !error && <SubmitFollowUp submit={submit} unit={detail.unit} />}
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
    if (!isMod(e) || !e.shiftKey || e.key !== 'Enter' || shortcutBlocked(e)) return;
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
        {submit && !error && <SubmitFollowUp submit={submit} unit={detail.unit} />}
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
  const refreshTracks = useTracksRefresh();

  const attest = async () => {
    if (state !== 'open') return;
    setState('busy');
    setError(null);
    try {
      setResult(await api.selfAttest(unitId));
      setState('attested');
      refreshTracks(); // W10: the unit is now done
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
