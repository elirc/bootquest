/**
 * campaign 2 release (F3): a learner's own @ts-nocheck / @ts-ignore / @ts-expect-error cannot
 * switch off a graded type-check leg (self-run TS drills; the node-test-file U03 composite).
 * Such a run/submit is refused (422 TYPECHECK_SUPPRESSED): the runner is never called and
 * nothing is recorded.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckSpec } from '@bootquest/shared';
import { createApp } from '../../src/api/app.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import type { Runner } from '../../src/api/runners.ts';
import { findTypeCheckSuppression } from '../../src/api/ts-directive-guard.ts';
import { fixedClock } from '../../src/engines/clock.ts';
import { insertUnit } from '../../src/store/content.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';
import { U03_SOLUTION } from '../sync-helpers.ts';

const JSTRAIN = fileURLToPath(new URL('../../../content/packs/jstrain/', import.meta.url));

interface PackUnit {
  unit: { key: string; checks?: { spec: CheckSpec }[] } & Record<string, unknown>;
}
interface Pack {
  units: PackUnit[];
  content: Record<string, { starter?: string; solution?: string }>;
}
const tsPacks = (): Pack[] =>
  readdirSync(JSTRAIN)
    .filter((f) => /^ts-.*\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(JSTRAIN + f, 'utf8')) as Pack);

const firstTsUnit = (): PackUnit['unit'] => {
  for (const p of tsPacks()) {
    for (const u of p.units) {
      const s = u.unit.checks?.[0]?.spec;
      if (s?.type === 'self-run' && s.language === 'ts' && s.tsc) return u.unit;
    }
  }
  throw new Error('no type-checked self-run unit in the jstrain packs');
};

const NTF_TSC: CheckSpec = {
  type: 'node-test-file',
  checkPath: 'practice/checks/u03.test.mjs',
  learnerPath: 'practice/learner/u03.ts',
  sha: 'a'.repeat(40),
  tsx: true,
  tscProject: 'practice/tsconfig.json',
  timeoutMs: 30000,
};
const NTF_PLAIN: CheckSpec = { ...NTF_TSC, tscProject: undefined } as CheckSpec;
const selfRunTs = (): CheckSpec => firstTsUnit().checks![0]!.spec;
const DIVIDER = '// ─────────────────────────── runtime tests ───────────────────────────────';

describe('findTypeCheckSuppression', () => {
  it('finds each directive form in the learner-editable code of a type-checked spec', () => {
    const spec = selfRunTs();
    for (const [code, directive] of [
      ['// @ts-nocheck\nexport const x = 1;\n', '@ts-nocheck'],
      ['const a = 1;\n// @ts-ignore\nconst b: string = a;\n', '@ts-ignore'],
      ['  //@ts-expect-error\nconst b: string = 1;\n', '@ts-expect-error'],
      ['/// @ts-ignore\nx;\n', '@ts-ignore'],
      ['/* @ts-ignore */ const b: string = 1;\n', '@ts-ignore'],
      ['/**\n * @ts-nocheck\n */\n', '@ts-nocheck'],
      ['/*\n   @ts-expect-error\n*/\n', '@ts-expect-error'],
      ['// @TS-IGNORE\n', '@ts-ignore'],
      // release review: whitespace and line breaks tsc honours but [ \t] / split('\n') missed
      ['//\v@ts-ignore\nconst b: string = 1;\n', '@ts-ignore'],
      ['//\f@ts-ignore\nconst b: string = 1;\n', '@ts-ignore'],
      ['//\u00A0@ts-ignore\nconst b: string = 1;\n', '@ts-ignore'],
      ['//\uFEFF@ts-ignore\nconst b: string = 1;\n', '@ts-ignore'],
      ['//\u00A0@ts-nocheck\n', '@ts-nocheck'],
      ['const y = 1; /* a\r@ts-ignore */\nconst b: string = 1;\n', '@ts-ignore'],
      ['const y = 1; /* a\u2028@ts-ignore */\nconst b: string = 1;\n', '@ts-ignore'],
      ['/* a\u2029 @ts-nocheck */\n', '@ts-nocheck'],
      ['/* a \u2028 @ts-expect-error */\nconst b: string = 1;\n', '@ts-expect-error'],
    ] as const) {
      expect(findTypeCheckSuppression(spec, code), code).toMatchObject({ directive });
    }
    expect(findTypeCheckSuppression(spec, 'const a = 1;\n\n// @ts-ignore\n')).toEqual({ directive: '@ts-ignore', line: 3 });
    expect(findTypeCheckSuppression(NTF_TSC, 'export const f = () => 1; // @ts-ignore\n')).toMatchObject({ directive: '@ts-ignore' });
  });

  it('ignores the protected tests (after the divider), prose that only mentions a directive, and specs without a tsc leg', () => {
    const spec = selfRunTs();
    // the shipped tests use @ts-expect-error probes; the learner's copy of them is replaced anyway
    expect(findTypeCheckSuppression(spec, `export const x = 1;\n${DIVIDER}\n// @ts-expect-error — probe\nformat(null);\n`)).toBeNull();
    expect(findTypeCheckSuppression(spec, '//  Reaching for any skips exactly what the @ts-expect-error probes catch.\n')).toBeNull();
    expect(findTypeCheckSuppression(spec, 'const s = "use @ts-ignore sparingly";\n')).toBeNull();
    expect(findTypeCheckSuppression(NTF_PLAIN, '// @ts-ignore\n')).toBeNull();
    expect(findTypeCheckSuppression({ ...spec, tsc: false } as CheckSpec, '// @ts-ignore\n')).toBeNull();
    expect(findTypeCheckSuppression({ type: 'drill-js', language: 'ts', tests: 'x' } as unknown as CheckSpec, '// @ts-nocheck\n')).toBeNull();
  });

  it('never refuses a SHIPPED starter or reference solution of any type-checked jstrain drill (no false positive blocks a real answer)', () => {
    let checked = 0;
    for (const p of tsPacks()) {
      for (const u of p.units) {
        const spec = u.unit.checks?.[0]?.spec;
        if (!spec || spec.type !== 'self-run' || spec.language !== 'ts' || !spec.tsc) continue;
        const c = p.content[u.unit.key] ?? {};
        for (const code of [c.starter, c.solution]) {
          if (code === undefined) continue;
          expect(findTypeCheckSuppression(spec, code), u.unit.key).toBeNull();
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('never refuses the signalpost U03 reference solution (the node-test-file tsc composite)', () => {
    expect(U03_SOLUTION.length).toBeGreaterThan(0);
    expect(findTypeCheckSuppression(NTF_TSC, U03_SOLUTION)).toBeNull();
  });
});

describe('POST /run and /submit refuse a suppressed type check (422 TYPECHECK_SUPPRESSED, nothing ran, nothing recorded)', () => {
  let tmp: TempDb;
  let app: Express;
  let calls: string[];
  let selfRunId: number;
  let ntfId: number;
  let ntfPlainId: number;
  const stub =
    (name: string): Runner =>
    async () => {
      calls.push(name);
      return { pass: false, output: '', failures: [{ name: 'stub', message: 'not graded here' }], durationMs: 1 };
    };
  const attempts = () => tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt')!.n;

  beforeEach(() => {
    tmp = makeTempDb();
    const clock = fixedClock(localNoon(2026, 10, 1));
    calls = [];
    selfRunId = insertUnit(tmp.db, firstTsUnit(), clock);
    const base = { track: 'js', kind: 'drill', difficulty: 2, competencies: ['language-fluency'] };
    ntfId = insertUnit(tmp.db, { ...base, key: 'fixture:ntf-tsc', title: 'U03 composite', checks: [{ spec: NTF_TSC }] }, clock);
    ntfPlainId = insertUnit(tmp.db, { ...base, key: 'fixture:ntf-plain', title: 'U01 plain', checks: [{ spec: NTF_PLAIN }] }, clock);
    app = createApp({ db: tmp.db, clock, runners: { 'self-run': stub('self-run'), 'node-test-file': stub('node-test-file') }, content: mapContentStore({}) });
  });
  afterEach(() => tmp.cleanup());

  it('self-run TS: a directive in the learner head is refused on run AND submit; the runner never runs', async () => {
    const code = 'export function format(v: string | number | boolean): string {\n  // @ts-ignore\n  return v.trim();\n}\n';
    for (const route of ['run', 'submit']) {
      const r = await request(app).post(`/api/units/${selfRunId}/${route}`).send({ code, selfAssisted: false });
      expect(r.status, route).toBe(422);
      expect(r.body.error.code).toBe('TYPECHECK_SUPPRESSED');
      expect(r.body.error.message).toMatch(/^line 2: @ts-ignore is not allowed here\. This exercise's type check is part of the grade/);
    }
    expect(calls).toEqual([]);
    expect(attempts()).toBe(0);
    // the same code without the directive is graded (and recorded) as usual
    const ok = await request(app).post(`/api/units/${selfRunId}/submit`).send({ code: code.replace('  // @ts-ignore\n', ''), selfAssisted: false });
    expect(ok.status).toBe(200);
    expect(calls).toEqual(['self-run']);
    expect(attempts()).toBe(1);
  });

  it('node-test-file: refused only when the check carries the tsc composite', async () => {
    const code = '// @ts-nocheck\nexport const add = (a: number, b: number) => a + b;\n';
    const r = await request(app).post(`/api/units/${ntfId}/submit`).send({ code, selfAssisted: false });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('TYPECHECK_SUPPRESSED');
    expect(calls).toEqual([]);
    expect(attempts()).toBe(0);
    const plain = await request(app).post(`/api/units/${ntfPlainId}/run`).send({ code });
    expect(plain.status).toBe(200);
    expect(calls).toEqual(['node-test-file']);
  });
});
