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
