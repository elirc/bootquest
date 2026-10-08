import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { State } from 'ts-fsrs';
import { afterEach, beforeEach } from 'vitest';
import type { CheckSpecInput, CompetencyId } from '@bootquest/shared';
import { openDb, type Db } from '../src/db/database.ts';
import { recordAttempt, recordSubmission, revealSolution, type AttemptRow } from '../src/engines/attempts.ts';
import { fixedClock, DAY_MS } from '../src/engines/clock.ts';
import { promoteIfEligible, recordEvidence } from '../src/engines/evidence.ts';
import { deserializeCard, getReviewItem, review } from '../src/engines/fsrs.ts';
import { insertUnit } from '../src/store/content.ts';

export { DAY_MS };

/** Local-noon date (DST/timezone-proof day arithmetic in tests). */
export function localNoon(y: number, m1: number, d: number): Date {
  return new Date(y, m1 - 1, d, 12, 0, 0, 0);
}

export interface TempDb {
  db: Db;
  dir: string;
  path: string;
  cleanup(): void;
}

/** A fresh, migrated DB in its own OS temp dir. Never the owner's DB. */
export function makeTempDb(): TempDb {
  const dir = mkdtempSync(join(tmpdir(), 'bootquest-test-'));
  const path = join(dir, 'test.db');
  const db = openDb({ path, env: {} });
  return {
    db,
    dir,
    path,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

export type TestClock = ReturnType<typeof fixedClock>;

/** Per-test temp DB + clock fixed at 2026-10-01 12:00 local. */
export function useTempDb() {
  const ctx = {} as { db: Db; clock: TestClock; tmp: TempDb };
  beforeEach(() => {
    ctx.tmp = makeTempDb();
    ctx.db = ctx.tmp.db;
    ctx.clock = fixedClock(localNoon(2026, 10, 1));
  });
  afterEach(() => {
    ctx.tmp.cleanup();
  });
  return ctx;
}

/** A minimal valid check spec for each unit kind that has one (reading has none). */
const DEFAULT_CHECK: Record<string, CheckSpecInput | null> = {
  drill: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.ok(true)' }] },
  quiz: { type: 'quiz', itemKey: 'q', grading: 'choice', answerKey: 0, choices: ['a', 'b'] },
  'predict-output': { type: 'predict-output', language: 'js', expected: 'x' },
  'guided-project': { type: 'guided-step', step: 1, testFile: 'practice/checks/step1.test.mjs', runner: 'node-test' },
  'http-lab': { type: 'http', requests: [{ name: 'get x', method: 'GET', path: '/x', expect: { status: 200 } }] },
  'repo-task': { type: 'repo', predicates: [{ kind: 'branch-exists', name: 'feature branch', branch: 'feat/x' }] },
  study: { type: 'study-quiz', itemKeys: ['a'] },
  reading: null,
  'explain-back': { type: 'explain-back', questionSetKey: 'eb:x' },
  'patch-kata': { type: 'patch-kata', kataKey: 'kata:x', defectCount: 1 },
  review: { type: 'review', cardKey: 'card:x' },
  'program-unit': { type: 'node-test-file', checkPath: 'practice/checks/u.test.mjs', learnerPath: 'practice/learner/u.mjs', sha: 'abc1234' },
  retest: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.ok(true)' }] },
};

let seq = 0;
/** Insert a minimal unit (default: a difficulty-2 js drill with a drill-js check); returns its id. */
export function makeUnit(
  db: Db,
  clock: () => Date,
  over: {
    key?: string;
    kind?: string;
    difficulty?: number;
    track?: string;
    variationOf?: string;
    competencies?: string[];
    prerequisites?: string[];
    noCheck?: boolean;
  } = {},
): number {
  seq += 1;
  const kind = over.kind ?? 'drill';
  const check = over.noCheck ? null : (DEFAULT_CHECK[kind] ?? null);
  return insertUnit(
    db,
    {
      key: over.key ?? `test:unit-${seq}`,
      track: over.track ?? 'js',
      kind,
      title: `fixture unit ${seq}`,
      difficulty: over.difficulty ?? 2,
      competencies: over.competencies ?? [],
      prerequisites: over.prerequisites ?? [],
      ...(over.variationOf ? { variationOf: over.variationOf } : {}),
      checks: check ? [{ spec: check }] : [],
    },
    clock,
  );
}

export function unitKey(db: Db, unitId: number): string {
  return db.get<{ key: string }>('SELECT key FROM unit WHERE id = ?', unitId)!.key;
}

export const PASS = { pass: true, output: '', failures: [], durationMs: 1 } as const;
export const FAIL = { pass: false, output: '', failures: [{ name: 't', message: 'nope' }], durationMs: 1 } as const;

/** Record a graded submit on the unit's primary check (the runner verdict is simulated). */
export function submit(db: Db, clock: () => Date, unitId: number, o: { pass?: boolean; selfAssisted?: boolean } = {}): AttemptRow {
  const check = db.get<{ id: number }>('SELECT id FROM "check" WHERE unit_id = ? ORDER BY id LIMIT 1', unitId);
  if (!check) throw new Error(`unit ${unitId} has no check`);
  return recordSubmission(
    db,
    { unitId, checkId: check.id, selfAssisted: o.selfAssisted ?? false, result: o.pass === false ? FAIL : PASS },
    clock,
  ).attempt;
}

/** Stored explain-back answer + self-scored coverage evidence. */
export function explainBack(db: Db, clock: () => Date, unitId: number, competency: CompetencyId, coverage: number, selfAssisted = false) {
  const attempt = recordAttempt(db, { unitId, answer: { q1: 'fixture answer' }, selfAssisted }, clock);
  const evidence = recordEvidence(
    db,
    { competency, kind: 'explain-back', intention: 'explain with code hidden', observation: `${coverage * 100}% covered`, score: coverage, attemptId: attempt.id },
    clock,
  );
  return { attempt, evidence };
}

export interface LegOpts {
  artifact?: 'ok' | 'missing' | 'self-assisted' | 'failed';
  coverage?: number | null; // null = no explain-back
  retestDelayMs?: number | null; // null = no retest
  retest?: 'ok' | 'self-assisted' | 'revealed' | 'failed';
}

/**
 * Build one linked promotion chain for a competency through the real engine
 * paths: guided-project unit -> verified artifact -> explain-back on that unit
 * -> (delay) -> verified retest on a variation of that unit.
 */
export function buildLegs(db: Db, clock: TestClock, competency: CompetencyId, o: LegOpts = {}) {
  const artifactMode = o.artifact ?? 'ok';
  const coverage = o.coverage === undefined ? 0.85 : o.coverage;
  const delay = o.retestDelayMs === undefined ? 2 * DAY_MS : o.retestDelayMs;
  const retestMode = o.retest ?? 'ok';

  seq += 1;
  const key = `fixture:${competency}:${seq}`;
  const unitId = makeUnit(db, clock, { key, kind: 'guided-project', competencies: [competency] });
  const retestUnitId = makeUnit(db, clock, { kind: 'retest', variationOf: key, competencies: [competency] });
  const ids: { unitId: number; retestUnitId: number; artifact?: number; explainBack?: number; retest?: number } = { unitId, retestUnitId };

  if (artifactMode !== 'missing') {
    const attempt = submit(db, clock, unitId, { pass: artifactMode !== 'failed', selfAssisted: artifactMode === 'self-assisted' });
    ids.artifact = recordEvidence(
      db,
      { competency, kind: 'artifact', intention: 'ship the CLI-verified project', observation: 'check result', attemptId: attempt.id },
      clock,
    ).id;
  }
  if (coverage !== null) ids.explainBack = explainBack(db, clock, unitId, competency, coverage).evidence.id;
  if (delay !== null) {
    clock.advance(delay);
    if (retestMode === 'revealed') revealSolution(db, retestUnitId, clock);
    const attempt = submit(db, clock, retestUnitId, { pass: retestMode !== 'failed', selfAssisted: retestMode === 'self-assisted' });
    ids.retest = recordEvidence(
      db,
      { competency, kind: 'retest', intention: 'changed-example retest', observation: 'retest result', attemptId: attempt.id },
      clock,
    ).id;
  }
  return ids;
}

/** Raise a competency to `target` legitimately (one full linked chain per notch). */
export function promoteTo(db: Db, clock: TestClock, competency: CompetencyId, target: number): void {
  const current = () => db.get<{ rating: number }>('SELECT rating FROM competency_rating WHERE competency_id = ?', competency)!.rating;
  while (current() < target) {
    clock.advance(1000);
    buildLegs(db, clock, competency);
    if (!promoteIfEligible(db, competency, clock)) throw new Error(`fixture promotion of ${competency} failed`);
  }
}

/** Review a card Good at each due date until it is in FSRS Review state, then move the clock to its next due. */
export function graduate(db: Db, clock: TestClock, itemId: number): void {
  const state = () => deserializeCard(getReviewItem(db, itemId).fsrs_state).state;
  for (let i = 0; i < 6 && state() !== State.Review; i++) {
    clock.set(Math.max(clock().getTime(), getReviewItem(db, itemId).due_at));
    review(db, itemId, 'good', clock);
  }
  if (state() !== State.Review) throw new Error(`card ${itemId} did not graduate`);
  clock.set(getReviewItem(db, itemId).due_at);
}
