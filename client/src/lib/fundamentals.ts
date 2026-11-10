// fund wave: the Fundamentals ladder's unit keys (server: shared/src/fundamentals.ts).
//   topic (lesson + quiz gate):  fund/<track>/<NN-topic>
//   drill:                       fund-<track>/<NN-topic>/<slug>

const TOPIC_RE = /^fund\/(js|csharp|java)\/([0-9]{2}-[a-z0-9-]+)$/;
const DRILL_RE = /^fund-(js|csharp|java)\/([0-9]{2}-[a-z0-9-]+)\//;

/** a Fundamentals topic unit (lesson + quiz gate) */
export const isFundTopicKey = (key: string): boolean => TOPIC_RE.test(key);
/** a Fundamentals drill unit */
export const isFundDrillKey = (key: string): boolean => DRILL_RE.test(key);
export const isFundKey = (key: string): boolean => isFundTopicKey(key) || isFundDrillKey(key);

/** '01-values-types-and-coercion' for either kind of Fundamentals key, else null */
export function fundTopicIdOf(key: string): string | null {
  return TOPIC_RE.exec(key)?.[2] ?? DRILL_RE.exec(key)?.[2] ?? null;
}

export const FUND_LEVEL_LABEL: Readonly<Record<'beginner' | 'intermediate' | 'advanced', string>> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

// ---------------------------------------------------------------- f52 wave B: ladder helpers
// Structural types, so every ladder DTO (with or without `related`) fits.

interface UnitLike {
  id: number;
  state: 'available' | 'locked' | 'done' | (string & {});
  revealed: boolean;
  difficulty: number | null;
}
interface TopicLike<U extends UnitLike = UnitLike> {
  id: string;
  unit: U;
  drills: readonly U[];
}

/**
 * A drill worth offering as a next step: open, not done, and not spoiled by a revealed solution.
 * THE one rule for "what drill is next" (dashboard hero and lib/nextstep.ts): a revealed, unpassed
 * drill is never a next step.
 */
export const drillOpen = (u: Pick<UnitLike, 'state' | 'revealed'>): boolean => u.state !== 'done' && u.state !== 'locked' && !u.revealed;

/** the topic's quiz gate is passed (this alone unlocks the next topic) */
export const gatePassed = (t: TopicLike): boolean => t.unit.state === 'done';

/**
 * App ruling 3: a topic is COMPLETE when its gate is passed and at least one of its own drills is
 * passed; a topic without a live drill is complete on the gate alone.
 */
export const topicComplete = (t: TopicLike): boolean => gatePassed(t) && (t.drills.length === 0 || t.drills.some((d) => d.state === 'done'));

export interface FundProgress {
  complete: number;
  gates: number;
  total: number;
}

export function fundProgress(topics: readonly TopicLike[]): FundProgress {
  return { complete: topics.filter(topicComplete).length, gates: topics.filter(gatePassed).length, total: topics.length };
}

/** "3 complete · 5 gates passed" */
export const fundProgressText = (p: Pick<FundProgress, 'complete' | 'gates'>): string =>
  `${p.complete} complete · ${p.gates} ${p.gates === 1 ? 'gate' : 'gates'} passed`;

/** Where a Fundamentals unit (topic or drill key) sits on its ladder, else null. */
export function fundPlace<T extends TopicLike>(ladder: { topics: readonly T[] }, key: string): { topic: T; index: number; total: number; next: T | null } | null {
  const topicId = fundTopicIdOf(key);
  if (topicId === null) return null;
  const index = ladder.topics.findIndex((t) => t.id === topicId);
  if (index === -1) return null;
  return { topic: ladder.topics[index]!, index, total: ladder.topics.length, next: ladder.topics[index + 1] ?? null };
}

/** App ruling 5, "More practice": undone first, then difficulty ascending (unrated last); otherwise the given order. */
export function orderRelated<U extends UnitLike>(related: readonly U[]): U[] {
  const rank = (u: U): number => (u.state === 'done' ? 1 : 0);
  const diff = (u: U): number => u.difficulty ?? Number.MAX_SAFE_INTEGER;
  return related
    .map((u, i) => ({ u, i }))
    .sort((a, b) => rank(a.u) - rank(b.u) || diff(a.u) - diff(b.u) || a.i - b.i)
    .map((x) => x.u);
}
