import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addDays, dayKey } from '../src/engines/clock.ts';
import { selfRunVerdict, starterMeetsContract } from '../src/store/content.ts';

const ENGINE_DIRS = ['../src/engines/', '../src/store/', '../src/sync/'];

describe('clock discipline', () => {
  it('engines never read the wall clock (no Date.now(), no argument-less new Date())', () => {
    for (const rel of ENGINE_DIRS) {
      const dir = fileURLToPath(new URL(rel, import.meta.url));
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
        const src = readFileSync(`${dir}/${f}`, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
        expect(src, f).not.toMatch(/Date\.now\s*\(/);
        expect(src, f).not.toMatch(/new\s+Date\s*\(\s*\)/);
        expect(src, f).not.toMatch(/performance\.now\s*\(/);
        // a bare Date() call (no `new`) also returns the wall-clock time as a string
        expect(src, f).not.toMatch(/(?<![\w.$])Date\s*\(\s*\)/);
      }
    }
  });

  it('day keys are local calendar days and addDays crosses month ends', () => {
    expect(dayKey(new Date(2026, 9, 31, 23, 59).getTime())).toBe('2026-10-31');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('self-run protocol (#done passed= failed= todo=)', () => {
  it('todo is its own state, not a failure', () => {
    expect(selfRunVerdict({ passed: 3, failed: 0, todo: 0 })).toBe('pass');
    expect(selfRunVerdict({ passed: 3, failed: 0, todo: 2 })).toBe('todo');
    expect(selfRunVerdict({ passed: 3, failed: 1, todo: 2 })).toBe('fail');
    expect(selfRunVerdict({ passed: 0, failed: 0, todo: 0 })).toBe('fail');
  });

  it('inverted (hunt) starters must FAIL; normal starters must be unfinished', () => {
    expect(starterMeetsContract({ passed: 2, failed: 1, todo: 0 }, true)).toBe(true);
    expect(starterMeetsContract({ passed: 3, failed: 0, todo: 0 }, true)).toBe(false);
    expect(starterMeetsContract({ passed: 0, failed: 0, todo: 6 }, false)).toBe(true);
    expect(starterMeetsContract({ passed: 0, failed: 1, todo: 5 }, false)).toBe(false);
  });
});
