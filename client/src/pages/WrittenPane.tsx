// B4: the written-unit player. CONTRACT (F9, server-enforced): the learner's answer is stored
// IMMUTABLY first (POST /units/:id/answer, ungraded, no XP); only then is the model answer read
// (GET /units/:id/model-answer is 403 NOT_ANSWERED until that row exists). The rubric is a
// self-check the learner reads against the model answer: display-only, NOT scored, NOT evidence,
// no XP. Its ticks are a per-browser convenience (localStorage), never sent anywhere.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import { isApiError, type ModelAnswerResponse, type UnitDetail } from '../api/types';
import { Icon } from '../components/Icon';
import { Chip } from '../components/ui';
import { fmtWhen } from '../lib/format';
import { InlineProse, Prose } from '../lib/prose';



// ---------------------------------------------------------------- per-browser storage (best effort)

export const draftKey = (unitId: number) => `bq:written-draft:${unitId}`;
export const marksKey = (unitId: number, attemptId: number) => `bq:written-marks:${unitId}:${attemptId}`;

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private window / blocked storage: the page works without it
  }
}
function writeStore(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore: the draft is a convenience, never the record
  }
}
function readMarks(key: string): Record<string, boolean> {
  const raw = readStore(key);
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, b]) => b === true)) as Record<string, boolean>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- the pane

