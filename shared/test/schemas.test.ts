import { describe, expect, it } from 'vitest';
import {
  CHECK_SPEC_TYPES,
  CHECK_TYPES,
  CheckSpec,
  ContentRef,
  EvidenceInput,
  ExerciseSpec,
  LessonSpec,
  RunnerResult,
  XpAwardInput,
  XpEvent,
} from '../src/index.ts';

/** One valid minimal spec per check type. */
const VALID: Record<(typeof CHECK_TYPES)[number], unknown> = {
  'drill-js': { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.equal(mod.f(), 1)' }] },
  'drill-cs': { type: 'drill-cs', shape: 'xunit', testFile: 'Tests.cs' },
  quiz: { type: 'quiz', itemKey: 'q1', grading: 'choice', answerKey: 1, choices: ['a', 'b'] },
  'predict-output': { type: 'predict-output', language: 'js', expected: 'object\nundefined' },
  'guided-step': { type: 'guided-step', step: 1, testFile: 'practice/checks/step1.test.mjs', runner: 'node-test' },
  http: { type: 'http', requests: [{ method: 'GET', path: '/api/tasks', expect: { status: 200, jsonShape: { items: 'array' } } }] },
  repo: { type: 'repo', predicates: [{ kind: 'branch-exists', branch: 'feat/x' }, { kind: 'pr-has-section', section: 'Testing' }] },
  'study-quiz': { type: 'study-quiz', itemKeys: ['a', 'b'] },
  'explain-back': { type: 'explain-back', questionSetKey: 'eb:u02' },
  'patch-kata': { type: 'patch-kata', kataKey: 'kata:unawaited-auth', defectCount: 2 },
  review: { type: 'review', cardKey: 'card:1' },
  'node-test-file': {
    type: 'node-test-file',
    checkPath: 'practice/checks/u01.test.mjs',
    learnerPath: 'practice/learner/u01.mjs',
    sha: 'abc1234',
  },
  'self-run': { type: 'self-run', language: 'js', file: 'bootcamp/24-debug-hunts/exercises/01-x.js', inverted: true },
  'vitest-project': { type: 'vitest-project', project: 'jstrain', testFile: 'js/01.test.js' },
};

describe('CheckSpec discriminated union', () => {
  it('covers exactly the CheckType enum', () => {
    expect([...CHECK_SPEC_TYPES].sort()).toEqual([...CHECK_TYPES].sort());
    for (const required of ['node-test-file', 'self-run', 'drill-js', 'explain-back', 'patch-kata', 'review']) {
      expect(CHECK_TYPES).toContain(required);
    }
  });

  it.each(Object.entries(VALID))('accepts a minimal %s spec', (_type, spec) => {
    expect(CheckSpec.safeParse(spec).success).toBe(true);
  });

  it('applies defaults (timeouts, 80% study pass mark, 80% explain-back coverage)', () => {
    expect(CheckSpec.parse(VALID['drill-js'])).toMatchObject({ timeoutMs: 8000 });
    expect(CheckSpec.parse(VALID['self-run'])).toMatchObject({ timeoutMs: 30000, tsc: false, fixtures: [] });
    expect(CheckSpec.parse(VALID['study-quiz'])).toMatchObject({ passPct: 0.8 });
    expect(CheckSpec.parse(VALID['explain-back'])).toMatchObject({ minCoverage: 0.8, questionCount: 3 });
  });

  it('rejects unknown types, path escapes, and malformed specs', () => {
    expect(CheckSpec.safeParse({ type: 'docker' }).success).toBe(false);
    expect(CheckSpec.safeParse({ ...(VALID['node-test-file'] as object), checkPath: '../../etc/passwd' }).success).toBe(false);
    expect(CheckSpec.safeParse({ ...(VALID['self-run'] as object), file: 'C:/abs/file.js' }).success).toBe(false);
    expect(CheckSpec.safeParse({ type: 'drill-js', language: 'js', tests: [] }).success).toBe(false);
    expect(CheckSpec.safeParse({ type: 'http', requests: [{ method: 'GET', path: 'no-slash', expect: { status: 200 } }] }).success).toBe(false);
  });
});

describe('RunnerResult', () => {
  it('accepts the §5 shape and the todo verdict', () => {
    expect(RunnerResult.safeParse({ pass: true, output: 'ok', failures: [], durationMs: 12 }).success).toBe(true);
    expect(
      RunnerResult.safeParse({ pass: false, output: '', failures: [], durationMs: 1, verdict: 'todo', counts: { passed: 1, failed: 0, todo: 3 } }).success,
    ).toBe(true);
  });

  it('rejects contradictions', () => {
    expect(RunnerResult.safeParse({ pass: true, output: '', failures: [], durationMs: 1, verdict: 'todo' }).success).toBe(false);
    expect(RunnerResult.safeParse({ pass: true, output: '', failures: [{ name: 'x', message: 'y' }], durationMs: 1 }).success).toBe(false);
    expect(RunnerResult.safeParse({ pass: true, output: '', failures: [], durationMs: -1 }).success).toBe(false);
  });
});

describe('ContentRef', () => {
  const base = {
    repo: 'elirc/signalpost-swe-bootcamp',
    path: 'docs/curriculum/program.json',
    sha: '1a8b3bf',
    anchor: 'milestones[code=U02].transfer',
    title: 'U02 transfer',
    stableKey: 'jp:milestones/U02/transfer',
    kind: 'program-unit',
    provenance: 'json-pointer',
  };

  it('accepts a reference and fills defaults', () => {
    expect(ContentRef.parse(base)).toMatchObject({ status: 'ok', summary: null, stableKeyAlgo: 1, lineStart: null });
  });

  it('is strict: no curriculum text fields', () => {
    expect(ContentRef.safeParse({ ...base, body: '# full lesson text' }).success).toBe(false);
  });

  it('requires owner/name repos (case and dots preserved) and sane line ranges', () => {
    expect(ContentRef.safeParse({ ...base, repo: 'elirc/jstrain2.2' }).success).toBe(true);
    expect(ContentRef.safeParse({ ...base, repo: 'jstrain2.2' }).success).toBe(false);
    expect(ContentRef.safeParse({ ...base, lineStart: 10, lineEnd: 9 }).success).toBe(false);
    expect(ContentRef.safeParse({ ...base, lineEnd: 9 }).success).toBe(false);
    expect(ContentRef.safeParse({ ...base, provenance: 'guessed' }).success).toBe(false);
  });
});

describe('LessonSpec / ExerciseSpec', () => {
  const drill = {
    key: 'bootforge:js:yes-no',
    track: 'js',
    kind: 'drill',
    title: 'yesNo',
    difficulty: 2,
    competencies: ['language-fluency'],
    checks: [{ spec: VALID['drill-js'] }],
  };

  it('accepts a drill with checks', () => {
    expect(ExerciseSpec.safeParse(drill).success).toBe(true);
  });

  it('drills need a difficulty; exercises need a check; no self-prerequisite; known competencies only', () => {
    const { difficulty: _d, ...noDiff } = drill;
    expect(LessonSpec.safeParse(noDiff).success).toBe(false);
    expect(ExerciseSpec.safeParse({ ...drill, checks: [] }).success).toBe(false);
    expect(LessonSpec.safeParse({ ...drill, prerequisites: [drill.key] }).success).toBe(false);
    expect(LessonSpec.safeParse({ ...drill, competencies: ['vibes'] }).success).toBe(false);
    expect(LessonSpec.safeParse({ ...drill, track: 'python' }).success).toBe(false);
  });
});

describe('XP and evidence inputs', () => {
  it('code XP needs a difficulty 1..5', () => {
    expect(XpAwardInput.safeParse({ kind: 'code' }).success).toBe(false);
    expect(XpAwardInput.safeParse({ kind: 'code', difficulty: 6 }).success).toBe(false);
    expect(XpAwardInput.safeParse({ kind: 'code', difficulty: 3 }).success).toBe(true);
    expect(XpAwardInput.safeParse({ kind: 'bonus' }).success).toBe(false);
  });

  it('xp event rows validate', () => {
    expect(
      XpEvent.safeParse({ id: 1, kind: 'review', amount: 0, reason: 'daily-cap', unitId: null, attemptId: null, trackId: null, day: '2026-10-01', createdAt: 0 }).success,
    ).toBe(true);
    expect(XpEvent.safeParse({ id: 1, kind: 'review', amount: -1, reason: null, unitId: null, attemptId: null, trackId: null, day: '2026-10-01', createdAt: 0 }).success).toBe(false);
  });

  it('promotion/demotion evidence cannot be written through the public input', () => {
    const base = { competency: 'communication', intention: 'i', observation: 'o', assessor: 'self' };
    expect(EvidenceInput.safeParse({ ...base, kind: 'explain-back', score: 0.9 }).success).toBe(true);
    expect(EvidenceInput.safeParse({ ...base, kind: 'promotion' }).success).toBe(false);
    expect(EvidenceInput.safeParse({ ...base, kind: 'explain-back', score: 1.2 }).success).toBe(false);
    expect(EvidenceInput.safeParse({ ...base, kind: 'artifact', assessor: 'llm' }).success).toBe(false);
  });
});
