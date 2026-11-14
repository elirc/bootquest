import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api/context';
import type { KeyIdeaDto, KeyIdeaSectionDto, KeyIdeasResponse, KeyIdeaStatus } from '../api/types';
import { SectionRecap } from '../components/SectionRecap';
import { Chip, LoadState, PageHeader } from '../components/ui';
import { Prose } from '../lib/prose';
import { useAsync } from '../lib/useAsync';
import { TRACK_LABEL } from '../lib/view';

/**
 * rv2 S1 (PLAN §2.1 "Where it shows"): what the learner must own per section.
 *   KeyIdeasPage     /keyideas[?recap=<section>]: every section's fold, the open recaps, the session link
 *   KeyIdeaFold      one section: the idea sentences; the prompt / answer / why only once the idea's sources are
 *                    passed (the server omits them before that, so the fold cannot show them)
 *   KeyIdeasTile     the dashboard tile: owned / shaky / not yet met per track, open recaps, due cards
 *   KeyIdeasForUnit  the folds of the sections a unit belongs to (for the track browser / Fundamentals page)
 */

const STATUS_LABEL: Record<KeyIdeaStatus, string> = { owned: 'owned', shaky: 'shaky', 'not-met': 'not yet met' };
const STATUS_TONE: Record<KeyIdeaStatus, string> = { owned: 'success', shaky: 'accent', 'not-met': 'neutral' };
const trackLabel = (t: string): string => (TRACK_LABEL as Record<string, string>)[t] ?? t;

function IdeaRow({ idea }: { idea: KeyIdeaDto }) {
  return (
    <li className="keyidea" data-testid={`keyidea-${idea.id}`} data-status={idea.status}>
      <p>
        <Chip tone={STATUS_TONE[idea.status]}>{STATUS_LABEL[idea.status]}</Chip>{' '}
        {/* rv3 MF-4: the server withholds the idea sentence ('') until every source is passed */}
        {idea.idea !== '' ? idea.idea : <span className="muted">An idea you meet in its sources.</span>}
      </p>
      {idea.tags.length > 0 && (
        <p className="small muted">
          {idea.tags.map((t, i) => (
            <span key={t}>
              {i > 0 && ' '}
              <Link to={`/review?mode=keyideas&tag=${encodeURIComponent(t)}`}>#{t}</Link>
            </span>
          ))}
        </p>
      )}
      {idea.answer !== undefined ? (
        <details className="small">
          <summary>The question and the answer</summary>
          {idea.prompt && <Prose text={idea.prompt} />}
          <Prose text={idea.answer} />
          {idea.why && <p className="muted">Why it matters: {idea.why}</p>}
        </details>
      ) : (
        <p className="small muted" data-testid="keyidea-locked">
          {idea.idea === '' ? 'The idea and its answer open once you pass:' : 'The answer opens once you pass:'}{' '}
          {idea.sources
            .filter((s) => s.unitId !== null && !s.passed)
            .map((s, i) => (
              <span key={s.key}>
                {i > 0 && ' · '}
                <Link to={`/play/${s.unitId}`}>{s.title ?? s.key}</Link>
              </span>
            ))}
        </p>
      )}
    </li>
  );
}

export function KeyIdeaFold({ section, open = false }: { section: KeyIdeaSectionDto; open?: boolean }) {
  const owned = section.ideas.filter((i) => i.status === 'owned').length;
  return (
    <details className="panel keyidea-fold" open={open} data-testid={`keyidea-fold-${section.section}`}>
      <summary>
        <strong>Key ideas: {section.title}</strong>{' '}
        <span className="muted small">
          {owned}/{section.ideas.length} owned
          {section.recap.state === 'open' ? ' · recap open' : section.recap.state === 'done' ? ' · recap done' : ''}
        </span>
      </summary>
      <ul className="keyidea-list">
        {section.ideas.map((i) => (
          <IdeaRow key={i.id} idea={i} />
        ))}
      </ul>
      {section.recap.state === 'open' && (
        <p>
          <Link to={`/keyideas?recap=${encodeURIComponent(section.section)}`} className="btn btn-sm">
            Section recap
          </Link>
        </p>
      )}
      {section.recap.state === 'locked' && section.recap.total > 0 && (
        <p className="small muted" data-testid="keyidea-recap-locked">
          {section.recap.passed >= section.recap.needed
            ? // rv3 MF-1: the unit threshold is reached; the recap also needs 3 met ideas (or all of them)
              `The recap opens once ${Math.min(3, section.ideas.length)} of these ideas are met (every source of an idea passed).`
            : `The recap opens after ${section.recap.needed} of the ${section.recap.total} units (${section.recap.passed} passed).`}
        </p>
      )}
    </details>
  );
}

