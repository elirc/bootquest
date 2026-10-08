import { describe, expect, it } from 'vitest';
import { CHECK_TYPES, CheckSpec } from '../src/index.ts';
import { PRIVATE_FIELD_NAMES, PUBLIC_CHECK_FIELDS, PublicCheck, SubmissionBody, toPublicCheck } from '../src/api.ts';

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

describe('SubmissionBody', () => {
  it('accepts exactly one of code/answer and nothing the server must derive', () => {
    expect(SubmissionBody.parse({ code: 'x' })).toEqual({ code: 'x', selfAssisted: false });
    expect(SubmissionBody.parse({ answer: 2, selfAssisted: true })).toEqual({ answer: 2, selfAssisted: true });
    for (const bad of [{}, { code: 'x', answer: 1 }, { answer: 1, verified: true }, { answer: 1, assessor: 'pipeline' }, { answer: 1, score: 1 }, { answer: 1, rating: 5 }, { answer: 1, difficulty: 5 }, { answer: 1, assistance: 'none' }]) {
      expect(SubmissionBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
