// fund wave: the Campaign page's "Fundamentals" section — a standalone, repo-free ladder per language
// track (GET /api/tracks/:id/fundamentals). Each topic is one study unit (the lesson is its
// instructions, the quiz gate its check; a pass enrols the topic's flashcards and unlocks the next
// topic) plus its drills. Renders only the endpoint's public fields; a locked unit is never a link.
//
// f52 U10: a compact card by default (progress, the current topic with its start button, the next
// two topics, "Show all N"), so the campaign's first act stays on the first screen. The full list
// is one click away and the choice is remembered (localStorage; a blocked store just forgets).

import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import type { FundTopicDtoExt as FundTopicDto, TrackId, UnitSummary } from '../api/types';
import { Icon } from '../components/Icon';
import { MorePractice } from '../components/MorePractice';
import { Chip, LoadState, ProgressBar } from '../components/ui';
import { FUND_LEVEL_LABEL, fundProgress, fundProgressText, topicComplete } from '../lib/fundamentals';
import { useAsync } from '../lib/useAsync';
import { KeyIdeasForUnit } from './KeyIdeas';

export function FundamentalsSection({ trackId }: { trackId: TrackId }): JSX.Element | null {
  // keyed by track: switching tracks starts from a fresh fetch
  return <FundamentalsBody key={trackId} trackId={trackId} />;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "Show all" is remembered across visits and tracks. */
export const FUND_EXPANDED_KEY = 'bootquest:fund-expanded';

function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(FUND_EXPANDED_KEY) === '1';
  } catch {
    return false; // storage blocked: the compact card, nothing persisted
  }
}

function writeExpanded(v: boolean): void {
  try {
    window.localStorage.setItem(FUND_EXPANDED_KEY, v ? '1' : '0');
  } catch {
    /* not persisted; the in-memory choice still applies */
  }
}

/** The full rule, kept for the tooltip (f52 U18: the card itself says it in one line). */
const fundRule = (passPct: number): string =>
  `A standalone ladder for the language and its main framework, no repo needed. Each topic is a short lesson and a quiz gate (pass mark ${passPct}%); passing enrols the topic's flashcards into your reviews and unlocks the next topic. Drills practise it in code: a topic is complete once its gate and at least one of its drills are passed.`;

function FundamentalsBody({ trackId }: { trackId: TrackId }): JSX.Element | null {
  const api = useApi();
  const res = useAsync(() => api.getFundamentals(trackId), [api, trackId]);
  const headingId = useId();
  const listId = useId();
  const [all, setAll] = useState(readExpanded);
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
  // wave B (ruling 3): complete = gate + one own drill passed (the gate alone unlocks the next topic)
  const progress = fundProgress(topics);
  const done = progress.gates;
  const next = topics.find((t) => t.unit.state === 'available');
  // the compact card: the current topic (the first one not passed) and the two after it
  const at = topics.findIndex((t) => t.unit.state !== 'done');
  const preview = at === -1 ? [] : topics.slice(at, at + 3);
  const toggle = () => {
    const v = !all;
    writeExpanded(v);
    setAll(v);
  };
  return (
    <section className={`fund ${all ? 'fund-all' : 'fund-compact'}`} aria-labelledby={headingId} data-testid="fundamentals">
      <div className="fund-head">
        <h2 id={headingId}>Fundamentals</h2>
        <span className="muted small" data-testid="fund-progress">
          {fundProgressText(progress)} · {topics.length} topics
        </span>
        {next && (
          <Link className="btn btn-sm btn-primary" to={`/play/${next.unit.id}`} data-testid="fund-continue">
            <Icon name="play" /> {done === 0 ? 'Start' : 'Continue'}: {pad2(next.order)} {next.title}
          </Link>
        )}
      </div>
      <ProgressBar value={progress.complete} max={topics.length} label="Fundamentals topics complete" tone="success" />
      <p className="muted small fund-intro" title={fundRule(topics[0]!.passPct)}>
        A short lesson and a quiz gate per topic. Passing unlocks the next one; one passed drill completes the topic.
      </p>
      {!all && preview.length > 0 && (
        <ol className="fund-topics fund-preview" aria-label="Current and next topics" data-testid="fund-preview">
          {preview.map((t, i) => (
            <li key={t.id}>{i === 0 && t.unit.state !== 'locked' ? <TopicRow topic={t} /> : <TopicLine topic={t} />}</li>
          ))}
        </ol>
      )}
      <ol className="fund-topics" id={listId} hidden={!all} data-testid="fund-all">
        {all && topics.map((t) => <li key={t.id}>{t.unit.state === 'locked' ? <TopicLine topic={t} /> : <TopicRow topic={t} />}</li>)}
      </ol>
      <button type="button" className="link-btn fund-toggle small" aria-expanded={all} aria-controls={listId} onClick={toggle} data-testid="fund-toggle">
        {all ? 'Show less' : `Show all ${topics.length}`}
      </button>
      {/* rv2 S3 (PLAN §2.1 "where it shows"): the key-ideas fold of the section the current topic is in
          (the last topic once all are passed); closed by default, answers only once their sources pass */}
      <KeyIdeasForUnit unitKey={(topics[at] ?? topics[topics.length - 1]!).unit.key} />
    </section>
  );
}

function TopicTitle({ topic: t }: { topic: FundTopicDto }) {
  return (
    <>
      <span className="fund-order">{pad2(t.order)}</span>
      <span className="fund-title">{t.title}</span>
    </>
  );
}

/** One line: a locked topic (never a link, the unlock rule in its tooltip) or an upcoming one. */
function TopicLine({ topic: t }: { topic: FundTopicDto }) {
  const locked = t.unit.state === 'locked';
  return (
    <div className="fund-topic fund-line" data-state={t.unit.state} data-topic={t.id}>
      {locked ? (
        <span className="fund-link" aria-disabled="true" title="Unlocks when you pass the previous topic's quiz">
          <Icon name="lock" size={12} />
          <TopicTitle topic={t} />
          <span className="sr-only">, Locked</span>
        </span>
      ) : (
        <Link className="fund-link" to={`/play/${t.unit.id}`}>
          <TopicTitle topic={t} />
        </Link>
      )}
      <TopicChip topic={t} />
    </div>
  );
}

/** wave B (ruling 3): "complete" (gate + one own drill) or, with the gate alone, "gate passed". */
function TopicChip({ topic: t }: { topic: FundTopicDto }) {
  if (t.unit.state !== 'done') return null;
  return topicComplete(t) ? <Chip tone="success">complete</Chip> : <Chip tone="info">gate passed</Chip>;
}

function TopicRow({ topic: t }: { topic: FundTopicDto }) {
  return (
    <div className="fund-topic" data-state={t.unit.state} data-topic={t.id}>
      <div className="fund-topic-head">
        <Link className="fund-link" to={`/play/${t.unit.id}`}>
          <TopicTitle topic={t} />
        </Link>
        <span className="fund-chips">
          <Chip>{FUND_LEVEL_LABEL[t.level]}</Chip>
          <TopicChip topic={t} />
        </span>
      </div>
      <p className="muted small fund-summary">{t.summary}</p>
      <p className="small fund-meta">
        Lesson + quiz gate · {t.quizQuestions} questions · {t.flashcards} flashcards
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
      {/* wave B (ruling 5): existing drills of the track's other banks on this topic; closed by default */}
      <MorePractice related={t.related} as="details" />
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
