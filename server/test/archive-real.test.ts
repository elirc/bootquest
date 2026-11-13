import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { campaignState, meetsCorePct } from '../src/engines/campaign.ts';
import { loadCampaignIntoDb, readCampaign } from '../src/store/campaign.ts';
import { DEFAULT_CONTENT_DIR, isArchivedKey, makeRouting, readRouting, setRouting } from '../src/store/routing.ts';
import { makeUnit, submit, useTempDb } from './helpers.ts';
import { insertCheck } from '../src/store/content.ts';

/**
 * rv wave C (REVIEW Q4 / D8, R3-round2): the committed archive side file is unit-grain, never touches a
 * related.json key, and campaign core counting leaves archived quests out, so no act deadlocks.
 */
afterEach(() => setRouting(null));

const real = readRouting(DEFAULT_CONTENT_DIR);

describe('content/archive.json (committed)', () => {
  it('loads clean: 880 unit keys in 7 groups, no prefix, no related.json key, every group counted by counting', () => {
    expect(real.problems).toEqual([]);
    const file = JSON.parse(readFileSync(join(DEFAULT_CONTENT_DIR, 'archive.json'), 'utf8')) as { groups: { id: string; count: number; keys: string[] }[] };
    expect(Object.fromEntries(file.groups.map((g) => [g.id, g.keys.length]))).toEqual({
      'bootforge-quiz': 544,
      'bootforge-micro-drill': 267,
      'campaign-duplicate-skim': 12,
      'twin-pack-gate': 15,
      'classic-eb-demoted': 40,
      'g4-demoted': 1,
      'sysdrills-duplicate': 1,
    });
    for (const g of file.groups) expect(g.count).toBe(g.keys.length);
    expect(real.archivedKeys.size).toBe(880);
    expect(real.archivedPrefixes).toEqual([]);
    const related = JSON.stringify(JSON.parse(readFileSync(join(DEFAULT_CONTENT_DIR, 'fundamentals', 'related.json'), 'utf8')));
    for (const k of real.archivedKeys) expect(related.includes(`"${k}"`), k).toBe(false);
    // signalpost U01-U03 (the promotion path) are never archived
    expect([...real.archivedKeys].some((k) => k.includes('signalpost'))).toBe(false);
  });

  it('a related.json key listed in an archive is refused (skipped with a problem), never archived', () => {
    const relatedKey = 'jstrain/01-language-core/01-type-of';
    expect(JSON.stringify(JSON.parse(readFileSync(join(DEFAULT_CONTENT_DIR, 'fundamentals', 'related.json'), 'utf8')))).toContain(relatedKey);
    expect(isArchivedKey(relatedKey, real)).toBe(false);
  });

  it('paths load: sysdesign walks 18 sysdrill modules with 1-2 DESIGN IT sets each; agentic is G2 -> katas -> G3 -> G4', () => {
    const sys = real.paths.get('sysdesign')!;
    expect(sys).toHaveLength(18);
    for (const s of sys) {
      expect(s.keys[0]).toBe(`sysdrills/${s.id}/`);
      expect(s.keys.length - 1).toBeGreaterThanOrEqual(1);
      expect(s.keys.length - 1).toBeLessThanOrEqual(2);
    }
    expect(real.paths.get('agentic')!.map((s) => s.id)).toEqual(['g2-briefs', 'katas-easy', 'katas-medium', 'katas-hard', 'g3', 'g4']);
  });
});

describe('campaign core counting with the real archive (R3-round2 deadlock numbers)', () => {
  const ctx = useTempDb();

  it('JS act 1 keeps 15/15 core, C# act 1 5/5, C# act 2 3 of 4 (the archived twin leaves the denominator): every act stays openable', () => {
    loadCampaignIntoDb(ctx.db, readCampaign(join(DEFAULT_CONTENT_DIR, 'campaign')), ctx.clock);
    setRouting(makeRouting([]));
    const before = new Map(campaignState(ctx.db).map((a) => [`${a.trackId}/${a.actNo}`, a.coreTotal]));
    setRouting(real);
    const after = campaignState(ctx.db);
    const total = (k: string) => after.find((a) => `${a.trackId}/${a.actNo}` === k)!.coreTotal;
    expect([before.get('js/1'), total('js/1')]).toEqual([15, 15]);
    expect([before.get('csharp/1'), total('csharp/1')]).toEqual([5, 5]);
    expect([before.get('csharp/2'), total('csharp/2')]).toEqual([4, 3]);
    // R5's wholesale archive kept 2 of 15 (JS act 1) and 0 of 5 / 0 of 4 (C# acts 1-2) while still counting
    // all of them; here an archived core quest leaves BOTH numbers, so finishing what is shown opens the next act
    for (const a of after) {
      const archivedCore = a.quests.filter((q) => q.archived && q.kind === 'study-quest');
      expect(a.coreTotal).toBe(a.quests.filter((q) => q.core).length);
      expect(archivedCore.every((q) => !q.core)).toBe(true);
      expect(meetsCorePct(a.coreTotal, a.coreTotal, 0.8)).toBe(true);
    }
    // the 12 skims and 15 twin gates are archived but still listed
    expect(after.flatMap((a) => a.quests).filter((q) => q.archived)).toHaveLength(27);
  });

  it('a fixture act: archiving a core quest lets act 2 open once the remaining core is done', () => {
    const units = [1, 2, 3, 4, 5].map((i) => makeUnit(ctx.db, ctx.clock, { key: `campaign/js/q${i}`, kind: 'study', noCheck: true }));
    for (const u of units) insertCheck(ctx.db, u, { type: 'study-quiz', itemKeys: ['a'] }, ctx.clock);
    const act1 = ctx.db.run(`INSERT INTO campaign_act (track_id, act_no, title) VALUES ('js', 1, 'One')`).lastInsertRowid;
    ctx.db.run(`INSERT INTO campaign_act (track_id, act_no, title, unlock_pct, unlock_level) VALUES ('js', 2, 'Two', 0.8, 1)`);
    units.forEach((u, i) => ctx.db.run(`INSERT INTO quest (act_id, unit_id, key, repo, index_rank, verdict) VALUES (?, ?, ?, ?, ?, 'study')`, act1, u, `campaign/js/q${i + 1}`, `r${i}`, i));
    for (const u of units.slice(0, 3)) submit(ctx.db, ctx.clock, u);
    setRouting(makeRouting([]));
    expect(campaignState(ctx.db, 'js').map((a) => a.unlocked)).toEqual([true, false]); // 3/5 = 60%
    setRouting(makeRouting(['campaign/js/q4']));
    expect(campaignState(ctx.db, 'js').map((a) => [a.coreDone, a.coreTotal])).toEqual([
      [3, 4],
      [0, 0],
    ]); // 75% < 80%
    setRouting(makeRouting(['campaign/js/q4', 'campaign/js/q5']));
    expect(campaignState(ctx.db, 'js').map((a) => a.unlocked)).toEqual([true, true]); // 3/3
  });
});
