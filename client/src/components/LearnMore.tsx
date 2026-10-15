import { Fragment, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import { isApiError, type NoteDto, type RefContentResponse, type UnitNotesResponse } from '../api/types';
import { hasModifier, isEditableTarget, useKeydown } from '../lib/keys';
import { proseChunks, renderInline } from '../lib/prose';
import { Icon } from './Icon';
import { Kbd } from './ui';

/**
 * "Learn more" (owner ask 2026-10-15): a button that opens a side drawer with the unit's
 * READINGS (seed:notes 'before' notes: safe before answering), its EXPLANATIONS (released by the
 * server only after the learner's recorded answer covers them; until then the drawer says so and
 * shows a count, never a title) and its material refs (opened in the in-drawer refs viewer when
 * the ref is registered markdown). Everything shown comes from GET /api/units/:id/notes, which
 * writes nothing: opening the drawer can never record, pay or reveal anything.
 *
 * Keyboard: `i` opens it (one hotkey owner per page), Esc closes, Tab is trapped inside, focus
 * returns to the opener.
 */

// ---------------------------------------------------------------- markdown (notes bodies)

/** *italic* inside the plain-text segments renderInline leaves (code spans stay untouched). */
function withItalics(nodes: ReactNode[]): ReactNode[] {
  return nodes.flatMap((n, i) => {
    if (typeof n !== 'string') return [n];
    const out: ReactNode[] = [];
    const re = /\*(?=\S)([^*\n]*?\S)\*(?!\*)/g;
    let last = 0;
    for (let m = re.exec(n); m; m = re.exec(n)) {
      if (m.index > last) out.push(n.slice(last, m.index));
      out.push(<em key={`${i}-${m.index}`}>{m[1]}</em>);
      last = re.lastIndex;
    }
    if (last < n.length) out.push(n.slice(last));
    return out;
  });
}

const inline = (text: string): ReactNode => <>{withItalics(renderInline(text))}</>;

const BULLET = /^\s*[-*+]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

/** The small markdown subset notes use: paragraphs, - / 1. lists, ``` fences, # headings, > quotes. */
export function NoteMarkdown({ text }: { text: string }) {
  const blocks = proseChunks(text);
  return (
    <div className="prose note-md">
      {blocks.map((chunk, i) => {
        const lines = chunk.split('\n');
        const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[0] ?? '');
        if (fence) {
          const body = lines.slice(1);
          if (body.length && body[body.length - 1]!.trim().startsWith(fence[1]!.slice(0, 3))) body.pop();
          return (
            <pre key={i} className="code-block" data-lang={fence[2]!.trim() || undefined}>
              {body.join('\n')}
            </pre>
          );
        }
        const h = /^(#{1,6})\s+(.*)$/.exec(lines[0] ?? '');
        if (h && lines.length === 1) return <h4 key={i}>{inline(h[2]!)}</h4>;
        if (lines.every((l) => BULLET.test(l) || /^\s{2,}\S/.test(l)) && BULLET.test(lines[0]!)) return <ListBlock key={i} lines={lines} re={BULLET} ordered={false} />;
        if (lines.every((l) => NUMBERED.test(l) || /^\s{2,}\S/.test(l)) && NUMBERED.test(lines[0]!)) return <ListBlock key={i} lines={lines} re={NUMBERED} ordered />;
        if (lines.every((l) => /^\s*>/.test(l))) return <blockquote key={i}>{inline(lines.map((l) => l.replace(/^\s*>\s?/, '')).join(' '))}</blockquote>;
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {inline(l)}
                {j < lines.length - 1 ? ' ' : null}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function ListBlock({ lines, re, ordered }: { lines: string[]; re: RegExp; ordered: boolean }) {
  // continuation lines (indented) join the item above them
  const items: string[] = [];
  for (const l of lines) {
    if (re.test(l)) items.push(l.replace(re, ''));
    else items[items.length - 1] = `${items[items.length - 1] ?? ''} ${l.trim()}`;
  }
  const kids = items.map((t, k) => <li key={k}>{inline(t)}</li>);
  return ordered ? <ol>{kids}</ol> : <ul>{kids}</ul>;
}

// ---------------------------------------------------------------- the drawer

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

type View = { kind: 'notes' } | { kind: 'ref'; refId: number; title: string };

export interface LearnMoreProps {
  unitId: number;
  /** focus the drawer on one quest item (a quiz, flashcard or reading step) */
  target?: string;
  /** what the drawer is about, for its heading (e.g. "Q3" or the card) */
  subject?: string;
  onClose: () => void;
}

export function LearnMoreDrawer({ unitId, target, subject, onClose }: LearnMoreProps) {
  const api = useApi();
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const [data, setData] = useState<UnitNotesResponse | null>(null);
  const [error, setError] = useState<{ text: string; locked: boolean } | null>(null);
  const [view, setView] = useState<View>({ kind: 'notes' });
  const [showAll, setShowAll] = useState(target === undefined);

  useEffect(() => {
    let live = true;
    api.getUnitNotes(unitId).then(
      (d) => live && setData(d),
      (e: unknown) => live && setError({ text: errorText(e), locked: isApiError(e, 'ACT_LOCKED') || isApiError(e, 'TRACK_LOCKED') }),
    );
    return () => {
      live = false;
    };
  }, [api, unitId]);

  useEffect(() => {
    opener.current = document.activeElement;
    ref.current?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    // the drawer owns the keyboard while open: page shortcuts (quiz 1-4, review grades, g-chords) never fire behind it
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (view.kind === 'ref') setView({ kind: 'notes' });
      else onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const nodes = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.hasAttribute('disabled'));
    if (nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const openRef = useCallback((refId: number, title: string) => setView({ kind: 'ref', refId, title }), []);

  return (
    <div className="overlay overlay-drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref} onKeyDown={onKeyDown} data-testid="learn-more">
        <header className="dialog-head drawer-head">
          <h2 id={titleId}>
            <Icon name="info" /> Learn more{subject ? <span className="muted"> · {subject}</span> : null}
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close <Kbd>Esc</Kbd>
          </button>
        </header>
        {view.kind === 'ref' ? (
          <RefViewer refId={view.refId} title={view.title} onBack={() => setView({ kind: 'notes' })} />
        ) : error ? (
          <p className={error.locked ? 'verdict verdict-todo' : 'error-text'} role="alert" data-testid="learn-more-error">
            {error.locked ? 'This unit is locked: its readings and explanations open with it.' : error.text}
          </p>
        ) : !data ? (
          <p className="muted" role="status">
            Loading notes…
          </p>
        ) : (
          <NotesBody data={data} target={target} showAll={showAll} onShowAll={() => setShowAll(true)} openRef={openRef} />
        )}
      </div>
    </div>
  );
}

function NotesBody({
  data,
  target,
  showAll,
  onShowAll,
  openRef,
}: {
  data: UnitNotesResponse;
  target: string | undefined;
  showAll: boolean;
  onShowAll: () => void;
  openRef: (refId: number, title: string) => void;
}) {
  const focus = (n: NoteDto) => showAll || target === undefined || n.target === target;
  const readings = data.readings.filter(focus);
  const released = data.explanations.released.filter(focus);
  const ex = data.explanations;
  const hidden = !showAll && target !== undefined && (readings.length < data.readings.length || released.length < ex.released.length);
  return (
    <div className="drawer-body">
      <section aria-label="Readings" className="drawer-section">
        <h3 className="kb-scope">Readings</h3>
        {readings.length === 0 ? (
          <p className="muted small">{data.readings.length === 0 ? 'No readings for this unit yet.' : 'No reading is about this item; show all notes below.'}</p>
        ) : (
          readings.map((n) => <NoteCard key={n.key} note={n} openRef={openRef} />)
        )}
      </section>

      <section aria-label="Explanations" className="drawer-section">
        <h3 className="kb-scope">Explanations</h3>
        {ex.state === 'none' ? (
          <p className="muted small">{ex.message}</p>
        ) : ex.state === 'locked' || ex.state === 'partial' ? (
          <div className="verdict verdict-todo" data-testid="explanations-locked">
            <Icon name="lock" />
            <span>
              {/unlock after you answer/.test(ex.message) ? <strong>Explanations unlock after you answer. </strong> : null}
              {ex.message}
              {ex.withheld > 0 ? ` (${ex.withheld} waiting${ex.nextAt !== null ? `, next ${new Date(ex.nextAt).toLocaleString()}` : ''})` : ''}
            </span>
          </div>
        ) : null}
        {released.map((n) => (
          <NoteCard key={n.key} note={n} openRef={openRef} />
        ))}
        {data.explanation && (
          <article className="note" data-testid="unit-explanation">
            <h4 className="note-title">Explanation</h4>
            <NoteMarkdown text={data.explanation} />
          </article>
        )}
        {data.solution && (
          <article className="note" data-testid="unit-solution">
            <h4 className="note-title">Revealed solution</h4>
            <pre className="code-block">
              {data.solution.kind === 'code' ? data.solution.code : data.solution.kind === 'output' ? data.solution.expected : String(data.solution.choice ?? data.solution.answer)}
            </pre>
          </article>
        )}
      </section>

      {hidden && (
        <button type="button" className="btn btn-sm" onClick={onShowAll}>
          Show all notes for this unit
        </button>
      )}

      {data.refs.length > 0 && (
        <section aria-label="Material" className="drawer-section">
          <h3 className="kb-scope">Material</h3>
          <ul className="note-links">
            {data.refs.map((r) => (
              <li key={`${r.role}-${r.id}`}>
                {r.contentUrl ? (
                  <button type="button" className="link-btn" onClick={() => openRef(r.id, r.title)}>
                    {r.title}
                  </button>
                ) : (
                  <a href={`https://github.com/${r.repo}/blob/${r.sha}/${r.path}`} target="_blank" rel="noopener noreferrer">
                    {r.title}
                  </a>
                )}{' '}
                <span className="muted small">
                  {r.repo}@{r.sha.slice(0, 7)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.source && (
        <p className="muted small">
          Source: {data.source.repo} @ <code>{data.source.sha.slice(0, 7)}</code> (quotes are verbatim at this commit)
        </p>
      )}
    </div>
  );
}

const lines = (a: number | null, b: number | null) => (a === null ? '' : a === b || b === null ? `:${a}` : `:${a}-${b}`);

function NoteCard({ note, openRef }: { note: NoteDto; openRef: (refId: number, title: string) => void }) {
  return (
    <article className="note" data-testid={`note-${note.id}`}>
      <h4 className="note-title">{note.title}</h4>
      <NoteMarkdown text={note.body} />
      {note.excerpts.map((e, i) => (
        <figure key={i} className="note-excerpt">
          <blockquote>
            <pre>{e.quote}</pre>
          </blockquote>
          <figcaption>
            {e.refId !== null ? (
              <button type="button" className="link-btn" onClick={() => openRef(e.refId!, e.path)}>
                <code>
                  {e.path}
                  {lines(e.lineStart, e.lineEnd)}
                </code>
              </button>
            ) : (
              <a href={e.url} target="_blank" rel="noopener noreferrer">
                <code>
                  {e.path}
                  {lines(e.lineStart, e.lineEnd)}
                </code>
              </a>
            )}
          </figcaption>
        </figure>
      ))}
      {note.readMore.length > 0 && (
        <div className="note-readmore">
          <span className="muted small">Read more</span>
          <ul className="note-links">
            {note.readMore.map((r, i) => (
              <li key={i}>
                {r.refId !== null ? (
                  <button type="button" className="link-btn" onClick={() => openRef(r.refId!, r.path)}>
                    <code>
                      {r.path}
                      {lines(r.lineStart, r.lineEnd)}
                    </code>
                  </button>
                ) : (
                  <a href={r.url} target="_blank" rel="noopener noreferrer">
                    <code>
                      {r.path}
                      {lines(r.lineStart, r.lineEnd)}
                    </code>
                  </a>
                )}{' '}
                <span className="muted small">{r.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/** The refs viewer: one registered markdown ref (GET /api/refs/:id/content), inside the drawer. */
function RefViewer({ refId, title, onBack }: { refId: number; title: string; onBack: () => void }) {
  const api = useApi();
  const [doc, setDoc] = useState<RefContentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.getRefContent(refId).then(
      (d) => live && setDoc(d),
      (e: unknown) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [api, refId]);
  return (
    <div className="drawer-body" data-testid="ref-viewer">
      <button type="button" className="btn btn-sm" onClick={onBack}>
        ← Back to notes
      </button>
      <h3 className="note-title">{title}</h3>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : !doc ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <p className="muted small">
            {doc.ref.repo}@{doc.ref.sha.slice(0, 7)} {doc.ref.path} · served from {doc.servedFrom}
          </p>
          <NoteMarkdown text={doc.markdown} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the button

export function LearnMoreButton({
  unitId,
  target,
  subject,
  hotkey = false,
  compact = false,
  label = 'Learn more',
}: {
  unitId: number;
  target?: string;
  subject?: string;
  /** bind the `i` shortcut (exactly one button per page should) */
  hotkey?: boolean;
  compact?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  useKeydown(
    (e) => {
      if (open || e.key !== 'i' || hasModifier(e) || isEditableTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return; // another dialog owns the keyboard
      e.preventDefault();
      setOpen(true);
    },
    hotkey,
  );
  return (
    <>
      <button
        type="button"
        className={`btn ${compact ? 'btn-ghost btn-sm' : 'btn-sm'} learn-more-btn`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={subject ? `${label}: ${subject}` : label}
      >
        <Icon name="info" /> {label}
        {hotkey && <Kbd>i</Kbd>}
      </button>
      {open && <LearnMoreDrawer unitId={unitId} target={target} subject={subject} onClose={() => setOpen(false)} />}
    </>
  );
}
