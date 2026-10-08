import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_TYPES } from '@bootquest/shared';
import { MAX_CODE_CHARS as SHARED_MAX } from '@bootquest/shared/api';
import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError } from '../src/client.ts';
import { MAX_CODE_CHARS } from '../src/program.ts';
import { BROWSER_CHECKS, classifyUnit, CODE_CHECKS, PENDING_CLI_CHECKS, PROJECT_CHECKS, resolveUnit } from '../src/units.ts';
import { drillDetail, fakeFetch, httpDetail, quizDetail, repoDetail } from './helpers.ts';

describe('unit-kind decision table', () => {
  it('every shared CHECK_TYPE is classified exactly once (new types force a decision here)', () => {
    for (const t of CHECK_TYPES) {
      const hits = [CODE_CHECKS, PROJECT_CHECKS, BROWSER_CHECKS, PENDING_CLI_CHECKS].filter((s) => s.has(t)).length;
      expect(hits, t).toBe(1);
    }
  });

  it('W3c: http and repo moved from refused to DELIVERED (project checks); the rest of the pending group is unchanged', () => {
    expect([...PROJECT_CHECKS].sort()).toEqual(['http', 'repo']);
    expect([...PENDING_CLI_CHECKS].sort()).toEqual(['guided-step', 'node-test-file', 'self-run', 'vitest-project']);
    expect(classifyUnit(httpDetail(), 'submit')).toEqual({ mode: 'http', checkType: 'http', portHint: 3000 });
    expect(classifyUnit(httpDetail({ port: undefined }), 'run')).toEqual({ mode: 'http', checkType: 'http', portHint: null });
    expect(classifyUnit(repoDetail(), 'run')).toEqual({ mode: 'repo', checkType: 'repo' });
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

  it('guided-step (still pending) is refused as "not wired yet", never guessed', () => {
    const d = { ...drillDetail({ kind: 'guided-project' }), check: { id: 1, threshold: null, spec: { type: 'guided-step' as const, step: 1, runner: 'node-test', timeoutMs: 1 } } };
    const r = classifyUnit(d, 'submit');
    expect(r.mode === 'refuse' && r.reason).toMatch(/does not accept guided-step submissions yet.*Nothing was sent/);
  });

  it('the CLI size guard matches the API contract', () => {
    expect(MAX_CODE_CHARS).toBe(SHARED_MAX);
  });
});

describe('resolveUnit', () => {
  it('unitKey: ONE request to /units/by-key/<url-encoded key> (W3c; was N+2 track scans)', async () => {
    const key = 'bootforge/js-fundamentals/values/variables/swap';
    const { fetch, calls } = fakeFetch({
      [`GET /api/units/by-key/${encodeURIComponent(key)}`]: { status: 200, body: drillDetail() },
    });
    const d = await resolveUnit(new ApiClient('http://h:1', fetch), { unitKey: key, path: 'p' });
    expect(d.unit.id).toBe(12);
    expect(calls.map((c) => c.url)).toEqual([`http://h:1/api/units/by-key/bootforge%2Fjs-fundamentals%2Fvalues%2Fvariables%2Fswap`]);
  });

  it('unknown key / id -> NOT_FOUND ApiError naming the config file', async () => {
    const { fetch } = fakeFetch({});
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
