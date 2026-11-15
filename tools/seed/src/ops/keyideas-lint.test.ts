// seed:lint:keyideas (rv2 S2, PLAN §2.1): schema, counts, word limits, live non-archived keys, xleak.
// Fixture estates are written to a temp dir; one test reads the committed content/ (the real 24 side files).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../factory/report.ts';
import { formatKeyIdeasReport, IDEA_LEAK_PENDING, keyIdeasFailed, keyIdeasReport, MAX_RECAP_UNITS, readEstate, recapUnitsNeeded, RECAP_UNITS_PENDING, scopeUnits, wordCount } from './keyideas-lint.ts';

const root = mkdtempSync(join(tmpdir(), 'bq-keyideas-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const put = (dir: string, rel: string, v: unknown): void => {
  const f = join(dir, rel);
  mkdirSync(resolve(f, '..'), { recursive: true });
  writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 1));
};

let n = 0;
/** a tiny estate: two drills + one quiz unit in a code pack, one Fundamentals topic with a gate item, one explain-back set, one archived drill */
function estate(keyideas: Record<string, unknown>): string {
  const dir = join(root, `e${++n}`);
  const drill = (slug: string) => ({ unit: { key: `demo/c1/${slug}`, track: 'js', kind: 'drill', title: slug, checks: [{ spec: { type: 'drill-js' } }] } });
  put(dir, 'packs/demo/c1.json', {
    format: 'bootquest-pack@1',
    units: [
      drill('d1'),
      drill('d2'),
      drill('d3'),
      drill('old'),
      { unit: { key: 'demo/c1/q1', track: 'js', kind: 'quiz', title: 'q', checks: [{ spec: { type: 'quiz', choices: ['the cache key carries the tenant id', 'nothing at all'], answerKey: 0 } }] } },
    ],
  });
  put(dir, 'packs/demo/manifest.json', {});
  put(dir, 'fundamentals/js/topics.json', {
    format: 'bootquest-fundamentals@1',
    topics: [{ id: '01-topic', title: 'Topic', quiz: [{ key: 'fund:js/01-topic/q01', choices: ['store the idempotency key with the result', 'b'], answer: 0 }], drillKeys: [] }],
  });
  put(dir, 'seed/explainback/demo--doc/items.json', {
    items: [
      {
        kind: 'explain-back',
        key: 'seed:explainback:demo/explain-back/1',
        provenance: { repo: 'demo', path: 'doc.md' },
        questions: [{ prompt: 'Explain the doc.', keyPoints: [{ text: 'Every replica invalidates its local copy through a broadcast channel before the write returns to the caller, so readers never observe stale prices.' }] }],
      },
    ],
  });
  put(dir, 'archive.json', { format: 'bootquest-archive@1', groups: [{ id: 'g', reason: 'r', keys: ['demo/c1/old'] }] });
  for (const [name, body] of Object.entries(keyideas)) put(dir, `keyideas/${name}.json`, body);
  return dir;
}

const idea = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  idea: 'A short idea sentence.',
  why: 'What breaks without it.',
  prompt: `A scenario question number ${id} that needs the idea?`,
  answer: 'An answer that applies the idea to the scenario.',
  tags: ['demo'],
  sources: ['fund/js/01-topic'],
  siblings: ['demo/c1/d1'],
  ...over,
});
const section = (ideas: unknown[], over: Record<string, unknown> = {}) => ({
  format: 'bootquest-keyideas@1',
  section: 'demo',
  title: 'Demo',
  track: 'js',
  scope: ['demo/c1/', 'fund/js/01-topic'],
  recapAfter: 0.8,
  ideas,
  ...over,
});
const five = (over: (i: number) => Record<string, unknown> = () => ({})) => [1, 2, 3, 4, 5].map((i) => idea(`idea-${i}`, over(i)));
const msgs = (dir: string) => keyIdeasReport(dir).problems.map((p) => `${p.idea ?? ''}: ${p.message}`);

