import { describe, expect, it } from 'vitest';
import type { CompetencyId } from '@bootquest/shared';
import type { Db } from '../src/db/database.ts';
import { recordAttempt, revealSolution } from '../src/engines/attempts.ts';
import { DAY_MS } from '../src/engines/clock.ts';
import {
  demote,
  evaluatePromotion,
  getRating,
  getRatings,
  promoteIfEligible,
  recordEvidence,
} from '../src/engines/evidence.ts';
import { makeUnit, useTempDb } from './helpers.ts';

type Clock = ReturnType<typeof useTempDb>['clock'];

interface LegOpts {
  artifact?: 'ok' | 'missing' | 'self-assisted' | 'unverified' | 'self-assessed';
  coverage?: number | null; // null = no explain-back
  retestDelayMs?: number | null; // null = no retest
  retest?: 'ok' | 'self-assisted' | 'revealed' | 'failed';
}

/** Build the three promotion legs for one competency with fixture-labelled data. */
function buildLegs(db: Db, clock: Clock, competency: CompetencyId, o: LegOpts = {}) {
  const artifactMode = o.artifact ?? 'ok';
  const coverage = o.coverage === undefined ? 0.85 : o.coverage;
  const delay = o.retestDelayMs === undefined ? 2 * DAY_MS : o.retestDelayMs;
  const retestMode = o.retest ?? 'ok';

  const unitKey = `fixture:${competency}:${Math.random().toString(36).slice(2)}`;
  const unitId = makeUnit(db, clock, { key: unitKey, kind: 'guided-project', competencies: [competency] });
  const retestUnitId = makeUnit(db, clock, { kind: 'retest', variationOf: unitKey, competencies: [competency] });

  if (artifactMode !== 'missing') {
    const attempt = recordAttempt(db, { unitId, outcome: 'pass', selfAssisted: artifactMode === 'self-assisted' }, clock);
    recordEvidence(
      db,
      {
        competency,
        kind: 'artifact',
        intention: 'fixture: ship the CLI-verified project',
        observation: 'fixture: check passed',
        assessor: artifactMode === 'self-assessed' ? 'self' : 'pipeline',
        verified: artifactMode !== 'unverified',
        attemptId: attempt.id,
      },
      clock,
    );
  }
  if (coverage !== null) {
    const eb = recordAttempt(db, { unitId, outcome: 'submitted', score: coverage, answer: { q1: 'fixture answer' } }, clock);
    recordEvidence(
      db,
      {
        competency,
        kind: 'explain-back',
        intention: 'fixture: explain the unit with code hidden',
        observation: `fixture: ${coverage * 100}% key points covered`,
        assessor: 'self',
        score: coverage,
        attemptId: eb.id,
      },
      clock,
    );
  }
  if (delay !== null) {
    clock.advance(delay);
    if (retestMode === 'revealed') revealSolution(db, retestUnitId, clock);
    const attempt = recordAttempt(
      db,
      { unitId: retestUnitId, outcome: retestMode === 'failed' ? 'fail' : 'pass', selfAssisted: retestMode === 'self-assisted' },
      clock,
    );
    recordEvidence(
      db,
      {
        competency,
        kind: 'retest',
        intention: 'fixture: changed-example retest',
        observation: 'fixture: retest result',
        assessor: 'pipeline',
        verified: retestMode !== 'failed',
        attemptId: attempt.id,
      },
      clock,
    );
  }
  return { unitId, retestUnitId };
}

