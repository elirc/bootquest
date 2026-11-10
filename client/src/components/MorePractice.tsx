// f52 wave B (app ruling 5): "More practice" — existing drills of the track's other banks that
// practise a Fundamentals topic (`related[]` of GET /tracks/:id/fundamentals). Undone first, then
// easiest first; three are shown, the rest behind "Show all N". On the Campaign list it is a closed
// <details> per topic row; after a pass (NextStep) it is an open block.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { UnitSummary } from '../api/types';
import { drillMinutes, fmtMinutes } from '../lib/estimates';
import { orderRelated } from '../lib/fundamentals';
import { InlineProse } from '../lib/prose';
import { Chip } from './ui';

export const MORE_PRACTICE_SHOWN = 3;

export const morePracticeLabel = (related: readonly UnitSummary[]): string =>
  `More practice · ${related.filter((u) => u.state === 'done').length}/${related.length} done`;

function RelatedList({ related }: { related: readonly UnitSummary[] }) {
  const [all, setAll] = useState(false);
  const ordered = orderRelated(related);
  const shown = all ? ordered : ordered.slice(0, MORE_PRACTICE_SHOWN);
  return (
    <>
      <ul className="more-practice-list">
        {shown.map((u) => (
          <li key={u.id} data-state={u.state} data-unit={u.id}>
            {u.state === 'locked' ? (
              <span className="more-practice-item" aria-disabled="true">
                <InlineProse text={u.title} />
                <span className="sr-only">, Locked</span>
              </span>
            ) : (
              <Link className="more-practice-item" to={`/play/${u.id}`}>
                <InlineProse text={u.title} />
              </Link>
            )}
            {u.state === 'done' ? <Chip tone="success">done</Chip> : <span className="muted small">{fmtMinutes(drillMinutes(u.difficulty))}</span>}
          </li>
        ))}
      </ul>
      {!all && ordered.length > MORE_PRACTICE_SHOWN && (
        <button type="button" className="link-btn small" onClick={() => setAll(true)} data-testid="more-practice-all">
          Show all {ordered.length}
        </button>
      )}
    </>
  );
}

export function MorePractice({ related, as }: { related: readonly UnitSummary[] | undefined; as: 'details' | 'block' }) {
  if (!related || related.length === 0) return null;
  const label = morePracticeLabel(related);
  if (as === 'details') {
    return (
      <details className="more-practice" data-testid="more-practice">
        <summary>{label}</summary>
        <RelatedList related={related} />
      </details>
    );
  }
  return (
    <div className="more-practice more-practice-block" data-testid="more-practice">
      <p className="more-practice-title">{label}</p>
      <RelatedList related={related} />
    </div>
  );
}
