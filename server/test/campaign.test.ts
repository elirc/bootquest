import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/database.ts';
import { selfAttestReading } from '../src/engines/attempts.ts';
import { actUnlockStates, campaignState, meetsCorePct, questUnitUnlocked, type ActGate } from '../src/engines/campaign.ts';
import { DAY_MS } from '../src/engines/clock.ts';
import { xpToReach } from '../src/engines/level.ts';
import { composeSlate } from '../src/engines/streak.ts';
import { CampaignLoadError, loadCampaignIntoDb, readCampaign } from '../src/store/campaign.ts';
import { insertCheck } from '../src/store/content.ts';
import { defaultFixtureTracks, quest, writeCampaignFixture } from './campaign-fixture.ts';
import { submit, useTempDb } from './helpers.ts';

const gate = (actNo: number, coreDone: number, coreTotal: number, over: Partial<ActGate> = {}): ActGate => ({
  actNo,
  unlockPct: 0.8,
  unlockLevel: 1,
  staticLock: false,
  coreDone,
  coreTotal,
  ...over,
});

describe('act unlock rule (pure)', () => {
  it('80% boundary: 79/100 stays locked, 80/100 unlocks (integer math, no float rounding)', () => {
    expect(actUnlockStates([gate(1, 79, 100), gate(2, 0, 5)], 1)).toEqual([true, false]);
    expect(actUnlockStates([gate(1, 80, 100), gate(2, 0, 5)], 1)).toEqual([true, true]);
    expect(meetsCorePct(3, 5, 0.8)).toBe(false); // 60%
    expect(meetsCorePct(4, 5, 0.8)).toBe(true); // exactly 80%
    expect(meetsCorePct(11, 14, 0.8)).toBe(false); // 78.57%
    expect(meetsCorePct(12, 14, 0.8)).toBe(true); // 85.7%
  });

  it('level threshold edge: level = threshold - 1 locked, = threshold unlocked', () => {
    const acts = [gate(1, 10, 10), gate(2, 0, 3, { unlockLevel: 4 })];
    expect(actUnlockStates(acts, 3)).toEqual([true, false]);
    expect(actUnlockStates(acts, 4)).toEqual([true, true]);
  });

  it('chain: act 3 needs act 2 unlocked even when act 2 core is vacuous; act 1 is open; static lock and track lock win', () => {
    // act 2 has no core quests (vacuous pct) but its own level gate fails -> act 3 stays locked
    expect(actUnlockStates([gate(1, 5, 5), gate(2, 0, 0, { unlockLevel: 9 }), gate(3, 0, 1)], 5)).toEqual([true, false, false]);
    expect(actUnlockStates([gate(1, 5, 5), gate(2, 0, 0), gate(3, 0, 1)], 1)).toEqual([true, true, true]);
    expect(actUnlockStates([gate(1, 0, 4, { staticLock: true })], 99)).toEqual([false]);
    expect(actUnlockStates([gate(1, 0, 4)], 99, true)).toEqual([false]);
  });
});

function unitOf(db: Db, key: string): number {
  return db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', key)!.id;
}

/** Simulate seed:quests: give a study placeholder its quiz gate. */
function seedQuizGate(db: Db, clock: () => Date, key: string): number {
  const id = unitOf(db, key);
  insertCheck(db, id, { type: 'study-quiz', itemKeys: ['q1'] }, clock);
  return id;
}