describe('seed:lint:keyideas: the unit universe', () => {
  it('derives pack, Fundamentals and explain-back keys; a "/" prefix covers live units only (archived skipped)', () => {
    const e = readEstate(estate({}));
    expect(e.units.has('demo/c1/d1')).toBe(true);
    expect(e.units.has('fund/js/01-topic')).toBe(true);
    expect([...e.units.keys()].some((k) => k.startsWith('ladder/explain-back/demo/'))).toBe(true);
    expect(scopeUnits(e, 'demo/c1/')).toEqual(['demo/c1/d1', 'demo/c1/d2', 'demo/c1/d3', 'demo/c1/q1']);
    expect(e.quizKeys.map((q) => q.unit)).toEqual(['demo/c1/q1', 'fund/js/01-topic']);
  });
});

describe('seed:lint:keyideas: schema, counts, keys', () => {
  it('a clean section passes', () => {
    const dir = estate({ demo: section(five()) });
    const r = keyIdeasReport(dir);
    expect(r.problems).toEqual([]);
    expect(keyIdeasFailed(r)).toBe(false);
    expect(formatKeyIdeasReport(r).at(-1)).toBe('RESULT OK');
    expect(r.perSection).toEqual([{ section: 'demo', ideas: 5, scopeUnits: 5, recapUnits: 4 }]);
  });

  it('no content/keyideas dir is clean (0 files)', () => {
    const dir = estate({});
    expect(keyIdeasReport(dir)).toMatchObject({ files: 0, ideas: 0, problems: [] });
  });

  it('rejects an empty sources list (PLAN §5.3), a missing field and an unknown field', () => {
    const ideas = five();
    ideas[0] = idea('idea-1', { sources: [] });
    ideas[1] = { ...idea('idea-2'), extra: 1 } as ReturnType<typeof idea>;
    const { why: _w, ...noWhy } = idea('idea-3');
    ideas[2] = noWhy as ReturnType<typeof idea>;
    const m = msgs(estate({ demo: section(ideas) }));
    expect(m.some((x) => /schema: ideas\.0\.sources/.test(x))).toBe(true);
    expect(m.some((x) => /schema: ideas\.1: Unrecognized key/.test(x))).toBe(true);
    expect(m.some((x) => /schema: ideas\.2\.why/.test(x))).toBe(true);
  });

  it('idea counts: 4 and 13 fail, the sysdrills section must have exactly 18', () => {
    expect(msgs(estate({ demo: section(five().slice(0, 4)) }))).toContain(': 4 ideas (want 5-12)');
    const thirteen = Array.from({ length: 13 }, (_, i) => idea(`i-${i}`));
    expect(msgs(estate({ demo: section(thirteen) }))).toContain(': 13 ideas (want 5-12)');
    expect(msgs(estate({ sysdrills: section(five(), { section: 'sysdrills' }) }))).toContain(': 5 ideas (want 18)');
  });

  it('recapAfter: a fraction in (0, 1] or a whole count >= 2 that the live scope can reach', () => {
    expect(msgs(estate({ demo: section(five(), { recapAfter: 3 }) }))).toEqual([]);
    expect(msgs(estate({ demo: section(five(), { recapAfter: 1.5 }) })).some((x) => /schema: recapAfter: a fraction <= 1 or a whole count >= 2/.test(x))).toBe(true);
    expect(msgs(estate({ demo: section(five(), { recapAfter: 9 }) }))).toContain(': recapAfter 9 is more than the 5 live scope unit(s)');
  });

  it('rv3 MF-2: a recap that needs more than 40 passed scope units is a problem (a whole count or a narrow scope passes)', () => {
    // 50 drills under one prefix: 0.8 x 50 = 40 is the limit; 51 units -> 41 is over it
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ unit: { key: `big/c1/d${i}`, track: 'js', kind: 'drill', title: `d${i}`, checks: [{ spec: { type: 'drill-js' } }] } }));
    const big = (n: number, over: Record<string, unknown> = {}) => {
      const dir = estate({ demo: section(five(), { scope: ['big/c1/'], ...over }) });
      put(dir, 'packs/big/c1.json', { format: 'bootquest-pack@1', units: many(n) });
      return dir;
    };
    expect(recapUnitsNeeded(0.8, 50)).toBe(40);
    expect(recapUnitsNeeded(undefined, 51)).toBe(41);
    expect(recapUnitsNeeded(12, 129)).toBe(12);
    expect(msgs(big(50))).toEqual([]);
    expect(msgs(big(51))).toContain(': the recap opens after 41 passed scope units (max 40): use a whole-count recapAfter or a narrower scope');
    expect(msgs(big(129, { recapAfter: 27 }))).toEqual([]);
    expect(keyIdeasReport(big(129, { recapAfter: 27 })).perSection[0]).toMatchObject({ scopeUnits: 129, recapUnits: 27 });
    // a pending section (scheduled fix) is reported apart, and a pending entry that no longer applies is a problem
    const pend = estate({ agentic: section(Array.from({ length: 10 }, (_, i) => idea(`i-${i}`)), { section: 'agentic', scope: ['big/c1/'] }) });
    put(pend, 'packs/big/c1.json', { format: 'bootquest-pack@1', units: many(60) });
    const r = keyIdeasReport(pend);
    expect(r.problems).toEqual([]);
    expect(r.pending).toEqual([{ section: 'agentic', recapUnits: 48, owner: RECAP_UNITS_PENDING.agentic }]);
    expect(formatKeyIdeasReport(r)).toContain(`PENDING agentic: the recap opens after 48 passed units (max ${MAX_RECAP_UNITS}); fix scheduled: rv3 S4`);
    const fixed = estate({ agentic: section(Array.from({ length: 10 }, (_, i) => idea(`i-${i}`)), { section: 'agentic' }) });
    expect(msgs(fixed)).toContain(': RECAP_UNITS_PENDING lists this section but its recap opens after 4 unit(s), within 40: remove the entry');
  });

  it('word limits, duplicate ids and a section that does not match its file name', () => {
    const ideas = five();
    ideas[0] = idea('idea-1', { idea: Array(31).fill('w').join(' '), answer: Array(61).fill('w').join(' ') });
    ideas[1] = idea('idea-1');
    const m = msgs(estate({ other: section(ideas) }));
    expect(m).toContain('idea-1: idea has 31 words (max 30)');
    expect(m).toContain('idea-1: answer has 61 words (max 60)');
    expect(m).toContain('idea-1: duplicate id');
    expect(m).toContain(': section "demo" does not match the file name');
    expect(wordCount('  a  b\nc ')).toBe(3);
  });

  it('unknown, archived and prefix keys; siblings must be drills and not sources; scope keys must resolve', () => {
    const ideas = five();
    ideas[0] = idea('idea-1', { sources: ['demo/c1/nope'] });
    ideas[1] = idea('idea-2', { sources: ['demo/c1/old'] });
    ideas[2] = idea('idea-3', { sources: ['demo/c1/'] });
    ideas[3] = idea('idea-4', { siblings: ['demo/c1/q1'] });
    ideas[4] = idea('idea-5', { sources: ['fund/js/01-topic', 'demo/c1/d1'] });
    const m = msgs(estate({ demo: section(ideas, { scope: ['demo/c1/', 'demo/c1/old', 'zzz/'] }) }));
    expect(m).toContain('idea-1: sources key demo/c1/nope is not a unit of the estate');
    expect(m).toContain('idea-2: sources key demo/c1/old is archived');
    expect(m).toContain('idea-3: sources key demo/c1/ is a prefix (exact unit keys only)');
    expect(m).toContain('idea-4: sibling demo/c1/q1 is a quiz, not a drill');
    expect(m).toContain('idea-5: sibling demo/c1/d1 is also a source');
    expect(m).toContain(': scope key demo/c1/old is archived');
    expect(m).toContain(': scope key zzz/ resolves to no live unit');
  });
});

