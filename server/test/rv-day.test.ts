import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/database.ts';
import { DAY_MS } from '../src/engines/clock.ts';
import { recordEvidence } from '../src/engines/evidence.ts';
import { recordAttempt } from '../src/engines/attempts.ts';
import { closeElapsedDays, composeSlate, learnerShape, seniorRepOrder, slateShape, streakStatus } from '../src/engines/streak.ts';
import { setRouting, EMPTY_ROUTING } from '../src/store/routing.ts';
import { makeUnit, submit, useTempDb } from './helpers.ts';

/**
 * rv wave C (REVIEW Wave 1b row 3, D3/D5, R4-05/R4-22/R5-03): the default slate is the Fundamentals step on
 * the primary language + one senior rep (+ the review slot once cards exist); completing it grows the streak.
 */

beforeEach(() => setRouting(EMPTY_ROUTING));
afterEach(() => setRouting(null));

/** A two-topic JS ladder: gates fund/js/01-a, fund/js/02-b (02 needs 01) and one drill per topic. */
function ladder(db: Db, clock: () => Date, track = 'js') {
  const g1 = makeUnit(db, clock, { key: `fund/${track}/01-a`, kind: 'drill', track });
  const d1 = makeUnit(db, clock, { key: `fund-${track}/01-a/one`, kind: 'drill', track });
  const g2 = makeUnit(db, clock, { key: `fund/${track}/02-b`, kind: 'drill', track, prerequisites: [`fund/${track}/01-a`] });
  return { g1, d1, g2 };
}

const designSet = (db: Db, clock: () => Date, key = 'ladder/explain-back/repo/aaaaaaaaaaaa') => makeUnit(db, clock, { key, kind: 'explain-back', track: 'sysdesign', competencies: ['system-design'] });
const kata = (db: Db, clock: () => Date, key = 'ladder/kata/repo/bbbbbbbbbbbb') => makeUnit(db, clock, { key, kind: 'patch-kata', track: 'agentic', competencies: ['system-design'] });

function selfScore(db: Db, clock: () => Date, unitId: number, kind: 'explain-back' | 'kata', score: number) {
  const attempt = recordAttempt(db, { unitId, answer: { q1: 'my answer' }, selfAssisted: false }, clock);
  recordEvidence(db, { competency: 'system-design', kind, intention: 'self-scored rep', observation: 'x', score, attemptId: attempt.id }, clock);
}

const shapeOf = (db: Db, clock: () => Date) => composeSlate(db, clock).items.map((i) => (i.kind === 'senior-rep' ? `senior:${i.rep}` : i.kind === 'fund-step' ? `fund:${i.track}` : i.slot));