describe('campaign loader', { timeout: 30_000 }, () => {
  const ctx = useTempDb();

  it('loads acts/quests/placeholder units; a second load changes nothing (idempotent, loaded === built)', () => {
    const dir = writeCampaignFixture(join(ctx.tmp.dir, 'campaign'));
    const first = loadCampaignIntoDb(ctx.db, readCampaign(dir), ctx.clock);
    expect(first).toMatchObject({ inserted: 8, updated: 0, unchanged: 0, removed: 0 });
    expect(first.tracks).toEqual([
      { track: 'js', acts: 2, built: 5, loaded: 5, units: 5 },
      { track: 'csharp', acts: 1, built: 2, loaded: 2, units: 2 },
      { track: 'java', acts: 1, built: 1, loaded: 1, units: 0 },
    ]);
    const snapshot = () => ({
      acts: ctx.db.all('SELECT * FROM campaign_act ORDER BY id'),
      quests: ctx.db.all('SELECT * FROM quest ORDER BY id'),
      units: ctx.db.all('SELECT * FROM unit ORDER BY id'),
    });
    const before = snapshot();
    const second = loadCampaignIntoDb(ctx.db, readCampaign(dir), ctx.clock);
    expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: 8, removed: 0 });
    expect(snapshot()).toEqual(before);
    // placeholder units: study -> 'study' with NO check (content pending), skim -> 'reading'; java inert
    const units = ctx.db.all<{ key: string; kind: string; checks: number }>(
      `SELECT key, kind, (SELECT COUNT(*) FROM "check" c WHERE c.unit_id = unit.id) AS checks FROM unit ORDER BY key`,
    );
    expect(units).toEqual([
      { key: 'campaign/csharp/read-cr', kind: 'reading', checks: 0 },
      { key: 'campaign/csharp/study-c', kind: 'study', checks: 0 },
      { key: 'campaign/js/read-r1', kind: 'reading', checks: 0 },
      { key: 'campaign/js/read-r2', kind: 'reading', checks: 0 },
      { key: 'campaign/js/read-r3', kind: 'reading', checks: 0 },
      { key: 'campaign/js/study-a', kind: 'study', checks: 0 },
      { key: 'campaign/js/study-b', kind: 'study', checks: 0 },
    ]);
    const java = ctx.db.get<{ unit_id: number | null; content_pending: number }>(`SELECT unit_id, content_pending FROM quest WHERE key = 'campaign/java/java-j'`)!;
    expect(java).toEqual({ unit_id: null, content_pending: 1 });
  });

  it('a quest that leaves the pack is deleted and its unit RETIRED (attempt history keeps its target); a moved quest changes act', () => {
    const dir = join(ctx.tmp.dir, 'campaign');
    writeCampaignFixture(dir);
    loadCampaignIntoDb(ctx.db, readCampaign(dir), ctx.clock);
    const r1 = unitOf(ctx.db, 'campaign/js/read-r1');
    selfAttestReading(ctx.db, r1, ctx.clock);

    const tracks = defaultFixtureTracks();
    tracks.js.acts[0]!.quests = tracks.js.acts[0]!.quests.filter((q) => q.repo !== 'read-r1');
    const r2 = tracks.js.acts[0]!.quests.find((q) => q.repo === 'read-r2')!;
    tracks.js.acts[0]!.quests = tracks.js.acts[0]!.quests.filter((q) => q !== r2);
    tracks.js.acts[1]!.quests = [quest('js', 'read-r2', 'reading', 3), ...tracks.js.acts[1]!.quests];
    writeCampaignFixture(dir, tracks);
    const stats = loadCampaignIntoDb(ctx.db, readCampaign(dir), ctx.clock);
    expect(stats.removed).toBe(1);
    expect(ctx.db.get(`SELECT 1 AS x FROM quest WHERE key = 'campaign/js/read-r1'`)).toBeUndefined();
    expect(ctx.db.get<{ retired_at: number | null }>('SELECT retired_at FROM unit WHERE id = ?', r1)!.retired_at).not.toBeNull();
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attempt WHERE unit_id = ?', r1)!.n).toBe(1);
    const moved = ctx.db.get<{ actNo: number }>(`SELECT ca.act_no AS actNo FROM quest q JOIN campaign_act ca ON ca.id = q.act_id WHERE q.key = 'campaign/js/read-r2'`)!;
    expect(moved.actNo).toBe(2);
  });

  it('refuses a pack built by a different seeder, an edited track file, and a manifest/count mismatch', () => {
    const dir = join(ctx.tmp.dir, 'campaign');
    writeCampaignFixture(dir, defaultFixtureTracks(), { fingerprint: 'f'.repeat(64) });
    expect(() => readCampaign(dir)).toThrow(/stamped by seeder ffffffffffff/);

    writeCampaignFixture(dir);
    const p = join(dir, 'js.json');
    writeFileSync(p, readFileSync(p, 'utf8').replace('"title": "study-a"', '"title": "study-A"'));
    expect(() => readCampaign(dir)).toThrow(CampaignLoadError);
    expect(() => readCampaign(dir)).toThrow(/sha256 .* does not match the manifest/);
  });

  it('the committed content/campaign (real seed:campaign output) loads with loaded === built, twice', () => {
    const real = fileURLToPath(new URL('../../content/campaign/', import.meta.url));
    const c = readCampaign(real);
    const first = loadCampaignIntoDb(ctx.db, c, ctx.clock);
    for (const t of first.tracks) {
      expect(t.loaded).toBe(t.built);
      expect(t.built).toBe(c.manifest.tracks.find((m) => m.track === t.track)!.counts.quests);
    }
    expect(first.inserted).toBe(c.manifest.report.seeded);
    const again = loadCampaignIntoDb(ctx.db, readCampaign(real), ctx.clock);
    expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: c.manifest.report.seeded, removed: 0 });
    // java: one statically locked act, four inert quests
    const java = campaignState(ctx.db, 'java');
    expect(java).toHaveLength(1);
    expect(java[0]!.unlocked).toBe(false);
    expect(java[0]!.quests.map((q) => [q.unitId, q.state])).toEqual(Array(4).fill([null, 'locked']));
  });
});

