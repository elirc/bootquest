/**
 * Level curve (spec §6.1: 150·n^1.6).
 *
 * DEFINITION (direct formula, NOT a sum): everyone starts at level 1 with 0 XP.
 * The CUMULATIVE XP (from 0) required to REACH level n+1 is
 *
 *     xpToReach(n + 1) = floor(150 · n^1.6)        for n >= 1
 *     xpToReach(1)     = 0
 *
 * So: level 2 at 150 XP, level 3 at floor(150·2^1.6) = 454, level 6 at
 * floor(150·5^1.6) = 1969. The per-level cost grows (150, 304, ...), so the
 * curve is strictly increasing. Floor keeps thresholds integral.
 */
export const LEVEL_BASE = 150;
export const LEVEL_EXPONENT = 1.6;

/** Cumulative XP needed to reach `level` (level >= 1). */
export function xpToReach(level: number): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError('level must be an integer >= 1');
  if (level === 1) return 0;
  const n = level - 1;
  return Math.floor(LEVEL_BASE * Math.pow(n, LEVEL_EXPONENT));
}

/** Level for a cumulative XP total. */
export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp < 0) throw new RangeError('xp must be a non-negative number');
  let level = 1;
  while (xp >= xpToReach(level + 1)) level++;
  return level;
}

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP earned since reaching the current level */
  intoLevel: number;
  /** XP span of the current level (current -> next) */
  levelSpan: number;
  /** cumulative XP at which the next level is reached */
  nextAt: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const base = xpToReach(level);
  const nextAt = xpToReach(level + 1);
  return { level, xp, intoLevel: xp - base, levelSpan: nextAt - base, nextAt };
}
