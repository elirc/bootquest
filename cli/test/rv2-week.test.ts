import { describe, expect, it } from 'vitest';
import type { WeekResponse } from '@bootquest/shared/api-ext';
import { runCli } from '../src/program.ts';
import { formatWeek } from '../src/week.ts';

/** rv2 S3 (F7): `bootquest week [--start YYYY-MM-DD]` prints GET /week (read-only). */
const WEEK: WeekResponse = {
  start: '2026-11-09',
  end: '2026-11-15',
  today: '2026-11-14',
  time: { activeDays: 3, sittings: 4, estMinutes: 95, rule: 'estimated' },
  passes: { units: 5, firstTime: 4, byKind: [{ kind: 'drill', units: 3 }, { kind: 'study', units: 2 }], selfScored: 1 },
  xp: 140,
  reviews: { graded: 22, again: 5 },
  shakyIdeas: [{ cardKey: 'keyidea:fund-js-senior/idem', section: 'fund-js-senior', ideaId: 'idem', idea: 'Store the idempotency key with the result.', again: 2 }],
  notebook: { entries: 3, topCategories: [{ category: 'edge-case', count: 2 }, { category: 'slip', count: 1 }] },
  reflection: { questions: ['a', 'b', 'c'], answers: null, savedAt: null },
};

describe('rv2: bootquest week', () => {
  const run = async (args: string[], body: unknown) => {
    const out: string[] = [];
    const urls: string[] = [];
    const fetch = (async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    const code = await runCli(args, { out: (t) => out.push(t), err: (t) => out.push(`ERR ${t}`), cwd: process.cwd(), env: {}, fetch });
    return { out: out.join('\n'), urls, code };
  };

  it('reads GET /week and prints every number of the page', async () => {
    const r = await run(['week'], WEEK);
    expect(r.urls).toHaveLength(1);
    expect(r.urls[0]).toMatch(/\/api\/week$/);
    expect(r.out).toContain('Week 2026-11-09 to 2026-11-15 (this week)');
    expect(r.out).toContain('~1 h 35 min over 4 sittings on 3 days (estimated)');
    expect(r.out).toContain('5 units passed (4 for the first time): 3 drill, 2 study');
    expect(r.out).toContain('1 explain-back / kata answer self-scored');
    expect(r.out).toContain('XP:        140');
    expect(r.out).toContain('22 graded, 5 rated again');
    expect(r.out).toContain('- Store the idempotency key with the result. (2x)');
    expect(r.out).toContain('3 entries; top: missed an edge case (2), careless slip (1)');
    expect(r.out).toContain('Reflection: not written yet - 3 questions at');
    expect(r.code).toBe(0);
  });

  it('--start reads another week; a malformed day is a usage error with no request', async () => {
    const r = await run(['week', '--start', '2026-11-02'], { ...WEEK, start: '2026-11-02', end: '2026-11-08' });
    expect(r.urls[0]).toMatch(/\/api\/week\?start=2026-11-02$/);
    expect(r.out).toContain('Week 2026-11-02 to 2026-11-08');
    expect(r.out).not.toContain('(this week)');
    const bad = await run(['week', '--start', 'monday'], WEEK);
    expect(bad.urls).toEqual([]);
    expect(bad.code).toBe(2);
  });

  it('an empty week says so in words', () => {
    const quiet = formatWeek(
      { ...WEEK, time: { ...WEEK.time, activeDays: 0, sittings: 0, estMinutes: 0 }, passes: { units: 0, firstTime: 0, byKind: [], selfScored: 0 }, shakyIdeas: [], notebook: { entries: 0, topCategories: [] }, reflection: { questions: ['a', 'b', 'c'], answers: ['x', '', ''], savedAt: Date.UTC(2026, 10, 14) } },
      'http://127.0.0.1:4317',
    );
    expect(quiet).toContain('~0 min over 0 sittings on 0 days');
    expect(quiet).toContain('0 units passed (0 for the first time)');
    expect(quiet).toContain('Key ideas: none rated again twice this week');
    expect(quiet).toContain('Notebook:  no entries this week');
    expect(quiet).toContain('Reflection: saved 2026-11-14');
  });
});
