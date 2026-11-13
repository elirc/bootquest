import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/program.ts';
import { formatToday, SOLVE_IN_EDITOR, todayStreakWords } from '../src/format.ts';
import { dashboard } from './helpers.ts';

/** rv wave C (R4-17): `bootquest today` says what the web dashboard says (complete / kept / not yet) and names the Fundamentals step. */
describe('rv wave C: bootquest today', () => {
  const base = () => ({
    ...dashboard(),
    slate: {
      day: '2026-10-07',
      status: 'open',
      items: [
        { slot: 'fund', kind: 'fund-step' as const, track: 'js', done: false },
        { slot: 'senior', kind: 'senior-rep' as const, rep: 'design' as const, done: false },
      ],
    },
    nextUp: [{ trackId: 'js' as const, unit: { id: 7, key: 'fund/js/01-values', title: '01 · Values and types', kind: 'study' as const } }],
  });

  it('a partial day (>= 20 XP, slate not complete) reads "kept", never "safe" or "complete"', () => {
    const d = { ...base(), heatmap: [{ day: '2026-10-07', xp: 25, status: 'open' as const }] };
    expect(todayStreakWords(d)).toBe('not complete yet - kept with 25 XP; finish the slate to grow it');
    const out = formatToday(d, 'http://x');
    expect(out).toContain('  [ ] Fundamentals step (js)');
    expect(out).toContain('  [ ] senior rep (a DESIGN IT set; any senior rep counts)');
    expect(out).toContain('Fundamentals step: 01 · Values and types (id 7)');
    expect(out).toContain('Streak: 3 days (longest 5) - today not complete yet - kept with 25 XP');
    expect(out).toContain(SOLVE_IN_EDITOR);
  });

  it('a complete day says the streak grows; a quiet day says how far 20 XP is', () => {
    expect(todayStreakWords({ ...base(), streak: { ...base().streak, todayComplete: true } })).toBe('complete (the streak grows)');
    expect(todayStreakWords(base())).toBe('not complete yet - 0/20 XP keeps it, the full slate grows it');
  });

  it('mutate is hidden from --help (still a command)', () => {
    const program = buildProgram({ out: () => {}, err: () => {}, cwd: process.cwd(), env: {}, fetch: (async () => new Response('{}')) as never }, () => {});
    expect(program.helpInformation()).not.toMatch(/\bmutate\b/);
    expect(program.commands.some((c) => c.name() === 'mutate')).toBe(true);
    expect(program.helpInformation()).toMatch(/solve it in your editor/);
  });
});
