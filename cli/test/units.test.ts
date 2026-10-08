import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_TYPES } from '@bootquest/shared';
import { MAX_CODE_CHARS as SHARED_MAX } from '@bootquest/shared/api';
import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError } from '../src/client.ts';
import { MAX_CODE_CHARS } from '../src/program.ts';
import { BROWSER_CHECKS, classifyUnit, CODE_CHECKS, PENDING_CLI_CHECKS, resolveUnit } from '../src/units.ts';
import { drillDetail, fakeFetch, quizDetail } from './helpers.ts';

describe('unit-kind decision table', () => {
  it('every shared CHECK_TYPE is classified exactly once (new types force a decision here)', () => {
    for (const t of CHECK_TYPES) {
      const hits = [CODE_CHECKS, BROWSER_CHECKS, PENDING_CLI_CHECKS].filter((s) => s.has(t)).length;
      expect(hits, t).toBe(1);
    }
  });

  it('drill-js is delivered as code; quiz is refused as browser material', () => {
    expect(classifyUnit(drillDetail(), 'submit')).toEqual({ mode: 'code', checkType: 'drill-js' });
    const q = classifyUnit(quizDetail(), 'submit');
    expect(q.mode).toBe('refuse');
  });

  it('check-less units (written/reading) are refused', () => {
    const d = { ...drillDetail({ kind: 'written' }), check: null };
    const r = classifyUnit(d, 'submit');
    expect(r.mode === 'refuse' && r.reason).toMatch(/no machine check.*web app/);
  });

  it('http / repo / guided-step are refused as "not wired yet", never guessed', () => {
    const d = { ...drillDetail({ kind: 'http-lab' }), check: { id: 1, threshold: null, spec: { type: 'http' as const, requests: [], timeoutMs: 1 } } };
    const r = classifyUnit(d, 'submit');
    expect(r.mode === 'refuse' && r.reason).toMatch(/does not accept http submissions yet.*Nothing was sent/);
  });

  it('the CLI size guard matches the API contract', () => {
    expect(MAX_CODE_CHARS).toBe(SHARED_MAX);
  });
});

describe('resolveUnit', () => {
  it('unitKey: lists tracks + units, matches the key, then fetches the detail', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /api/tracks': { status: 200, body: { tracks: [{ id: 'csharp' }, { id: 'js' }] } },
      'GET /api/tracks/csharp/units': { status: 200, body: { units: [{ id: 1, key: 'other' }] } },
      'GET /api/tracks/js/units': { status: 200, body: { units: [{ id: 12, key: 'bootforge/js-fundamentals/values/variables/swap' }] } },
      'GET /api/units/12': { status: 200, body: drillDetail() },
    });
    const d = await resolveUnit(new ApiClient('http://h:1', fetch), { unitKey: 'bootforge/js-fundamentals/values/variables/swap', path: 'p' });
    expect(d.unit.id).toBe(12);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/api/tracks', '/api/tracks/csharp/units', '/api/tracks/js/units', '/api/units/12']);
  });

  it('unknown key / id -> NOT_FOUND ApiError naming the config file', async () => {
    const { fetch } = fakeFetch({ 'GET /api/tracks': { status: 200, body: { tracks: [] } } });
    const c = new ApiClient('http://h:1', fetch);
    await expect(resolveUnit(c, { unitKey: 'nope', path: 'X/.bootquest.json' })).rejects.toThrow(/no unit with key "nope".*X\/\.bootquest\.json/);
    await expect(resolveUnit(c, { unitId: 99, path: 'X/.bootquest.json' })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('never prints solutions', () => {
  it('no CLI source references a solution-revealing route or field', () => {
    const src = join(fileURLToPath(new URL('../src/', import.meta.url)));
    for (const f of readdirSync(src)) {
      const text = readFileSync(join(src, f), 'utf8');
      // comments may name the routes the CLI avoids; code must not request them
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/\/reveal|\/solution|\/model-answer|\.solution\b|modelAnswer/);
    }
  });
});