/** The folds of the sections a unit belongs to (renders nothing when it belongs to none, or the server has none). */
export function KeyIdeasForUnit({ unitKey }: { unitKey: string }) {
  const api = useApi();
  const q = useAsync(() => api.getKeyIdeas({ unit: unitKey }), [api, unitKey]);
  if (q.status !== 'ready' || q.data.sections.length === 0) return null;
  return (
    <>
      {q.data.sections.map((s) => (
        <KeyIdeaFold key={s.section} section={s} />
      ))}
    </>
  );
}

/** Dashboard: one tile. Hidden when no section is loaded (or the server predates key ideas). */
export function KeyIdeasTile() {
  const api = useApi();
  const q = useAsync(() => api.getKeyIdeas().catch((): KeyIdeasResponse | null => null), [api]);
  const d = q.status === 'ready' ? q.data : null;
  if (!d || d.tiles.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="p-keyideas" data-testid="keyideas-tile">
      <h2 className="panel-title" id="p-keyideas">
        Key ideas
      </h2>
      <table className="comp-table small">
        <thead>
          <tr>
            <th scope="col">Track</th>
            <th scope="col">Owned</th>
            <th scope="col">Shaky</th>
            <th scope="col">Not yet met</th>
          </tr>
        </thead>
        <tbody>
          {d.tiles.map((t) => (
            <tr key={t.track}>
              <th scope="row">{trackLabel(t.track)}</th>
              <td>{t.owned}</td>
              <td>{t.shaky}</td>
              <td>{t.notMet}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.recapsOpen.map((r) => (
        <p key={r.section} className="small" data-testid="keyideas-recap-open">
          <Link to={`/keyideas?recap=${encodeURIComponent(r.section)}`}>Section recap: {r.title}</Link>
        </p>
      ))}
      <p className="small">
        {d.dueCards > 0 ? <Link to="/review?mode=keyideas">Key ideas session ({d.dueCards} due)</Link> : <span className="muted">No key-idea card due.</span>}{' '}
        · <Link to="/keyideas">All key ideas</Link>
      </p>
    </section>
  );
}

export function KeyIdeasPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const recap = params.get('recap');
  const [nonce, setNonce] = useState(0);
  const q = useAsync(() => api.getKeyIdeas(), [api, nonce]);
  return (
    <>
      <PageHeader eyebrow="What to own" title="Key ideas" />
      {recap && (
        <SectionRecap
          section={recap}
          onDone={() => {
            setNonce((n) => n + 1);
          }}
        />
      )}
      {recap && (
        <p className="small">
          <button type="button" className="btn btn-sm" onClick={() => setParams({})}>
            Back to every section
          </button>
        </p>
      )}
      {q.status !== 'ready' ? (
        <LoadState error={q.error} onRetry={q.reload} />
      ) : q.data.sections.length === 0 ? (
        <p className="muted" data-testid="keyideas-empty">
          No key ideas are loaded on this server yet.
        </p>
      ) : (
        <>
          <p className="small">
            {q.data.dueCards > 0 ? <Link to="/review?mode=keyideas">Start the key ideas session ({q.data.dueCards} due)</Link> : 'No key-idea card is due right now.'}
          </p>
          {q.data.sections.map((s) => (
            <KeyIdeaFold key={s.section} section={s} open={s.section === recap} />
          ))}
        </>
      )}
    </>
  );
}

/** A pass's result panel: the recap of every section of this unit that just opened (nothing when none). */
export function SectionRecapLinks({ unitKey }: { unitKey: string }) {
  const api = useApi();
  const q = useAsync(() => api.getKeyIdeas({ unit: unitKey }).catch((): KeyIdeasResponse | null => null), [api, unitKey]);
  const open = q.status === 'ready' && q.data ? q.data.sections.filter((s) => s.recap.state === 'open') : [];
  if (open.length === 0) return null;
  return (
    <div className="verdict verdict-pass small" data-testid="section-recap-link">
      {open.map((s) => (
        <p key={s.section}>
          <Link to={`/keyideas?recap=${encodeURIComponent(s.section)}`}>Section recap: {s.title}</Link> (answer first, +20 XP once)
        </p>
      ))}
    </div>
  );
}
