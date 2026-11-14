/**
 * rv2 0a (orchestrator ruling on INTEGRATION §5): a REPEAT pass of a quick check whose first pass paid 0
 * (rv B R4-09, first-try-missed) names its zero reason, 'already-awarded', as a repeat pass did before R4-09.
 * The first 0-XP pass keeps reason null + note 'first-try-missed' (the bound reason CHECK has no value for it).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordSubmission } from '../src/engines/attempts.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { awardXp } from '../src/engines/xp.ts';
import { FAIL, localNoon, makeTempDb, makeUnit, PASS, type TempDb } from './helpers.ts';

describe('rv2 0a: repeat pass after a first-try-missed pass', () => {
  let tmp: TempDb;
  const clock = fixedClock(localNoon(2026, 11, 14));
  beforeEach(() => {
    tmp = makeTempDb();
  }, 60_000);
  afterEach(() => tmp.cleanup());
  const checkOf = (u: number) => tmp.db.get<{ id: number }>('SELECT id FROM "check" WHERE unit_id = ?', u)!.id;

  it('fail -> pass (0, note first-try-missed) -> pass again (0, already-awarded)', () => {
    const u = makeUnit(tmp.db, clock, { kind: 'quiz' });
    recordSubmission(tmp.db, { unitId: u, checkId: checkOf(u), result: FAIL }, clock);
    const p1 = recordSubmission(tmp.db, { unitId: u, checkId: checkOf(u), result: PASS }, clock).attempt;
    expect(awardXp(tmp.db, { kind: 'quiz', attemptId: p1.id }, clock)).toMatchObject({ amount: 0, reason: null, note: 'first-try-missed' });
    const p2 = recordSubmission(tmp.db, { unitId: u, checkId: checkOf(u), result: PASS }, clock).attempt;
    const again = awardXp(tmp.db, { kind: 'quiz', attemptId: p2.id }, clock);
    expect(again).toMatchObject({ amount: 0, reason: 'already-awarded' });
    expect(again.note).toBeUndefined();
    expect(tmp.db.get<{ s: number }>("SELECT SUM(amount) AS s FROM xp_event WHERE kind = 'quiz'")!.s).toBe(0);
  });

  it('a first-try pass then a repeat pass: unchanged (2 XP, then 0 already-awarded)', () => {
    const u = makeUnit(tmp.db, clock, { kind: 'quiz' });
    const p1 = recordSubmission(tmp.db, { unitId: u, checkId: checkOf(u), result: PASS }, clock).attempt;
    expect(awardXp(tmp.db, { kind: 'quiz', attemptId: p1.id }, clock)).toMatchObject({ amount: 2, reason: null });
    const p2 = recordSubmission(tmp.db, { unitId: u, checkId: checkOf(u), result: PASS }, clock).attempt;
    expect(awardXp(tmp.db, { kind: 'quiz', attemptId: p2.id }, clock)).toMatchObject({ amount: 0, reason: 'already-awarded' });
  });
});
