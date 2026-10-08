import { describe, expect, it } from 'vitest';
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
import { buildLegs, explainBack, makeUnit, promoteTo, submit, unitKey, useTempDb } from './helpers.ts';

describe('promotion requires one linked three-leg chain', () => {
  const ctx = useTempDb();

  it('happy path: verified project artifact + its explain-back >= 80% + variation retest 2 days later => +1', () => {
    buildLegs(ctx.db, ctx.clock, 'feature-delivery');
    const ev = evaluatePromotion(ctx.db, 'feature-delivery', ctx.clock);
    expect(ev.missing).toEqual([]);
    expect(ev.eligible).toBe(true);
    const change = promoteIfEligible(ctx.db, 'feature-delivery', ctx.clock);
    expect(change).toMatchObject({ competency: 'feature-delivery', from: 1, to: 2 });
    expect(getRating(ctx.db, 'feature-delivery')).toBe(2);
    expect(ctx.db.get('SELECT kind, rating FROM evidence WHERE id = ?', change!.evidenceId)).toEqual({ kind: 'promotion', rating: 2 });
  });

  it('leg (a) missing, failed, or self-assisted => no promotion', () => {
    for (const artifact of ['missing', 'failed', 'self-assisted'] as const) {
      buildLegs(ctx.db, ctx.clock, 'testing-verification', { artifact });
      expect(evaluatePromotion(ctx.db, 'testing-verification', ctx.clock).legs.artifact, artifact).toBe(null);
      expect(promoteIfEligible(ctx.db, 'testing-verification', ctx.clock), artifact).toBe(null);
    }
    expect(getRating(ctx.db, 'testing-verification')).toBe(1);
  });

  it('a failed artifact is recorded with verified=false derived from its run', () => {
    const ids = buildLegs(ctx.db, ctx.clock, 'data-http', { artifact: 'failed' });
    expect(ctx.db.get('SELECT verified, assessor, score FROM evidence WHERE id = ?', ids.artifact!)).toEqual({ verified: false, assessor: 'pipeline', score: 0 });
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

  it('leg (c) missing, failed, assisted, or revealed => no promotion', () => {
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
    promoteTo(ctx.db, ctx.clock, 'feature-delivery', 5);
    ctx.clock.advance(1000);
    buildLegs(ctx.db, ctx.clock, 'feature-delivery');
    const ev = evaluatePromotion(ctx.db, 'feature-delivery', ctx.clock);
    expect(ev.eligible).toBe(false);
    expect(ev.missing.join()).toMatch(/max/);
  });

  it('explain-back may live on an explain-back unit that lists the artifact unit as a prerequisite', () => {
    const key = 'fixture:eb-host';
    const unitId = makeUnit(ctx.db, ctx.clock, { key, kind: 'guided-project', competencies: ['communication'] });
    const ebUnit = makeUnit(ctx.db, ctx.clock, { kind: 'explain-back', prerequisites: [key], competencies: ['communication'] });
    const retestUnit = makeUnit(ctx.db, ctx.clock, { kind: 'retest', variationOf: key, competencies: ['communication'] });
    const a = submit(ctx.db, ctx.clock, unitId);
    recordEvidence(ctx.db, { competency: 'communication', kind: 'artifact', intention: 'i', observation: 'o', attemptId: a.id }, ctx.clock);
    explainBack(ctx.db, ctx.clock, ebUnit, 'communication', 0.9);
    ctx.clock.advance(2 * DAY_MS);
    const r = submit(ctx.db, ctx.clock, retestUnit);
    recordEvidence(ctx.db, { competency: 'communication', kind: 'retest', intention: 'i', observation: 'o', attemptId: r.id }, ctx.clock);
    expect(promoteIfEligible(ctx.db, 'communication', ctx.clock)).toMatchObject({ to: 2 });
  });

  it('a variation of a variation of the artifact unit counts as its changed-example retest', () => {
    const key = 'fixture:chain-root';
    const unitId = makeUnit(ctx.db, ctx.clock, { key, kind: 'http-lab', competencies: ['data-http'] });
    makeUnit(ctx.db, ctx.clock, { key: 'fixture:chain-mid', kind: 'retest', variationOf: key, competencies: ['data-http'] });
    const leaf = makeUnit(ctx.db, ctx.clock, { kind: 'retest', variationOf: 'fixture:chain-mid', competencies: ['data-http'] });
    const a = submit(ctx.db, ctx.clock, unitId);
    recordEvidence(ctx.db, { competency: 'data-http', kind: 'artifact', intention: 'i', observation: 'o', attemptId: a.id }, ctx.clock);
    explainBack(ctx.db, ctx.clock, unitId, 'data-http', 1);
    ctx.clock.advance(2 * DAY_MS);
    const r = submit(ctx.db, ctx.clock, leaf);
    recordEvidence(ctx.db, { competency: 'data-http', kind: 'retest', intention: 'i', observation: 'o', attemptId: r.id }, ctx.clock);
    expect(promoteIfEligible(ctx.db, 'data-http', ctx.clock)).toMatchObject({ to: 2 });
  });
});

describe('promotion legs cannot be forged (W1a audit #2-#4)', () => {
  const ctx = useTempDb();

  it('the evidence input refuses caller-supplied verified / assessor / assistance', () => {
    const unitId = makeUnit(ctx.db, ctx.clock, { kind: 'guided-project', competencies: ['feature-delivery'] });
    const a = submit(ctx.db, ctx.clock, unitId);
    const base = { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', attemptId: a.id } as const;
    for (const extra of [{ verified: true }, { assessor: 'pipeline' }, { assistance: 'none' }]) {
      expect(() => recordEvidence(ctx.db, { ...base, ...extra } as never, ctx.clock)).toThrow();
    }
  });

  it('artifact / retest evidence without a linked attempt is rejected', () => {
    for (const kind of ['artifact', 'retest', 'explain-back'] as const) {
      expect(() =>
        recordEvidence(ctx.db, { competency: 'feature-delivery', kind, intention: 'i', observation: 'o', ...(kind === 'explain-back' ? { score: 1 } : {}) }, ctx.clock),
      ).toThrow(/attemptId/);
    }
  });

  it('a raw "pass" attempt with no submit run proves nothing', () => {
    const unitId = makeUnit(ctx.db, ctx.clock, { kind: 'guided-project', competencies: ['feature-delivery'] });
    const id = ctx.db.run(
      `INSERT INTO attempt (unit_id, mode, assisted, assistance_source, outcome, created_at) VALUES (?, 'solo', 0, 'none', 'pass', ?)`,
      unitId,
      ctx.clock().getTime(),
    ).lastInsertRowid;
    expect(() =>
      recordEvidence(ctx.db, { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', attemptId: id }, ctx.clock),
    ).toThrow(/submit run/);
  });

  it('graded outcomes cannot be chosen through recordAttempt (only answer attempts)', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    expect(() => recordAttempt(ctx.db, { unitId, outcome: 'pass' } as never, ctx.clock)).toThrow();
    expect(recordAttempt(ctx.db, { unitId, answer: { a: 1 } }, ctx.clock).outcome).toBe('submitted');
  });

  it('leg (a) only on project-kind units; competency must be declared by the unit', () => {
    const drill = makeUnit(ctx.db, ctx.clock, { kind: 'drill', competencies: ['feature-delivery'] });
    const a = submit(ctx.db, ctx.clock, drill);
    expect(() =>
      recordEvidence(ctx.db, { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', attemptId: a.id }, ctx.clock),
    ).toThrow(/project unit/);
    const proj = makeUnit(ctx.db, ctx.clock, { kind: 'guided-project', competencies: ['language-fluency'] });
    const b = submit(ctx.db, ctx.clock, proj);
    expect(() =>
      recordEvidence(ctx.db, { competency: 'communication', kind: 'artifact', intention: 'i', observation: 'o', attemptId: b.id }, ctx.clock),
    ).toThrow(/does not declare/);
  });

  it('REUSED attempt: retest evidence on the artifact attempt itself is rejected', () => {
    const ids = buildLegs(ctx.db, ctx.clock, 'feature-delivery', { retestDelayMs: null });
    const artifactAttempt = ctx.db.get<{ attempt_id: number }>('SELECT attempt_id FROM evidence WHERE id = ?', ids.artifact!)!.attempt_id;
    expect(() =>
      recordEvidence(ctx.db, { competency: 'feature-delivery', kind: 'retest', intention: 'i', observation: 'o', attemptId: artifactAttempt }, ctx.clock),
    ).toThrow(/retest unit/);
  });

  it('BACK-FILLED: evidence filed days after its attempt is rejected (timing is on the attempt)', () => {
    const key = 'fixture:backfill';
    const unitId = makeUnit(ctx.db, ctx.clock, { key, kind: 'guided-project', competencies: ['feature-delivery'] });
    const retestUnit = makeUnit(ctx.db, ctx.clock, { kind: 'retest', variationOf: key, competencies: ['feature-delivery'] });
    const a = submit(ctx.db, ctx.clock, unitId);
    recordEvidence(ctx.db, { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', attemptId: a.id }, ctx.clock);
    explainBack(ctx.db, ctx.clock, unitId, 'feature-delivery', 0.9);
    const early = submit(ctx.db, ctx.clock, retestUnit); // day 0: the retest is done immediately
    ctx.clock.advance(2 * DAY_MS);
    expect(() =>
      recordEvidence(ctx.db, { competency: 'feature-delivery', kind: 'retest', intention: 'i', observation: 'o', attemptId: early.id }, ctx.clock),
    ).toThrow(/back-filled/);
    expect(promoteIfEligible(ctx.db, 'feature-delivery', ctx.clock)).toBe(null);
  });

  it('a same-day retest filed promptly still fails the 48h gate (measured on attempts)', () => {
    const key = 'fixture:sameday';
    const unitId = makeUnit(ctx.db, ctx.clock, { key, kind: 'guided-project', competencies: ['feature-delivery'] });
    const retestUnit = makeUnit(ctx.db, ctx.clock, { kind: 'retest', variationOf: key, competencies: ['feature-delivery'] });
    const a = submit(ctx.db, ctx.clock, unitId);
    recordEvidence(ctx.db, { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', attemptId: a.id }, ctx.clock);
    explainBack(ctx.db, ctx.clock, unitId, 'feature-delivery', 0.9);
    const r = submit(ctx.db, ctx.clock, retestUnit);
    recordEvidence(ctx.db, { competency: 'feature-delivery', kind: 'retest', intention: 'i', observation: 'o', attemptId: r.id }, ctx.clock);
    ctx.clock.advance(5 * DAY_MS);
    expect(evaluatePromotion(ctx.db, 'feature-delivery', ctx.clock).legs.retest).toBe(null);
  });

  it('ORDER: explain-back day 0, retest day 2, artifact day 3 does not promote', () => {
    const key = 'fixture:order';
    const unitId = makeUnit(ctx.db, ctx.clock, { key, kind: 'guided-project', competencies: ['feature-delivery'] });
    const retestUnit = makeUnit(ctx.db, ctx.clock, { kind: 'retest', variationOf: key, competencies: ['feature-delivery'] });
    explainBack(ctx.db, ctx.clock, unitId, 'feature-delivery', 0.9);
    ctx.clock.advance(2 * DAY_MS);
    const r = submit(ctx.db, ctx.clock, retestUnit);
    recordEvidence(ctx.db, { competency: 'feature-delivery', kind: 'retest', intention: 'i', observation: 'o', attemptId: r.id }, ctx.clock);
    ctx.clock.advance(DAY_MS);
    const a = submit(ctx.db, ctx.clock, unitId);
    recordEvidence(ctx.db, { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', attemptId: a.id }, ctx.clock);
    expect(promoteIfEligible(ctx.db, 'feature-delivery', ctx.clock)).toBe(null);
  });

  it('UNLINKED legs: explain-back and retest on unrelated units of the same competency do not promote', () => {
    const unitA = makeUnit(ctx.db, ctx.clock, { key: 'fixture:A', kind: 'guided-project', competencies: ['feature-delivery'] });
    const unitB = makeUnit(ctx.db, ctx.clock, { key: 'fixture:B', kind: 'guided-project', competencies: ['feature-delivery'] });
    const retestOfB = makeUnit(ctx.db, ctx.clock, { kind: 'retest', variationOf: 'fixture:B', competencies: ['feature-delivery'] });
    const a = submit(ctx.db, ctx.clock, unitA);
    recordEvidence(ctx.db, { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', attemptId: a.id }, ctx.clock);
    explainBack(ctx.db, ctx.clock, unitB, 'feature-delivery', 0.95); // explains B, not A
    ctx.clock.advance(2 * DAY_MS);
    const r = submit(ctx.db, ctx.clock, retestOfB);
    recordEvidence(ctx.db, { competency: 'feature-delivery', kind: 'retest', intention: 'i', observation: 'o', attemptId: r.id }, ctx.clock);
    const ev = evaluatePromotion(ctx.db, 'feature-delivery', ctx.clock);
    expect(ev.legs.explainBack).toBe(null);
    expect(ev.eligible).toBe(false);
  });

  it('explain-back evidence needs the stored answer attempt (not a graded one)', () => {
    const unitId = makeUnit(ctx.db, ctx.clock, { kind: 'guided-project', competencies: ['communication'] });
    const graded = submit(ctx.db, ctx.clock, unitId);
    expect(() =>
      recordEvidence(ctx.db, { competency: 'communication', kind: 'explain-back', intention: 'i', observation: 'o', score: 1, attemptId: graded.id }, ctx.clock),
    ).toThrow(/submitted/);
  });
});

describe('clock injection: retest delay (timed on attempts)', () => {
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
    const key = 'fixture:reveal-me';
    const unitId = makeUnit(ctx.db, ctx.clock, { key, kind: 'guided-project', competencies: ['feature-delivery'] });
    const variant = makeUnit(ctx.db, ctx.clock, { kind: 'retest', variationOf: key });
    const { attempt, variationUnitId } = revealSolution(ctx.db, unitId, ctx.clock);
    expect(variationUnitId).toBe(variant);
    expect(attempt.variation_unit_id).toBe(variant);
    const later = submit(ctx.db, ctx.clock, unitId);
    expect(later).toMatchObject({ mode: 'guided', assisted: true, assistance_source: 'reveal' });
    const ev = recordEvidence(
      ctx.db,
      { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', attemptId: later.id },
      ctx.clock,
    );
    expect(ev.assistance).toBe('reveal');
    expect(ev.verified).toBe(true); // it passed — but the reveal flag keeps it out of leg (a)
    expect(evaluatePromotion(ctx.db, 'feature-delivery', ctx.clock).legs.artifact).toBe(null);
  });

  it('reveal with no seeded variation degrades gracefully (null link)', () => {
    const unitId = makeUnit(ctx.db, ctx.clock);
    const { attempt, variationUnitId } = revealSolution(ctx.db, unitId, ctx.clock);
    expect(variationUnitId).toBe(null);
    expect(attempt.variation_unit_id).toBe(null);
  });

  it('self-flagged assistance propagates from attempt to evidence', () => {
    const unitId = makeUnit(ctx.db, ctx.clock, { kind: 'guided-project', competencies: ['feature-delivery'] });
    const a = submit(ctx.db, ctx.clock, unitId, { selfAssisted: true });
    expect(a).toMatchObject({ mode: 'assisted', assisted: true, assistance_source: 'self' });
    const ev = recordEvidence(
      ctx.db,
      { competency: 'feature-delivery', kind: 'artifact', intention: 'i', observation: 'o', attemptId: a.id },
      ctx.clock,
    );
    expect(ev.assistance).toBe('self');
    expect(ev.unit_id).toBe(unitId);
    expect(unitKey(ctx.db, unitId)).toMatch(/^test:unit-/);
  });
});

describe('ratings are per-competency, never averaged, and only move through promote/demote', () => {
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
      recordEvidence(ctx.db, { competency: 'communication', kind: 'self-assessment', intention: 'i', observation: 'o', rating }, ctx.clock);
    }
    expect(getRating(ctx.db, 'communication')).toBe(1); // not 3.33, not 5: only the promotion rule moves it
  });

  it('demotion drops exactly one notch on one competency, floors at 1, and resets the legs window', () => {
    promoteTo(ctx.db, ctx.clock, 'agentic-engineering', 3);
    ctx.clock.advance(1000);
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

  it('a floor demotion (1 -> 1) is logged but does not discard banked legs (audit #10)', () => {
    buildLegs(ctx.db, ctx.clock, 'code-reading');
    ctx.clock.advance(1);
    expect(demote(ctx.db, 'code-reading', ctx.clock, 'floor')).toMatchObject({ from: 1, to: 1 });
    ctx.clock.advance(1);
    expect(promoteIfEligible(ctx.db, 'code-reading', ctx.clock)).toMatchObject({ from: 1, to: 2 });
  });

  it('competency_rating cannot be changed directly (SQL trigger)', () => {
    expect(() => ctx.db.run(`UPDATE competency_rating SET rating = 5 WHERE competency_id = 'feature-delivery'`)).toThrow(/rating integrity/);
    expect(() => ctx.db.run(`DELETE FROM competency_rating WHERE competency_id = 'feature-delivery'`)).toThrow(/rating integrity/);
    expect(() =>
      ctx.db.run(`INSERT OR REPLACE INTO competency_rating (competency_id, rating, last_evidence_id, updated_at) VALUES ('feature-delivery', 5, NULL, 0)`),
    ).toThrow(/rating integrity/);
    expect(getRating(ctx.db, 'feature-delivery')).toBe(1);
  });

  it('a rating UPDATE cannot reuse an old promotion row or skip notches', () => {
    promoteTo(ctx.db, ctx.clock, 'feature-delivery', 2);
    const promo = ctx.db.get<{ id: number }>(`SELECT id FROM evidence WHERE kind = 'promotion' AND competency_id = 'feature-delivery'`)!.id;
    ctx.clock.advance(1);
    demote(ctx.db, 'feature-delivery', ctx.clock, 'lapse');
    expect(() =>
      ctx.db.run(`UPDATE competency_rating SET rating = 2, last_evidence_id = ? WHERE competency_id = 'feature-delivery'`, promo),
    ).toThrow(/rating integrity/);
    // a forged promotion row that jumps notches is refused at insert
    expect(() =>
      ctx.db.run(
        `INSERT INTO evidence (competency_id, kind, intention, observation, assistance, assessor, rating, verified, created_at)
         VALUES ('feature-delivery', 'promotion', 'x', 'x', 'none', 'pipeline', 5, 1, 0)`,
      ),
    ).toThrow(/one notch/);
    expect(getRating(ctx.db, 'feature-delivery')).toBe(1);
  });
});