describe('promotion requires all three legs', () => {
  const ctx = useTempDb();

  it('happy path: unassisted verified artifact + explain-back >= 80% + retest 2 days later => +1', () => {
    buildLegs(ctx.db, ctx.clock, 'feature-delivery');
    const ev = evaluatePromotion(ctx.db, 'feature-delivery', ctx.clock);
    expect(ev.eligible).toBe(true);
    expect(ev.missing).toEqual([]);
    const change = promoteIfEligible(ctx.db, 'feature-delivery', ctx.clock);
    expect(change).toMatchObject({ competency: 'feature-delivery', from: 1, to: 2 });
    expect(getRating(ctx.db, 'feature-delivery')).toBe(2);
    expect(ctx.db.get('SELECT kind, rating FROM evidence WHERE id = ?', change!.evidenceId)).toEqual({ kind: 'promotion', rating: 2 });
  });

  it('leg (a) missing => no promotion', () => {
    buildLegs(ctx.db, ctx.clock, 'feature-delivery', { artifact: 'missing' });
    const ev = evaluatePromotion(ctx.db, 'feature-delivery', ctx.clock);
    expect(ev.eligible).toBe(false);
    expect(ev.legs.artifact).toBe(null);
    expect(promoteIfEligible(ctx.db, 'feature-delivery', ctx.clock)).toBe(null);
    expect(getRating(ctx.db, 'feature-delivery')).toBe(1);
  });

  it('leg (a) assisted (self-flag), unverified, or self-assessed => no promotion', () => {
    for (const artifact of ['self-assisted', 'unverified', 'self-assessed'] as const) {
      const comp = 'testing-verification';
      buildLegs(ctx.db, ctx.clock, comp, { artifact });
      expect(evaluatePromotion(ctx.db, comp, ctx.clock).legs.artifact, artifact).toBe(null);
      expect(promoteIfEligible(ctx.db, comp, ctx.clock), artifact).toBe(null);
    }
  });

  it('leg (b) missing or below 80% coverage => no promotion; exactly 80% counts', () => {
    buildLegs(ctx.db, ctx.clock, 'data-http', { coverage: null });
    expect(promoteIfEligible(ctx.db, 'data-http', ctx.clock)).toBe(null);
    buildLegs(ctx.db, ctx.clock, 'data-http', { coverage: 0.79 });
    expect(evaluatePromotion(ctx.db, 'data-http', ctx.clock).legs.explainBack).toBe(null);
    expect(promoteIfEligible(ctx.db, 'data-http', ctx.clock)).toBe(null);
    buildLegs(ctx.db, ctx.clock, 'code-reading', { coverage: 0.8 });
    expect(promoteIfEligible(ctx.db, 'code-reading', ctx.clock)).toMatchObject({ to: 2 });
  });

  it('leg (c) missing, failed, or assisted => no promotion', () => {
    buildLegs(ctx.db, ctx.clock, 'communication', { retestDelayMs: null });
    expect(promoteIfEligible(ctx.db, 'communication', ctx.clock)).toBe(null);
    for (const retest of ['failed', 'self-assisted', 'revealed'] as const) {
      buildLegs(ctx.db, ctx.clock, 'language-fluency', { retest });
      expect(evaluatePromotion(ctx.db, 'language-fluency', ctx.clock).legs.retest, retest).toBe(null);
      expect(promoteIfEligible(ctx.db, 'language-fluency', ctx.clock), retest).toBe(null);
    }
    expect(getRating(ctx.db, 'language-fluency')).toBe(1);
  });

  it('legs are consumed by a promotion: the next notch needs fresh legs', () => {
    buildLegs(ctx.db, ctx.clock, 'feature-delivery');
    expect(promoteIfEligible(ctx.db, 'feature-delivery', ctx.clock)).not.toBe(null);
    ctx.clock.advance(1000);
    expect(evaluatePromotion(ctx.db, 'feature-delivery', ctx.clock).eligible).toBe(false);
    ctx.clock.advance(1000);
    buildLegs(ctx.db, ctx.clock, 'feature-delivery');
    expect(promoteIfEligible(ctx.db, 'feature-delivery', ctx.clock)).toMatchObject({ from: 2, to: 3 });
  });

  it('never promotes past 5', () => {
    ctx.db.run(`UPDATE competency_rating SET rating = 5 WHERE competency_id = 'feature-delivery'`);
    buildLegs(ctx.db, ctx.clock, 'feature-delivery');
    const ev = evaluatePromotion(ctx.db, 'feature-delivery', ctx.clock);
    expect(ev.eligible).toBe(false);
    expect(ev.missing.join()).toMatch(/max/);
  });
});

describe('clock injection: retest delay', () => {
  const ctx = useTempDb();

  it('retest at +1 day is rejected', () => {
    buildLegs(ctx.db, ctx.clock, 'feature-delivery', { retestDelayMs: 1 * DAY_MS });
    expect(evaluatePromotion(ctx.db, 'feature-delivery', ctx.clock).legs.retest).toBe(null);
    expect(promoteIfEligible(ctx.db, 'feature-delivery', ctx.clock)).toBe(null);
  });

  it('retest 1 ms short of 2 days is rejected', () => {
    buildLegs(ctx.db, ctx.clock, 'feature-delivery', { retestDelayMs: 2 * DAY_MS - 1 });
    expect(promoteIfEligible(ctx.db, 'feature-delivery', ctx.clock)).toBe(null);
  });

  it('retest at +2 days is accepted', () => {
    buildLegs(ctx.db, ctx.clock, 'feature-delivery', { retestDelayMs: 2 * DAY_MS });
    expect(promoteIfEligible(ctx.db, 'feature-delivery', ctx.clock)).toMatchObject({ to: 2 });
  });

  it('evidence dated after `now` is invisible (no peeking at the future)', () => {
    buildLegs(ctx.db, ctx.clock, 'feature-delivery');
    const past = () => new Date(ctx.clock().getTime() - DAY_MS);
    expect(evaluatePromotion(ctx.db, 'feature-delivery', past).eligible).toBe(false);
  });
});

