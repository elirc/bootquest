import { describe, expect, it } from 'vitest';
import { CHECK_TYPES, CheckSpec } from '../src/index.ts';
import {
  PRIVATE_FIELD_NAMES,
  PUBLIC_CHECK_FIELDS,
  PUBLIC_NESTED_FIELDS,
  PublicCheck,
  PublicProjectionError,
  SubmissionBody,
  toPublicCheck,
  UnitDetailResponse,
} from '../src/api.ts';

const S = 'SECRET_MARKER';

/** One FULL (private) spec per check type, every private field carrying the marker. */
const FULL: Record<(typeof CHECK_TYPES)[number], unknown> = {
  'drill-js': { type: 'drill-js', language: 'js', tests: [{ name: 't1', code: `assert.equal(mod.f(), '${S}')`, input: S }] },
  'drill-cs': { type: 'drill-cs', shape: 'xunit', testFile: `${S}/Tests.cs` },
  quiz: { type: 'quiz', itemKey: 'q1', grading: 'exact', answerKey: S },
  'predict-output': { type: 'predict-output', language: 'js', expected: S },
  'guided-step': { type: 'guided-step', step: 1, testFile: `${S}/step1.test.mjs`, runner: 'node-test' },
  http: {
    type: 'http',
    requests: [{ method: 'POST', path: '/api/x', body: { s: S }, headers: { 'x-s': S }, expect: { status: 200, headers: { s: S } } }],
  },
  repo: { type: 'repo', predicates: [{ kind: 'branch-exists', branch: 'feat/x' }] },
  'study-quiz': { type: 'study-quiz', itemKeys: ['a'] },
  'explain-back': { type: 'explain-back', questionSetKey: 'eb:1' },
  'patch-kata': { type: 'patch-kata', kataKey: 'k:1', defectCount: 2 },
  review: { type: 'review', cardKey: 'c:1' },
  'node-test-file': {
    type: 'node-test-file',
    checkPath: `${S}/u01.test.mjs`,
    learnerPath: 'practice/learner/u01.mjs',
    sha: 'abcdef1',
    checkSha256: 'a'.repeat(64),
  },
  'self-run': { type: 'self-run', language: 'js', file: 'mod/verify.js', fixtures: [`${S}/f.json`] },
  'vitest-project': { type: 'vitest-project', project: 'p', testFile: `${S}/x.test.ts`, env: { K: S } },
};

function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.add(k), allKeys(x, out));
  return out;
}

describe('check-spec public/private split', () => {
  it('has a whitelist for every check type', () => {
    expect(Object.keys(PUBLIC_CHECK_FIELDS).sort()).toEqual([...CHECK_TYPES].sort());
  });

  for (const type of CHECK_TYPES) {
    it(`${type}: public projection leaks no private value or key`, () => {
      const full = CheckSpec.parse(FULL[type]);
      const pub = toPublicCheck(full);
      expect(pub.type).toBe(type);
      expect(JSON.stringify(pub)).not.toContain(S);
      const keys = allKeys(pub);
      for (const k of PRIVATE_FIELD_NAMES) expect(keys.has(k), `${type} exposes ${k}`).toBe(false);
      expect(PublicCheck.parse(pub)).toEqual(pub);
    });
  }

  it('the strict public schema rejects a smuggled private key', () => {
    expect(() => PublicCheck.parse({ type: 'quiz', itemKey: 'q', grading: 'exact', answerKey: 'x' })).toThrow();
    expect(() => PublicCheck.parse({ type: 'predict-output', language: 'js', normalize: true, expected: 'x' })).toThrow();
  });
});

/** Nested keys of every object reachable under a top-level public field, grouped as "<field>" -> keys. */
function nestedKeysByField(pub: Record<string, unknown>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [field, v] of Object.entries(pub)) {
    const objs = Array.isArray(v) ? v.filter((x) => typeof x === 'object' && x !== null) : typeof v === 'object' && v !== null ? [v] : [];
    for (const o of objs) {
      const set = out.get(field) ?? new Set<string>();
      for (const k of Object.keys(o as object)) set.add(k);
      out.set(field, set);
    }
  }
  return out;
}