describe('rv wave C default slate', () => {
  const ctx = useTempDb();

  it('a fresh DB: every drill set off, no campaign step; Fundamentals step on JS + a senior rep', () => {
    ladder(ctx.db, ctx.clock);
    designSet(ctx.db, ctx.clock);
    for (const t of ['js', 'csharp', 'java', 'sysdesign']) makeUnit(ctx.db, ctx.clock, { track: t });
    expect(slateShape(ctx.db, '2026-10-01').every((t) => !t.enabled && !t.configured)).toBe(true);
    expect(learnerShape(ctx.db, '2026-10-01')).toEqual({ primaryLanguage: 'js', primaryChosen: false, campaignStep: false, seniorRep: true });
    // 2026-10-01 is a Thursday: design day
    expect(seniorRepOrder('2026-10-01')[0]).toBe('design');
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(['fund:js', 'senior:design']);
  });

  it('the rotation falls through to what is open: no DESIGN IT set -> kata; nothing open -> no senior slot', () => {
    ladder(ctx.db, ctx.clock);
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(['fund:js']);
    ctx.clock.advance(DAY_MS);
    kata(ctx.db, ctx.clock);
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(['fund:js', 'senior:kata']);
  });

  it('Fundamentals JS 21-33 is a senior rep only once its topic is open (Wed/Sat preference)', () => {
    const g20 = makeUnit(ctx.db, ctx.clock, { key: 'fund/js/20-t', kind: 'drill' });
    makeUnit(ctx.db, ctx.clock, { key: 'fund/js/21-senior', kind: 'drill', prerequisites: ['fund/js/20-t'] });
    // 2026-10-03 is a Saturday: fund-senior first, but topic 21 is locked behind 20 -> no senior slot
    ctx.clock.advance(2 * DAY_MS);
    expect(seniorRepOrder('2026-10-03')[0]).toBe('fund-senior');
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(['fund:js']);
    submit(ctx.db, ctx.clock, g20);
    ctx.clock.advance(7 * DAY_MS); // the next Saturday: 21 is open
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(['fund:js', 'senior:fund-senior']);
  });

  it('a Fundamentals pass + any senior rep completes the day; the streak grows; hero/streak agree (todayComplete)', () => {
    const { g1 } = ladder(ctx.db, ctx.clock);
    const d = designSet(ctx.db, ctx.clock);
    kata(ctx.db, ctx.clock);
    composeSlate(ctx.db, ctx.clock);
    submit(ctx.db, ctx.clock, g1);
    let slate = composeSlate(ctx.db, ctx.clock);
    expect(slate.items.map((i) => [i.slot, i.done])).toEqual([
      ['fund', true],
      ['senior', false],
    ]);
    expect(streakStatus(ctx.db, ctx.clock).todayComplete).toBe(false);
    // a failing DESIGN IT self-score does not count; a kata self-score on a design day does
    selfScore(ctx.db, ctx.clock, d, 'explain-back', 0.5);
    expect(composeSlate(ctx.db, ctx.clock).items.find((i) => i.slot === 'senior')!.done).toBe(false);
    selfScore(ctx.db, ctx.clock, kata(ctx.db, ctx.clock, 'ladder/kata/repo/cccccccccccc'), 'kata', 0.5);
    slate = composeSlate(ctx.db, ctx.clock);
    expect(slate.items.every((i) => i.done)).toBe(true);
    const s = streakStatus(ctx.db, ctx.clock);
    expect(s).toMatchObject({ current: 0, display: 1, todayComplete: true });
    ctx.clock.advance(DAY_MS);
    expect(closeElapsedDays(ctx.db, ctx.clock)).toEqual([{ day: '2026-10-01', status: 'slate', xp: 0 }]);
    expect(streakStatus(ctx.db, ctx.clock).current).toBe(1);
  });

  it('re-passing an old Fundamentals unit never ticks the slot; a finished ladder gives way to the primary drill set', () => {
    const { g1, d1, g2 } = ladder(ctx.db, ctx.clock);
    makeUnit(ctx.db, ctx.clock, { track: 'js' });
    for (const u of [g1, d1, g2]) submit(ctx.db, ctx.clock, u);
    ctx.clock.advance(DAY_MS);
    // ladder finished before the day started -> drill:js (default size 1) instead of the fund slot
    const items = composeSlate(ctx.db, ctx.clock).items;
    expect(items.map((i) => i.slot)).toEqual(['drill:js']);
    submit(ctx.db, ctx.clock, g1); // a re-pass
    expect(composeSlate(ctx.db, ctx.clock).items[0]!.done).toBe(false);
  });

  it('the senior suggestion is fixed for the day once the row exists', () => {
    ladder(ctx.db, ctx.clock);
    const d = designSet(ctx.db, ctx.clock);
    kata(ctx.db, ctx.clock);
    expect(shapeOf(ctx.db, ctx.clock)).toContain('senior:design');
    selfScore(ctx.db, ctx.clock, d, 'explain-back', 1); // the only design set is now done
    const items = composeSlate(ctx.db, ctx.clock).items;
    expect(items.find((i) => i.slot === 'senior')).toMatchObject({ rep: 'design', done: true });
  });

  it('a primary-language row moves the Fundamentals step to that ladder', () => {
    ladder(ctx.db, ctx.clock);
    ladder(ctx.db, ctx.clock, 'csharp');
    ctx.db.run(`INSERT INTO learner_setting (key, value, effective_day, created_at) VALUES ('primary_language', 'csharp', '2026-10-02', 1)`);
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(['fund:js']);
    ctx.clock.advance(DAY_MS);
    expect(shapeOf(ctx.db, ctx.clock)).toEqual(['fund:csharp']);
    expect(learnerShape(ctx.db, '2026-10-02')).toMatchObject({ primaryLanguage: 'csharp', primaryChosen: true });
  });

  it('learner_setting is append-only', () => {
    ctx.db.run(`INSERT INTO learner_setting (key, value, effective_day, created_at) VALUES ('senior_rep', 'off', '2026-10-02', 1)`);
    expect(() => ctx.db.run(`UPDATE learner_setting SET value = 'on'`)).toThrow(/append-only/);
    expect(() => ctx.db.run(`DELETE FROM learner_setting`)).toThrow(/append-only/);
    expect(() => ctx.db.run(`INSERT INTO learner_setting (key, value, effective_day, created_at) VALUES ('primary_language', 'rust', '2026-10-02', 1)`)).toThrow();
  });
});
