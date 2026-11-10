// U4 + U5: the context-aware next step after a pass.
//
// The dashboard's "Next up" (GET /dashboard nextUp) knows nothing about the Fundamentals ladder, so
// after a Fundamentals drill it used to send the learner to an unrelated campaign quiz. For a unit
// that lives on the ladder the next step comes from GET /tracks/:id/fundamentals instead:
//
//   1. this topic's quiz gate, while it is not passed;
//   2. this topic's next open drill (lib/fundamentals drillOpen, shared with the dashboard hero:
//      done, locked and revealed drills are never a next step);
//   3. the next topic that is open and not passed.
//
// Anything else (and a finished ladder) falls back to the dashboard's nextUp.
import type { FundamentalsResponse, FundTopicDto, TrackId, UnitSummary } from '../api/types';
import { drillOpen, fundTopicIdOf } from './fundamentals';

const FUND_TRACK_RE = /^fund(?:\/|-)(js|csharp|java)\//;

/** the ladder track of a Fundamentals unit key (topic or drill), else null */
export function fundTrackOf(key: string): TrackId | null {
  return (FUND_TRACK_RE.exec(key)?.[1] as TrackId | undefined) ?? null;
}

export type FundStepKind = 'gate' | 'drill' | 'topic';

export interface FundStep {
  kind: FundStepKind;
  /** the unit to open */
  unit: UnitSummary;
  /** the topic that unit belongs to */
  topic: FundTopicDto;
}

export interface FundNext {
  /** the one best next step, or null when the ladder offers nothing (fall back to nextUp) */
  primary: FundStep | null;
  /** the next open topic, when it is not already the primary step */
  nextTopic: FundStep | null;
}

const NONE: FundNext = { primary: null, nextTopic: null };

/** "02 · Functions & closures" style topic title, as the ladder shows it */
export const fundTopicLabel = (t: FundTopicDto): string => `${String(t.order).padStart(2, '0')} ${t.title}`;

/**
 * The next step on the ladder after `current` was just passed. `current` itself counts as done
 * whatever the ladder payload says (the caller may hold a response read before the pass landed).
 */
export function pickFundNext(ladder: FundamentalsResponse, current: { id: number; key: string }): FundNext {
  const topicId = fundTopicIdOf(current.key);
  if (topicId === null) return NONE;
  const at = ladder.topics.findIndex((t) => t.id === topicId);
  if (at === -1) return NONE;
  const topic = ladder.topics[at]!;
  const done = (u: UnitSummary) => u.id === current.id || u.state === 'done';

  // the next topic that can be opened: later topics first, then an earlier one left unfinished
  const order = [...ladder.topics.slice(at + 1), ...ladder.topics.slice(0, at)];
  const gatePassed = done(topic.unit);
  const nextOpen = order.find((t) => !done(t.unit) && (t.unit.state !== 'locked' || (gatePassed && t === ladder.topics[at + 1])));
  const nextTopic: FundStep | null = nextOpen ? { kind: 'topic', unit: nextOpen.unit, topic: nextOpen } : null;

  if (!gatePassed && topic.unit.state !== 'locked') return { primary: { kind: 'gate', unit: topic.unit, topic }, nextTopic };

  // drills after the current one first, then any earlier one still open
  const i = topic.drills.findIndex((d) => d.id === current.id);
  const drill = [...topic.drills.slice(i + 1), ...topic.drills.slice(0, Math.max(i, 0))].find((d) => d.id !== current.id && drillOpen(d));
  if (drill) return { primary: { kind: 'drill', unit: drill, topic }, nextTopic };
  return { primary: nextTopic, nextTopic: null };
}

/** The link text of a ladder step (the title is rendered separately so inline code keeps its font). */
export function fundStepLabel(step: FundStep): { lead: string; title: string } {
  if (step.kind === 'drill') return { lead: 'Practise', title: step.unit.title };
  if (step.kind === 'gate') return { lead: 'Quiz gate', title: fundTopicLabel(step.topic) };
  return { lead: 'Next topic', title: fundTopicLabel(step.topic) };
}