describe('campaign state + slate (engine)', { timeout: 30_000 }, () => {
  const ctx = useTempDb();
  const load = () => loadCampaignIntoDb(ctx.db, readCampaign(writeCampaignFixture(join(ctx.tmp.dir, 'campaign'))), ctx.clock);

  it('act 1 open, act 2 locked; study quests are pending until their quiz gate is seeded; reading steps are non-core', () => {
    load();
    const [a1, a2] = campaignState(ctx.db, 'js');
    expect(a1).toMatchObject({ actNo: 1, unlocked: true, coreDone: 0, coreTotal: 1 });
    expect(a2).toMatchObject({ actNo: 2, unlocked: false, coreTotal: 1 });
    expect(a1!.quests.map((q) => [q.repo, q.state, q.core])).toEqual([
      ['study-a', 'pending', true],
      ['read-r1', 'available', false],
      ['read-r2', 'available', false],
    ]);
    expect(a2!.quests.every((q) => q.state === 'locked')).toBe(true);
    // reading steps never count: both attested, act 2 still locked
    selfAttestReading(ctx.db, unitOf(ctx.db, 'campaign/js/read-r1'), ctx.clock);
    selfAttestReading(ctx.db, unitOf(ctx.db, 'campaign/js/read-r2'), ctx.clock);
    expect(campaignState(ctx.db, 'js')[1]!.unlocked).toBe(false);
    expect(questUnitUnlocked(ctx.db, unitOf(ctx.db, 'campaign/js/read-r3'))).toBe(false);
  });

  it('act 2 unlocks at 80% of act 1 core AND level >= 2 — the level leg alone holds it shut', () => {
    load();
    const a = seedQuizGate(ctx.db, ctx.clock, 'campaign/js/study-a');
    submit(ctx.db, ctx.clock, a); // core 1/1, but no XP was paid here -> level 1
    expect(campaignState(ctx.db, 'js')[1]!.unlocked).toBe(false);
    // XP to reach level 2 (paid as review XP rows directly: the level is global)
    for (let i = 0; i < xpToReach(2); i += 30) {
      ctx.db.run(`INSERT INTO xp_event (kind, amount, day, created_at) VALUES ('review', ?, '2026-09-01', 0)`, Math.min(30, xpToReach(2) - i));
    }
    expect(campaignState(ctx.db, 'js')[1]!.unlocked).toBe(true);
    expect(questUnitUnlocked(ctx.db, unitOf(ctx.db, 'campaign/js/read-r3'))).toBe(true);
  });

  it('slate: the campaign slot exists only while a step can be taken; the first completion of a quest unit today ticks it', () => {
    expect(composeSlate(ctx.db, ctx.clock).items.some((i) => i.slot === 'campaign')).toBe(false); // nothing seeded
    load();
    expect(composeSlate(ctx.db, ctx.clock).items.find((i) => i.slot === 'campaign')).toMatchObject({ done: false });
    selfAttestReading(ctx.db, unitOf(ctx.db, 'campaign/js/read-r1'), ctx.clock);
    expect(composeSlate(ctx.db, ctx.clock).items.find((i) => i.slot === 'campaign')).toMatchObject({ done: true });
  });

  it('re-passing a quest unit first passed on an earlier day does not tick the slot', () => {
    load();
    const a = seedQuizGate(ctx.db, ctx.clock, 'campaign/js/study-a');
    submit(ctx.db, ctx.clock, a);
    ctx.clock.advance(DAY_MS);
    submit(ctx.db, ctx.clock, a);
    expect(composeSlate(ctx.db, ctx.clock).items.find((i) => i.slot === 'campaign')).toMatchObject({ done: false });
  });

  it('when every actionable quest is done the slot disappears instead of becoming uncompletable', () => {
    load();
    for (const k of ['campaign/js/read-r1', 'campaign/js/read-r2', 'campaign/csharp/read-cr']) selfAttestReading(ctx.db, unitOf(ctx.db, k), ctx.clock);
    expect(composeSlate(ctx.db, ctx.clock).items.find((i) => i.slot === 'campaign')).toMatchObject({ done: true }); // done today: kept
    ctx.clock.advance(DAY_MS);
    // study quests are content-pending, act 2 is locked: no step can be taken -> no slot
    expect(composeSlate(ctx.db, ctx.clock).items.some((i) => i.slot === 'campaign')).toBe(false);
  });
});