describe('reveal and assistance propagation', () => {
  const ctx = useTempDb();

  it('reveal flags guided, auto-flags evidence, and schedules a variation when one exists', () => {
    const unitKey = 'fixture:reveal-me';
    const unitId = makeUnit(ctx.db, ctx.clock, { key: unitKey });
    const variant = makeUnit(ctx.db, ctx.clock, { kind: 'retest', variationOf: unitKey });
    const { attempt, variationUnitId } = revealSolution(ctx.db, unitId, ctx.clock);
    expect(variationUnitId).toBe(variant);
    expect(attempt.variation_unit_id).toBe(variant);
    const later = recordAttempt(ctx.db, { unitId, outcome: 'pass' }, ctx.clock);
    expect(later).toMatchObject({ mode: 'guided', assisted: true, assistance_source: 'reveal' });
    const ev = recordEvidence(
      ctx.db,
      { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', assessor: 'pipeline', verified: true, assistance: 'none', attemptId: later.id },
      ctx.clock,
    );
    expect(ev.assistance).toBe('reveal'); // caller's 'none' is overridden by the attempt
  });

  it('reveal with no seeded variation degrades gracefully (null link)', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    const { attempt, variationUnitId } = revealSolution(ctx.db, unitId, ctx.clock);
    expect(variationUnitId).toBe(null);
    expect(attempt.variation_unit_id).toBe(null);
  });

  it('self-flagged assistance propagates from attempt to evidence', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    const a = recordAttempt(ctx.db, { unitId, outcome: 'pass', selfAssisted: true }, ctx.clock);
    expect(a).toMatchObject({ mode: 'assisted', assisted: true, assistance_source: 'self' });
    const ev = recordEvidence(
      ctx.db,
      { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', assessor: 'pipeline', verified: true, attemptId: a.id },
      ctx.clock,
    );
    expect(ev.assistance).toBe('self');
    expect(ev.unit_id).toBe(unitId);
  });
});

describe('ratings are per-competency and never averaged', () => {
  const ctx = useTempDb();

  it('promoting one competency leaves the other six untouched', () => {
    buildLegs(ctx.db, ctx.clock, 'data-http');
    promoteIfEligible(ctx.db, 'data-http', ctx.clock);
    const ratings = getRatings(ctx.db);
    expect(ratings).toHaveLength(7);
    expect(ratings.find((r) => r.competency === 'data-http')!.rating).toBe(2);
    expect(ratings.filter((r) => r.competency !== 'data-http').every((r) => r.rating === 1)).toBe(true);
    expect(ratings.every((r) => Number.isInteger(r.rating))).toBe(true);
  });

  it('evidence ratings do not blend into the current rating', () => {
    for (const rating of [5, 1, 4]) {
      recordEvidence(
        ctx.db,
        { competency: 'communication', kind: 'self-assessment', intention: 'i', observation: 'o', assessor: 'self', rating },
        ctx.clock,
      );
    }
    expect(getRating(ctx.db, 'communication')).toBe(1); // not 3.33, not 5: only the promotion rule moves it
  });

  it('demotion drops exactly one notch on one competency, floors at 1, and resets the legs window', () => {
    ctx.db.run(`UPDATE competency_rating SET rating = 3 WHERE competency_id = 'agentic-engineering'`);
    buildLegs(ctx.db, ctx.clock, 'agentic-engineering');
    ctx.clock.advance(1);
    expect(demote(ctx.db, 'agentic-engineering', ctx.clock, 'fixture: failed review')).toMatchObject({ from: 3, to: 2 });
    expect(getRating(ctx.db, 'feature-delivery')).toBe(1);
    ctx.clock.advance(1);
    expect(evaluatePromotion(ctx.db, 'agentic-engineering', ctx.clock).eligible).toBe(false); // legs predate demotion
    ctx.clock.advance(1);
    demote(ctx.db, 'agentic-engineering', ctx.clock, 'again');
    ctx.clock.advance(1);
    expect(demote(ctx.db, 'agentic-engineering', ctx.clock, 'again')).toMatchObject({ from: 1, to: 1 });
  });
});