describe('seed:lint:keyideas: xleak (prompt + answer vs keyed answers outside sources)', () => {
  it('a keyed quiz answer restated outside the idea sources is a LEAK; inside its sources it is allowed', () => {
    const leak = five();
    leak[0] = idea('idea-1', { answer: 'Make sure the cache key carries the tenant id, always.' });
    const r = keyIdeasReport(estate({ demo: section(leak) }));
    expect(r.leaks).toBe(1);
    expect(r.problems[0]!.message).toMatch(/^LEAK answer contains the keyed answer of pack:demo\/c1\/q1 \(unit demo\/c1\/q1, not a source\)/);
    const ok = five();
    ok[0] = idea('idea-1', { answer: 'Make sure the cache key carries the tenant id, always.', sources: ['demo/c1/q1'] });
    expect(keyIdeasReport(estate({ demo: section(ok) })).leaks).toBe(0);
    // the Fundamentals gate item belongs to its topic unit, which is the default source
    const own = five();
    own[0] = idea('idea-1', { answer: 'You store the idempotency key with the result.' });
    expect(keyIdeasReport(estate({ demo: section(own) })).leaks).toBe(0);
  });

  it('rv3 MF-4: the idea sentence is leak-checked too (quiz key token rule and key-point containment)', () => {
    const quiz = five();
    quiz[0] = idea('idea-1', { idea: 'The cache key carries the tenant id.' });
    const r = keyIdeasReport(estate({ demo: section(quiz) }));
    expect(r.leaks).toBe(1);
    expect(r.problems[0]!.message).toMatch(/^LEAK idea contains the keyed answer of pack:demo\/c1\/q1/);
    const kp = five();
    kp[0] = idea('idea-1', { idea: 'Each replica invalidates its local copy through a broadcast channel before the write returns, so readers never observe stale prices.' });
    expect(keyIdeasReport(estate({ demo: section(kp) })).problems.map((p) => p.message).some((m) => /^LEAK idea restates eb:demo--doc q1\.kp1/.test(m))).toBe(true);
    // a listed pending leak is reported apart (not a problem); the other matchers still run
    expect(Object.values(IDEA_LEAK_PENDING).every((o) => o === 'rv3 S3' || o === 'rv3 S1 content patch')).toBe(true);
    // a source's own key is allowed in the idea sentence (the server withholds it until the sources are passed)
    const own = five();
    own[0] = idea('idea-1', { idea: 'The cache key carries the tenant id.', sources: ['demo/c1/q1'] });
    expect(keyIdeasReport(estate({ demo: section(own) })).leaks).toBe(0);
  });

  it('an explain-back key point paraphrased outside the sources is a LEAK (containment rule)', () => {
    const ideas = five();
    ideas[0] = idea('idea-1', { prompt: 'How do replicas avoid stale prices?', answer: 'Each replica invalidates its local copy through a broadcast channel before the write returns to the caller, so readers never observe stale prices.' });
    const r = keyIdeasReport(estate({ demo: section(ideas) }));
    expect(r.leaks).toBe(1);
    expect(r.problems[0]!.message).toMatch(/^LEAK prompt\+answer restates eb:demo--doc q1\.kp1/);
  });
});

describe('seed:lint:keyideas: the committed side files', () => {
  it('content/keyideas: 24 sections, all clean (0 problems, 0 leaks)', () => {
    const r = keyIdeasReport(resolve(REPO_ROOT, 'content'));
    expect(r.problems).toEqual([]);
    expect(r.files).toBe(24);
    expect(r.perSection.find((s) => s.section === 'sysdrills')?.ideas).toBe(18);
    for (const s of r.perSection) if (s.section !== 'sysdrills') expect(s.ideas).toBeGreaterThanOrEqual(5);
    // rv3 MF-4: the idea sentences that still restate a key outside their sources are exactly the listed ones
    expect(r.pendingLeaks.map((x) => x.key).sort()).toEqual(Object.keys(IDEA_LEAK_PENDING).sort());
    // rv3 MF-2: every recap opens within 40 units, or its fix is scheduled (RECAP_UNITS_PENDING)
    for (const s of r.perSection) if (!RECAP_UNITS_PENDING[s.section]) expect(s.recapUnits, s.section).toBeLessThanOrEqual(MAX_RECAP_UNITS);
  }, 600_000);
});