export function WrittenPane({ detail }: { detail: UnitDetail }) {
  const api = useApi();
  const id = detail.unit.id;
  const question = (detail.instructions ?? '').trim();
  // `written.answered` (B4) lets an unanswered unit skip the model-answer request entirely;
  // an older server without the flag is probed once (403 NOT_ANSWERED = still answering).
  const answeredFlag = detail.written?.answered;
  const [model, setModel] = useState<ModelAnswerResponse | null>(null);
  const [checked, setChecked] = useState(answeredFlag === false);
  const [text, setText] = useState(() => readStore(draftKey(id)) ?? detail.starter ?? '');
  const [assisted, setAssisted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** the answer row exists but the model answer could not be loaded (e.g. 404 NO_SOLUTION) */
  const [storedId, setStoredId] = useState<number | null>(null);
  /** the model answer view was opened by this session's store (move focus to it) */
  const [justStored, setJustStored] = useState(false);

  useEffect(() => {
    if (answeredFlag === false) return;
    let live = true;
    api
      .getModelAnswer(id)
      .then((m) => live && setModel(m))
      .catch((e) => {
        if (live && !isApiError(e, 'NOT_ANSWERED')) setError(errorText(e));
      })
      .finally(() => live && setChecked(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (v: string) => {
    setText(v);
    // an unsent draft survives a reload; the untouched starter is not a draft
    writeStore(draftKey(id), v === (detail.starter ?? '') ? null : v);
  };

  const store = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const rec = await api.answerWritten(id, { answer: text, selfAssisted: assisted });
      setStoredId(rec.attemptId);
      writeStore(draftKey(id), null); // the server holds the answer now
      setConfirming(false);
      setJustStored(true);
      setModel(await api.getModelAnswer(id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (model) return <ModelAnswerView unitId={id} trackId={detail.unit.trackId} question={question} model={model} focusOnMount={justStored} />;
  // W11: the answer is stored immutably, so the untouched starter template is not an answer
  const untouched = text.trim() === (detail.starter ?? '').trim();
  const ready = text.trim() !== '' && !untouched && storedId === null;

  return (
    <section className="panel player-work written" aria-labelledby="written-q">
      <h2 className="panel-title" id="written-q">
        Question
      </h2>
      {question ? <Prose text={question} className="written-question" /> : <p className="muted">No question text is served for this unit yet.</p>}
      <p className="code-hidden-note" data-testid="answer-first-note">
        <Icon name="lock" size={14} /> Answer first. Your answer is stored, unchangeable, before the model answer and the rubric are shown. Written answers are
        not graded and earn no XP.
      </p>
      {!checked && <p className="muted small">Checking for an earlier answer…</p>}
      <label className="written-field">
        <span className="small muted">Your answer</span>
        <textarea
          className="eb-answer written-answer"
          rows={10}
          value={text}
          onChange={(e) => edit(e.target.value)}
          aria-label="Your answer"
          disabled={busy || storedId !== null}
        />
      </label>
      <p className="muted small" data-testid="draft-note">
        Unsent drafts are kept in this browser only.
        {untouched && text.trim() !== '' && storedId === null && <> Fill in the template before submitting: an untouched template cannot be stored.</>}
      </p>
      <div className="toolbar">
        <label className="check">
          <input type="checkbox" checked={assisted} disabled={busy} onChange={(e) => setAssisted(e.target.checked)} />I had help
        </label>
        <span className="toolbar-spacer" />
        <button type="button" className="btn btn-primary" disabled={!ready || busy || !checked} onClick={() => setConfirming(true)}>
          <Icon name="check" /> Submit answer
        </button>
      </div>
      {confirming && (
        <div
          className="confirm"
          role="alertdialog"
          onKeyDown={(e) => e.key === 'Escape' && !busy && setConfirming(false)}
          aria-labelledby="written-confirm-title"
          aria-describedby="written-confirm-desc"
        >
          <h3 id="written-confirm-title">Store your answer?</h3>
          <p id="written-confirm-desc">
            Your answer is stored <strong>immutably</strong> and cannot be edited afterwards. The model answer and the rubric appear only after this.
          </p>
          <div className="toolbar">
            <button type="button" className="btn" autoFocus onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void store()} disabled={busy}>
              Store answer and show the model answer
            </button>
          </div>
        </div>
      )}
      {storedId !== null && (
        <p className="muted small" data-testid="stored-note">
          Answer <code>#{storedId}</code> is stored.
        </p>
      )}
      {error && (
        <div className="verdict verdict-error" role="alert">
          <Icon name="warn" /> {error}
        </div>
      )}
    </section>
  );
}

function ModelAnswerView({
  unitId,
  trackId,
  question,
  model,
  focusOnMount = false,
}: {
  unitId: number;
  trackId: string;
  question: string;
  model: ModelAnswerResponse;
  focusOnMount?: boolean;
}) {
  const key = marksKey(unitId, model.attemptId);
  // W11: the Store button unmounts with the answer form; keep keyboard focus on the new view
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) titleRef.current?.focus();
  }, [focusOnMount]);
  const [marks, setMarks] = useState<Record<string, boolean>>(() => readMarks(key));
  const toggle = (rid: string, on: boolean) => {
    setMarks((prev) => {
      const next = { ...prev };
      if (on) next[rid] = true;
      else delete next[rid];
      writeStore(key, Object.keys(next).length ? JSON.stringify(next) : null);
      return next;
    });
  };

  return (
    <section className="panel player-work written" aria-labelledby="written-key-title">
      <h2 className="panel-title" id="written-key-title" tabIndex={-1} ref={titleRef}>
        Compare with the model answer
      </h2>
      <p className="muted small" data-testid="stored-meta">
        Answer <code>#{model.attemptId}</code> stored {fmtWhen(model.answeredAt)} (immutable).{' '}
        <span data-testid="no-xp">
          <Chip>not graded · no XP</Chip>
        </span>
      </p>
      {question && (
        <details className="written-recall">
          <summary>Question</summary>
          <Prose text={question} />
        </details>
      )}
      <div className="eb-split written-split">
        <div className="eb-mine">
          <h3 className="small muted written-h">Your answer</h3>
          <p className="eb-stored" data-testid="stored-answer">
            {model.answer}
          </p>
        </div>
        <div className="written-model" data-testid="model-answer">
          <h3 className="small muted written-h">Model answer</h3>
          <Prose text={model.modelAnswer} />
        </div>
      </div>
      {model.rubric.length > 0 && (
        <div className="written-rubric">
          <h3 className="small written-h" id="rubric-title">
            Rubric self-check
          </h3>
          <p className="muted small" data-testid="rubric-note">
            Tick what your stored answer covered. These ticks stay in this browser: they are not recorded, not scored and earn no XP.
          </p>
          <ul className="checklist" aria-labelledby="rubric-title">
            {model.rubric.map((r) => (
              <li key={r.id} className={`checklist-item${marks[r.id] ? ' is-covered' : ''}`}>
                <label className="check written-rubric-item">
                  <input type="checkbox" checked={marks[r.id] === true} onChange={(e) => toggle(r.id, e.target.checked)} aria-label={`Rubric: ${r.label}`} />
                  <span className="checklist-text">
                    <InlineProse text={r.label} />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link to={`/campaign/${trackId}`} className="muted small">
        Back to campaign
      </Link>
    </section>
  );
}
