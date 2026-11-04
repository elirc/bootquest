// fund wave: the Campaign page's "Fundamentals" section — a standalone, repo-free ladder per language
// track (GET /api/tracks/:id/fundamentals). Each topic is one study unit (the lesson is its
// instructions, the quiz gate its check; a pass enrols the topic's flashcards and unlocks the next
// topic) plus its drills. Renders only the endpoint's public fields; a locked unit is never a link.

import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import type { FundTopicDto, TrackId, UnitSummary } from '../api/types';
import { Icon } from '../components/Icon';
import { Chip, LoadState } from '../components/ui';
import { FUND_LEVEL_LABEL } from '../lib/fundamentals';
import { useAsync } from '../lib/useAsync';

export function FundamentalsSection({ trackId }: { trackId: TrackId }): JSX.Element | null {
  // keyed by track: switching tracks starts from a fresh fetch
  return <FundamentalsBody key={trackId} trackId={trackId} />;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function FundamentalsBody({ trackId }: { trackId: TrackId }): JSX.Element | null {
  const api = useApi();
  const res = useAsync(() => api.getFundamentals(trackId), [api, trackId]);
  const headingId = useId();
  const listId = useId();
  const [open, setOpen] = useState(true);
  if (res.status === 'loading') return null;
  if (res.status === 'error') {
    return (
      <section className="fund" aria-labelledby={headingId} data-testid="fundamentals">
        <h2 id={headingId}>Fundamentals</h2>
        <LoadState error={res.error} onRetry={res.reload} minHeight={80} />
      </section>
    );
  }
  const topics = res.data.topics;
  if (topics.length === 0) return null;
  const done = topics.filter((t) => t.unit.state === 'done').length;
  const next = topics.find((t) => t.unit.state === 'available');
  return (
    <section className="fund" aria-labelledby={headingId} data-testid="fundamentals">
      <div className="fund-head">
        <h2 id={headingId}>
          <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
            Fundamentals
          </button>
        </h2>
        <span className="muted small" data-testid="fund-progress">
          {done}/{topics.length} topics passed
        </span>
        {next && (
          <Link className="btn btn-sm btn-primary" to={`/play/${next.unit.id}`} data-testid="fund-continue">
            <Icon name="play" /> {done === 0 ? 'Start' : 'Continue'}: {pad2(next.order)} {next.title}
          </Link>
        )}
      </div>
      <p className="muted small fund-intro">
        A standalone ladder for the language and its main framework, no repo needed. Each topic is a short lesson and a quiz gate (pass mark{' '}
        {topics[0]!.passPct}%); passing enrols the topic&apos;s flashcards into your reviews and unlocks the next topic. Drills practise it in code.
      </p>
      <ol className="fund-topics" id={listId} hidden={!open}>
        {topics.map((t) => (
          <li key={t.id}>
            <TopicRow topic={t} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function TopicRow({ topic: t }: { topic: FundTopicDto }) {
  const locked = t.unit.state === 'locked';
  const title = (
    <>
      <span className="fund-order">{pad2(t.order)}</span>
      <span className="fund-title">{t.title}</span>
    </>
  );
  return (
    <div className="fund-topic" data-state={t.unit.state} data-topic={t.id}>
      <div className="fund-topic-head">
        {locked ? (
          <span className="fund-link" aria-disabled="true">
            <Icon name="lock" size={12} />
            {title}
            <span className="sr-only">, Locked</span>
          </span>
        ) : (
          <Link className="fund-link" to={`/play/${t.unit.id}`}>
            {title}
          </Link>
        )}
        <span className="fund-chips">
          <Chip>{FUND_LEVEL_LABEL[t.level]}</Chip>
          {t.unit.state === 'done' && <Chip tone="success">passed</Chip>}
        </span>
      </div>
      <p className="muted small fund-summary">{t.summary}</p>
      <p className="small fund-meta">
        Lesson + quiz gate · {t.quizQuestions} questions · {t.flashcards} flashcards
        {locked && <span className="muted"> · unlocks when you pass the previous topic&apos;s quiz</span>}
      </p>
      {t.drills.length > 0 && (
        <ul className="fund-drills" aria-label={`${t.title} drills`}>
          {t.drills.map((d) => (
            <li key={d.id}>
              <DrillLink drill={d} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DrillLink({ drill: d }: { drill: UnitSummary }) {
  const body = (
    <>
      <Icon name="bolt" size={12} />
      <span>{d.title}</span>
      {d.state === 'done' && <Chip tone="success">done</Chip>}
    </>
  );
  if (d.state === 'locked') {
    return (
      <span className="fund-drill" aria-disabled="true" data-state="locked">
        {body}
        <span className="sr-only">, Locked</span>
      </span>
    );
  }
  return (
    <Link className="fund-drill" to={`/play/${d.id}`} data-state={d.state}>
      {body}
    </Link>
  );
}
