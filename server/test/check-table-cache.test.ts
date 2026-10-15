/** campaign 2 (OPS review): the GET /units check-spec table cache (server/src/api/service.ts). */
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cachedCheckSpecTable, checkTableCacheStats } from '../src/api/service.ts';
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