describe('check-spec public projection is a DEEP whitelist (W1b review: repo.predicates gap)', () => {
  /** Explicit enumeration of every nested public field — changing it must be a deliberate edit here. */
  const ENUMERATED: Record<string, Record<string, string[]>> = {
    'drill-js': { tests: ['name'] },
    http: { requests: ['method', 'path'] },
    repo: { predicates: ['kind', 'branch', 'section', 'path'] },
  };

  it('PUBLIC_NESTED_FIELDS is exactly the enumerated nested whitelist', () => {
    expect(JSON.parse(JSON.stringify(PUBLIC_NESTED_FIELDS))).toEqual(ENUMERATED);
  });

  for (const type of CHECK_TYPES) {
    it(`${type}: every nested key in the public projection is enumerated`, () => {
      const pub = toPublicCheck(CheckSpec.parse(FULL[type])) as Record<string, unknown>;
      for (const [field, keys] of nestedKeysByField(pub)) {
        const allowed = ENUMERATED[type]?.[field];
        expect(allowed, `${type}.${field} holds objects but is not enumerated`).toBeDefined();
        for (const k of keys) expect(allowed, `${type}.${field}[].${k}`).toContain(k);
      }
    });
  }

  it('repo predicates: each variant keeps only its own fields; a smuggled nested field is dropped', () => {
    const smuggled = {
      type: 'repo',
      predicates: [
        { kind: 'branch-exists', branch: 'feat/x', token: S },
        { kind: 'ci-green', secretUrl: S },
        { kind: 'pr-has-section', section: 'Testing', expect: S },
        { kind: 'file-exists', path: 'docs/ADR.md', code: S },
      ],
    } as unknown as Parameters<typeof toPublicCheck>[0];
    const pub = toPublicCheck(smuggled);
    expect(pub).toEqual({
      type: 'repo',
      predicates: [
        { kind: 'branch-exists', branch: 'feat/x' },
        { kind: 'ci-green' },
        { kind: 'pr-has-section', section: 'Testing' },
        { kind: 'file-exists', path: 'docs/ADR.md' },
      ],
    });
    expect(JSON.stringify(pub)).not.toContain(S);
  });

  it('drill-js tests / http requests: smuggled nested fields are dropped too', () => {
    const drill = toPublicCheck({ type: 'drill-js', language: 'js', timeoutMs: 8000, tests: [{ name: 't', code: S, input: S, extra: S }] } as never);
    expect(drill).toEqual({ type: 'drill-js', language: 'js', timeoutMs: 8000, tests: [{ name: 't' }] });
    const http = toPublicCheck({ type: 'http', timeoutMs: 1, requests: [{ method: 'GET', path: '/x', note: S, expect: { status: 200 } }] } as never);
    expect(JSON.stringify(http)).not.toContain(S);
  });

  it('a public field that unexpectedly holds objects without a nested whitelist throws, never passes through', () => {
    expect(() => toPublicCheck({ type: 'quiz', itemKey: 'q', grading: 'choice', answerKey: 0, choices: [{ leak: S }, { leak: S }] } as never)).toThrow(PublicProjectionError);
    expect(() => toPublicCheck({ type: 'repo', predicates: [{ kind: 'branch-exists', branch: { nested: S } }] } as never)).toThrow(PublicProjectionError);
  });

  it('the strict public repo schema rejects an unknown nested key', () => {
    expect(() => PublicCheck.parse({ type: 'repo', predicates: [{ kind: 'branch-exists', branch: 'x', token: 'y' }] })).toThrow();
  });
});

describe('UnitDetailResponse public content fields', () => {
  const base = {
    unit: {
      id: 1, key: 'k', trackId: 'js', kind: 'quiz', title: 't', difficulty: 1, state: 'available', revealed: false,
      prerequisites: [], code: null, competencies: [], variationOfUnitId: null,
    },
    check: { id: 1, threshold: null, spec: { type: 'quiz', itemKey: 'k', grading: 'choice', choices: ['a', 'b'] } },
    instructions: 'Which one?',
    starter: null,
    snippet: null,
    rubric: null,
  };
  it('accepts instructions/snippet/rubric and rejects private content fields', () => {
    expect(UnitDetailResponse.parse(base)).toEqual(base);
    for (const leak of ['solution', 'explanation', 'hints', 'answerKey', 'expected']) {
      expect(UnitDetailResponse.safeParse({ ...base, [leak]: 'x' }).success, leak).toBe(false);
    }
  });
});

describe('SubmissionBody', () => {
  it('accepts exactly one of code/answer and nothing the server must derive', () => {
    expect(SubmissionBody.parse({ code: 'x' })).toEqual({ code: 'x', selfAssisted: false });
    expect(SubmissionBody.parse({ answer: 2, selfAssisted: true })).toEqual({ answer: 2, selfAssisted: true });
    for (const bad of [{}, { code: 'x', answer: 1 }, { answer: 1, verified: true }, { answer: 1, assessor: 'pipeline' }, { answer: 1, score: 1 }, { answer: 1, rating: 5 }, { answer: 1, difficulty: 5 }, { answer: 1, assistance: 'none' }]) {
      expect(SubmissionBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
