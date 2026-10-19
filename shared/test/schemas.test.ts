import { describe, expect, it } from 'vitest';
import {
  CHECK_SPEC_TYPES,
  CHECK_TYPES,
  AttemptInput,
  CheckSpec,
  ContentRef,
  EvidenceInput,
  ExerciseSpec,
  LessonSpec,
  QuizCheck,
  RunnerResult,
  XpAwardInput,
  XpEvent,
} from '../src/index.ts';

/** One valid minimal spec per check type. */
const VALID: Record<(typeof CHECK_TYPES)[number], unknown> = {
  'drill-js': { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.equal(mod.f(), 1)' }] },
  'drill-cs': { type: 'drill-cs', shape: 'xunit', files: { tests: 'public class T { [Fact] public void A() => Assert.True(true); }' } },
  'drill-java': { type: 'drill-java', files: { tests: '    // ─── tests ───\n    public static void main(String[] a) { System.exit(report()); }\n    // ─── end tests ───\n' } },
  quiz: { type: 'quiz', itemKey: 'q1', grading: 'choice', answerKey: 1, choices: ['a', 'b'] },
  'predict-output': { type: 'predict-output', language: 'js', expected: 'object\nundefined' },
  'guided-step': { type: 'guided-step', step: 1, testFile: 'practice/checks/step1.test.mjs', runner: 'node-test' },
  http: { type: 'http', requests: [{ name: 'list tasks', method: 'GET', path: '/api/tasks', expect: { status: 200, jsonShape: { object: { items: 'array' } } } }] },
  repo: {
    type: 'repo',
    predicates: [
      { kind: 'branch-exists', name: 'feature branch', branch: 'feat/x' },
      { kind: 'pr-has-section', name: 'PR testing notes', heading: 'Testing' },
    ],
  },
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

  it.each(Object.entries(VALID))('is strict: a misspelled key on a %s spec is an error, never silently stripped', (_type, spec) => {
    const r = CheckSpec.safeParse({ ...(spec as object), timeoutMS: 5000 });
    expect(r.success).toBe(false);
    expect(r.success ? '' : r.error.issues.map((i) => i.message).join('; ')).toMatch(/Unrecognized key\(s\) in object: 'timeoutMS'/);
  });

  it('is strict where a typo used to change behaviour silently (keyTokens, harness, nested test objects)', () => {
    expect(CheckSpec.safeParse({ ...(VALID['predict-output'] as object), keytokens: ['x'] }).success).toBe(false);
    expect(CheckSpec.safeParse({ ...(VALID['drill-cs'] as object), harnes: 'jstrain' }).success).toBe(false);
    expect(CheckSpec.safeParse({ type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'x', inputs: 1 }] }).success).toBe(false);
  });

  it("QuizCheck invariant: grading 'choice' needs choices and a numeric answerKey inside them", () => {
    expect(CheckSpec.safeParse({ type: 'quiz', itemKey: 'q', grading: 'choice', answerKey: 1 }).success).toBe(false);
    expect(CheckSpec.safeParse({ type: 'quiz', itemKey: 'q', grading: 'choice', answerKey: 'b', choices: ['a', 'b'] }).success).toBe(false);
    expect(CheckSpec.safeParse({ type: 'quiz', itemKey: 'q', grading: 'choice', answerKey: 2, choices: ['a', 'b'] }).success).toBe(false);
    expect(QuizCheck.safeParse({ type: 'quiz', itemKey: 'q', grading: 'choice', answerKey: 1 }).success).toBe(false);
    expect(QuizCheck.safeParse(VALID.quiz).success).toBe(true);
    // exact / self grading keep their text keys
    expect(CheckSpec.safeParse({ type: 'quiz', itemKey: 'q', grading: 'exact', answerKey: 'forty-two' }).success).toBe(true);
  });

  it('rejects unknown types, path escapes, and malformed specs', () => {
    expect(CheckSpec.safeParse({ type: 'docker' }).success).toBe(false);
    expect(CheckSpec.safeParse({ ...(VALID['node-test-file'] as object), checkPath: '../../etc/passwd' }).success).toBe(false);
    expect(CheckSpec.safeParse({ ...(VALID['self-run'] as object), file: 'C:/abs/file.js' }).success).toBe(false);
    expect(CheckSpec.safeParse({ type: 'drill-js', language: 'js', tests: [] }).success).toBe(false);
    expect(CheckSpec.safeParse({ type: 'http', requests: [{ name: 'r', method: 'GET', path: 'no-slash', expect: { status: 200 } }] }).success).toBe(false);
  });

  it('http: rejects protocol-relative / backslash / whitespace paths, a Host header, duplicate names, unknown fields', () => {
    const req = (over: object) => ({ type: 'http', requests: [{ name: 'r', method: 'GET', path: '/x', expect: { status: 200 }, ...over }] });
    expect(CheckSpec.safeParse(req({})).success).toBe(true);
    expect(CheckSpec.safeParse(req({ path: '/api/tasks?done=1&x=%20' })).success).toBe(true);
    for (const path of ['//evil.example/x', '/a\\b', '/a b', '/x#frag', 'http://evil.example/']) {
      expect(CheckSpec.safeParse(req({ path })).success, path).toBe(false);
    }
    expect(CheckSpec.safeParse(req({ headers: { Host: 'evil.example' } })).success).toBe(false);
    expect(CheckSpec.safeParse(req({ expect: { status: 200, extra: 1 } })).success).toBe(false);
    const dup = { type: 'http', requests: [{ name: 'a', method: 'GET', path: '/x', expect: { status: 200 } }, { name: 'a', method: 'GET', path: '/y', expect: { status: 200 } }] };
    expect(CheckSpec.safeParse(dup).success).toBe(false);
    // timeouts default: 5s per request, 30s total
    expect(CheckSpec.parse(req({}))).toMatchObject({ timeoutMs: 5000, totalTimeoutMs: 30000 });
  });

  it('http jsonShape: the small structural grammar parses, junk does not', () => {
    const withShape = (jsonShape: unknown) => ({ type: 'http', requests: [{ name: 'r', method: 'GET', path: '/x', expect: { status: 200, jsonShape } }] });
    const ok = [
      'any',
      'integer',
      { equals: null },
      { equals: 'ok' },
      { object: { id: 'integer', tags: { array: 'string', minItems: 1 }, meta: { object: { v: { equals: 2 } } } } },
      { array: { object: { id: 'number' } } },
    ];
    for (const s of ok) expect(CheckSpec.safeParse(withShape(s)).success, JSON.stringify(s)).toBe(true);
    const bad = ['float', { equals: { a: 1 } }, { object: { a: 'nope' } }, { array: 'string', minItems: -1 }, { object: {}, extra: 1 }, { items: 'array' }];
    for (const s of bad) expect(CheckSpec.safeParse(withShape(s)).success, JSON.stringify(s)).toBe(false);
  });

  it('repo: every predicate kind parses; bad branch names / regexes / duplicate names are rejected', () => {
    const all = {
      type: 'repo',
      predicates: [
        { kind: 'branch-exists', name: 'a', branch: 'feat/add-tasks' },
        { kind: 'head-on-branch', name: 'b', branch: 'main' },
        { kind: 'file-exists-at-head', name: 'c', path: 'docs/ADR-001.md' },
        { kind: 'clean-worktree', name: 'd' },
        { kind: 'min-commits', name: 'e', n: 3, branch: 'feat/add-tasks' },
        { kind: 'commit-message-matches', name: 'f', pattern: '^feat(\\(.+\\))?: ', flags: 'm', which: 'any' },
        { kind: 'ci-green', name: 'g' },
        { kind: 'pr-has-section', name: 'h', heading: 'Testing', branch: 'feat/add-tasks' },
      ],
    };
    const parsed = CheckSpec.parse(all);
    expect(parsed).toMatchObject({ timeoutMs: 15000 });
    const one = (p: object) => ({ type: 'repo', predicates: [p] });
    for (const branch of ['-rf', 'a..b', 'a//b', 'x/', 'x.lock', 'has space', 'C:/abs']) {
      expect(CheckSpec.safeParse(one({ kind: 'branch-exists', name: 'n', branch })).success, branch).toBe(false);
    }
    expect(CheckSpec.safeParse(one({ kind: 'commit-message-matches', name: 'n', pattern: '(' })).success).toBe(false);
    expect(CheckSpec.safeParse(one({ kind: 'file-exists-at-head', name: 'n', path: '../outside' })).success).toBe(false);
    expect(CheckSpec.safeParse(one({ kind: 'branch-exists', branch: 'x' })).success).toBe(false); // name required
    expect(CheckSpec.safeParse({ type: 'repo', predicates: [{ kind: 'clean-worktree', name: 'n' }, { kind: 'ci-green', name: 'n' }] }).success).toBe(false);
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
  it('XP claims are anchored on an attempt; difficulty / track / review are never caller-supplied', () => {
    expect(XpAwardInput.safeParse({ kind: 'code', attemptId: 3 }).success).toBe(true);
    expect(XpAwardInput.safeParse({ kind: 'code' }).success).toBe(false); // no unit-less / attempt-less awards
    expect(XpAwardInput.safeParse({ kind: 'explain-back' }).success).toBe(false);
    expect(XpAwardInput.safeParse({ kind: 'code', attemptId: 3, difficulty: 5 }).success).toBe(false);
    expect(XpAwardInput.safeParse({ kind: 'code', attemptId: 3, trackId: 'js' }).success).toBe(false);
    expect(XpAwardInput.safeParse({ kind: 'review', attemptId: 3 }).success).toBe(false); // paid by fsrs.review() only
    expect(XpAwardInput.safeParse({ kind: 'bonus', attemptId: 3 }).success).toBe(false);
  });

  it('xp event rows validate', () => {
    expect(
      XpEvent.safeParse({ id: 1, kind: 'review', amount: 0, reason: 'daily-cap', unitId: null, attemptId: null, trackId: null, day: '2026-10-01', createdAt: 0 }).success,
    ).toBe(true);
    expect(XpEvent.safeParse({ id: 1, kind: 'review', amount: -1, reason: null, unitId: null, attemptId: null, trackId: null, day: '2026-10-01', createdAt: 0 }).success).toBe(false);
  });

  it('evidence input: no verified / assessor / assistance; linked kinds need an attempt; engine-only kinds refused', () => {
    const base = { competency: 'communication', intention: 'i', observation: 'o' };
    expect(EvidenceInput.safeParse({ ...base, kind: 'explain-back', score: 0.9, attemptId: 1 }).success).toBe(true);
    expect(EvidenceInput.safeParse({ ...base, kind: 'explain-back', score: 0.9 }).success).toBe(false); // no attempt
    expect(EvidenceInput.safeParse({ ...base, kind: 'explain-back', attemptId: 1 }).success).toBe(false); // no score
    expect(EvidenceInput.safeParse({ ...base, kind: 'explain-back', score: 1.2, attemptId: 1 }).success).toBe(false);
    expect(EvidenceInput.safeParse({ ...base, kind: 'artifact', attemptId: 1 }).success).toBe(true);
    expect(EvidenceInput.safeParse({ ...base, kind: 'artifact', attemptId: 1, verified: true }).success).toBe(false);
    expect(EvidenceInput.safeParse({ ...base, kind: 'artifact', attemptId: 1, assessor: 'pipeline' }).success).toBe(false);
    expect(EvidenceInput.safeParse({ ...base, kind: 'artifact', attemptId: 1, assistance: 'none' }).success).toBe(false);
    expect(EvidenceInput.safeParse({ ...base, kind: 'artifact', attemptId: 1, score: 1 }).success).toBe(false);
    expect(EvidenceInput.safeParse({ ...base, kind: 'retest' }).success).toBe(false);
    for (const kind of ['promotion', 'demotion', 'review']) {
      expect(EvidenceInput.safeParse({ ...base, kind, attemptId: 1 }).success, kind).toBe(false);
    }
    expect(EvidenceInput.safeParse({ ...base, kind: 'self-assessment', rating: 4 }).success).toBe(true);
    expect(EvidenceInput.safeParse({ ...base, kind: 'artifact', attemptId: 1, rating: 4 }).success).toBe(false);
  });

  it('attempt input stores answers only: graded outcomes cannot be chosen', () => {
    expect(AttemptInput.safeParse({ unitId: 1, answer: { q1: 'x' } }).success).toBe(true);
    expect(AttemptInput.safeParse({ unitId: 1 }).success).toBe(false);
    expect(AttemptInput.safeParse({ unitId: 1, answer: 'x', outcome: 'pass' }).success).toBe(false);
  });

  it('lesson contentRef is a (repo, stableKey) pair, never a bare key', () => {
    const u = { key: 'k', track: 'js', kind: 'reading', title: 't' };
    expect(LessonSpec.safeParse({ ...u, contentRef: { repo: 'elirc/ww12', stableKey: 'h:x' } }).success).toBe(true);
    expect(LessonSpec.safeParse({ ...u, contentRef: 'h:x' }).success).toBe(false);
    expect(LessonSpec.safeParse({ ...u, phase: 'P1', xp: 120, targetLevel: 3 }).success).toBe(true);
  });
});
