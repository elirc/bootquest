/** campaign 2 (OPS review): the GET /units check-spec table cache (F7: moved to server/src/sync/carve-outs.ts). */
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckSpec } from '@bootquest/shared';
import { cachedCheckSpecTable, checkTableCacheStats, uncoveredLegsFor } from '../src/sync/carve-outs.ts';
import { CHECK_SPECS } from './sync-helpers.ts';

describe('cachedCheckSpecTable', () => {
  let dir: string;
  let path: string;
  let reports: string[];
  const report = (l: string) => reports.push(l);
  const bump = (secondsAhead: number) => {
    const t = new Date(Date.now() + secondsAhead * 1000);
    utimesSync(path, t, t);
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bq-table-cache-'));
    path = join(dir, 'check-specs.json');
    writeFileSync(path, readFileSync(CHECK_SPECS));
    reports = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('parses once per file version and re-parses when the file changes', () => {
    const p0 = checkTableCacheStats.parses;
    const a = cachedCheckSpecTable(path, report);
    expect(a?.repos['elirc/signalpost-swe-bootcamp']?.units.U03?.tsc_project).toBe('practice/tsconfig.json');
    expect(cachedCheckSpecTable(path, report)).toBe(a); // same object: no re-read
    expect(checkTableCacheStats.parses).toBe(p0 + 1);
    const t = JSON.parse(readFileSync(path, 'utf8')) as { repos: Record<string, { units: Record<string, { uncovered_legs?: string[] }> }> };
    t.repos['elirc/signalpost-swe-bootcamp']!.units.U01!.uncovered_legs = ['a new carve-out'];
    writeFileSync(path, JSON.stringify(t));
    bump(5);
    const b = cachedCheckSpecTable(path, report);
    expect(checkTableCacheStats.parses).toBe(p0 + 2);
    expect(b?.repos['elirc/signalpost-swe-bootcamp']?.units.U01?.uncovered_legs).toEqual(['a new carve-out']);
    expect(reports).toEqual([]);
  });

  it('a malformed table is reported LOUDLY exactly once per version (never per request), returns null, and recovers when fixed', () => {
    writeFileSync(path, '{ "repos": 42 }');
    bump(10);
    const r0 = checkTableCacheStats.malformedReports;
    expect(cachedCheckSpecTable(path, report)).toBeNull();
    expect(cachedCheckSpecTable(path, report)).toBeNull();
    expect(cachedCheckSpecTable(path, report)).toBeNull();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatch(/MALFORMED/);
    expect(checkTableCacheStats.malformedReports).toBe(r0 + 1);
    writeFileSync(path, readFileSync(CHECK_SPECS));
    bump(20);
    expect(cachedCheckSpecTable(path, report)).not.toBeNull();
    expect(reports).toHaveLength(1);
  });

  it('a missing table is null and silent', () => {
    expect(cachedCheckSpecTable(join(dir, 'nope.json'), report)).toBeNull();
    expect(reports).toEqual([]);
  });
});

describe('uncoveredLegsFor (F7: carve-outs judged in sync/, failures reported once per table version)', () => {
  let dir: string;
  let path: string;
  let reports: string[];
  const report = (l: string) => reports.push(l);
  const SP = 'elirc/signalpost-swe-bootcamp';
  const U01 = 'gh:' + SP + ':U01';
  const U03 = 'gh:' + SP + ':U03';
  const U09 = 'gh:' + SP + ':U09';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bq-carve-'));
    path = join(dir, 'check-specs.json');
    const t = JSON.parse(readFileSync(CHECK_SPECS, 'utf8')) as { repos: Record<string, { units: Record<string, { uncovered_legs?: string[] }> }> };
    t.repos[SP]!.units.U01!.uncovered_legs = ['U01-02 leg A is reviewed by hand'];
    writeFileSync(path, JSON.stringify(t));
    reports = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('surfaces the recorded uncovered legs of a program unit; non-program keys, unknown units and no table are undefined', () => {
    expect(uncoveredLegsFor(path, U01, undefined, report)).toEqual(['U01-02 leg A is reviewed by hand']);
    expect(uncoveredLegsFor(path, 'js/basics/01', undefined, report)).toBeUndefined();
    expect(uncoveredLegsFor(path, U09, undefined, report)).toBeUndefined();
    expect(uncoveredLegsFor(null, U01, undefined, report)).toBeUndefined();
    expect(reports).toEqual([]);
  });

  it('a registered check the table cannot be compared with never breaks detail, and is reported LOUDLY once per table version (not per request)', () => {
    // same tsc_project as the table, so the full-spec comparison runs, and CheckSpec.parse refuses the broken registered spec
    const broken = { spec: { type: 'node-test-file', tscProject: 'practice/tsconfig.json' } as unknown as CheckSpec };
    const r0 = checkTableCacheStats.carveOutErrorReports;
    for (let i = 0; i < 3; i++) expect(uncoveredLegsFor(path, U03, broken, report)).toBeUndefined();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain(`could not judge the uncovered-leg carve-outs of ${U03}`);
    expect(checkTableCacheStats.carveOutErrorReports).toBe(r0 + 1);
    // a new table version is a new report
    writeFileSync(path, readFileSync(CHECK_SPECS));
    const t = new Date(Date.now() + 30_000);
    utimesSync(path, t, t);
    expect(uncoveredLegsFor(path, U03, broken, report)).toBeUndefined();
    expect(uncoveredLegsFor(path, U03, broken, report)).toBeUndefined();
    expect(reports).toHaveLength(2);
    expect(checkTableCacheStats.carveOutErrorReports).toBe(r0 + 2);
  });
});
