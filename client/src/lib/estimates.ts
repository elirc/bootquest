// f52 wave B (app ruling 6): STATIC time estimates, so a session has a visible shape. Nothing is
// measured: a topic (lesson + gate) is about 10 minutes, a drill 5 / 10 / 15 by difficulty, a review
// card about 10 seconds.

export const TOPIC_MINUTES = 10;
export const REVIEW_SECONDS = 10;

/** difficulty 1 -> 5, 2 -> 10, 3 and up -> 15; an unrated drill counts as the middle */
export function drillMinutes(difficulty: number | null | undefined): number {
  if (difficulty === null || difficulty === undefined) return 10;
  return difficulty <= 1 ? 5 : difficulty === 2 ? 10 : 15;
}

export const fmtMinutes = (min: number): string => `≈${min} min`;

/** "≈30 s" under a minute, else whole minutes rounded up */
export function fmtSeconds(seconds: number): string {
  return seconds < 60 ? `≈${seconds} s` : fmtMinutes(Math.ceil(seconds / 60));
}

/** N review cards */
export const reviewEstimate = (cards: number): string => fmtSeconds(cards * REVIEW_SECONDS);
