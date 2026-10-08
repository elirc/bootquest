import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILE_FLOOR_PCT,
  evaluateMutation,
  fileScorePct,
  floorPctFor,
  MutationReportError,
  OVERALL_BREAK_PCT,
  parseMutationReport,
} from '../src/mutation.ts';
import { ExplainBackAnswersBody, ExplainBackSelfScoreBody, KataFindingsBody, MutationMarkerBody } from '../src/api.ts';

const mutant = (status: string, line = 1, mutatorName = 'ConditionalExpression') => ({ id: String(Math.random()), status, mutatorName, replacement: 'false', location: { start: { line, column: 1 }, end: { line, column: 9 } } });

describe('mutation gate math (spike semantics)', () => {
  it('per-file score counts NoCoverage as a failure and ignores Ignored/CompileError/RuntimeError', () => {
    expect(fileScorePct({ path: 'a', killed: 3, timeout: 1, survived: 1, noCoverage: 3 })).toBe(50);
    expect(fileScorePct({ path: 'a', killed: 0, timeout: 0, survived: 0, noCoverage: 0 })).toBeNull();
    const r = parseMutationReport({
      files: {
        'src\\cart.js': { mutants: [mutant('Killed'), mutant('Timeout'), mutant('Survived', 7), mutant('NoCoverage', 9), mutant('Ignored'), mutant('CompileError'), mutant('RuntimeError')] },
      },
    });
    expect(r.files).toEqual([{ path: 'src/cart.js', killed: 1, timeout: 1, survived: 1, noCoverage: 1 }]);
    expect(r.survivors.map((s) => [s.path, s.line, s.status])).toEqual([
      ['src/cart.js', 7, 'Survived'],
      ['src/cart.js', 9, 'NoCoverage'],
    ]);
  });

  it('defaults: per-file floor 40, overall break 60', () => {
    expect(DEFAULT_FILE_FLOOR_PCT).toBe(40);
    expect(OVERALL_BREAK_PCT).toBe(60);
    expect(floorPctFor(null)).toBe(40);
    expect(floorPctFor(0.55)).toBe(55);
  });

  it('a gutted file fails the per-file floor even when the aggregate clears the break (the spike finding)', () => {
    const v = evaluateMutation([
      { path: 'cart.js', killed: 44, timeout: 0, survived: 1, noCoverage: 0 },
      { path: 'validator.js', killed: 50, timeout: 0, survived: 10, noCoverage: 0 },
      { path: 'slug.js', killed: 0, timeout: 0, survived: 12, noCoverage: 0 },
    ]);
    expect(v.overallPct).toBeGreaterThan(OVERALL_BREAK_PCT);
    expect(v.pass).toBe(false);
    expect(v.failures).toEqual(['slug.js: 0% < per-file floor 40%']);
  });

  it('the break is a second net; honest suites pass; an empty report fails', () => {
    expect(evaluateMutation([{ path: 'a', killed: 11, timeout: 0, survived: 9, noCoverage: 0 }]).failures).toEqual(['overall 55% < break 60%']);
    expect(evaluateMutation([{ path: 'a', killed: 41, timeout: 1, survived: 8, noCoverage: 0 }]).pass).toBe(true);
    expect(evaluateMutation([{ path: 'a', killed: 0, timeout: 0, survived: 0, noCoverage: 0 }]).pass).toBe(false);
  });

  it('rejects things that are not mutation-testing-elements reports', () => {
    expect(() => parseMutationReport({})).toThrow(MutationReportError);
    expect(() => parseMutationReport({ files: {} })).toThrow(/no files/);
    expect(() => parseMutationReport({ files: { a: { mutants: [{}] } } })).toThrow(/without a status/);
  });
});

describe('W6 request bodies are strict', () => {
  it('explain-back answers: exactly three non-empty answers, honor flag only', () => {
    expect(ExplainBackAnswersBody.safeParse({ answers: ['a', 'b', 'c'] }).success).toBe(true);
    expect(ExplainBackAnswersBody.safeParse({ answers: ['a', 'b'] }).success).toBe(false);
    expect(ExplainBackAnswersBody.safeParse({ answers: ['a', 'b', ' '] }).success).toBe(false);
    expect(ExplainBackAnswersBody.safeParse({ answers: ['a', 'b', 'c'], assistance: 'none' }).success).toBe(false);
  });

  it('self-scores accept only well-formed ids and the two marks', () => {
    expect(ExplainBackSelfScoreBody.safeParse({ perKeyPoint: { q1k1: 'covered', q3k6: 'missed' } }).success).toBe(true);
    expect(ExplainBackSelfScoreBody.safeParse({ perKeyPoint: { q1k1: 'partly' } }).success).toBe(false);
    expect(ExplainBackSelfScoreBody.safeParse({ perKeyPoint: { x: 'covered' } }).success).toBe(false);
  });

  it('kata findings need scenario + evidence + consequence, nothing else', () => {
    const f = { scenario: 's', evidence: 'e', consequence: 'c' };
    expect(KataFindingsBody.safeParse({ findings: [f] }).success).toBe(true);
    expect(KataFindingsBody.safeParse({ findings: [] }).success).toBe(false);
    expect(KataFindingsBody.safeParse({ findings: [{ ...f, fix: 'x' }] }).success).toBe(false);
    expect(KataFindingsBody.safeParse({ findings: [{ scenario: 's', evidence: 'e' }] }).success).toBe(false);
  });

  it('the mutation marker carries counts, never a verdict', () => {
    const base = { tool: 'stryker-js', toolVersion: '10.0.0', durationMs: 1, files: [{ path: 'a.js', killed: 1, timeout: 0, survived: 0, noCoverage: 0 }] };
    expect(MutationMarkerBody.safeParse(base).success).toBe(true);
    expect(MutationMarkerBody.safeParse({ ...base, pass: true }).success).toBe(false);
    expect(MutationMarkerBody.safeParse({ ...base, tool: 'pitest' }).success).toBe(false);
  });
});
