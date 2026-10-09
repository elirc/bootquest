import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CampaignManifest, CampaignTrackFile, type CampaignQuest } from '@bootquest/shared';
import type { Db } from '../db/database.ts';
import { nowMs, type Clock } from '../engines/clock.ts';
import { campaignSeederFingerprint } from './campaign-fingerprint.ts';

/**
 * Campaign loader (W5b). content/campaign/ (written by `npm run seed:campaign`)
 * is the store of record for the campaign map; at startup the server:
 *   0. verifies the LIGHT stamp (campaign packs are structural, not learner-
 *      verified code): manifest.seeder.fingerprint must equal the current
 *      seeder's source fingerprint (campaign-fingerprint.ts), and every track
 *      file's sha256 + counts must match the manifest. The upskillorder
 *      source hashes in the manifest are provenance only here — they are
 *      re-verified by `seed:campaign -- --check`, because the estate is not
 *      required at serve time;
 *   1. upserts campaign_act rows by (track, act_no) and quest rows by their
 *      stable key 'campaign/<track>/<repo>' (a repo may move acts between
 *      seeds), plus one placeholder unit per playable quest (study quest ->
 *      unit kind 'study' with NO check until seed:quests seeds its quiz gate;
 *      skim -> unit kind 'reading', self-attest 5 XP). Java's inert quests get
 *      no unit. A quest that left the pack is deleted and its unit RETIRED
 *      (history rows keep their FK target) — never deleted;
 *   2. asserts loaded === built (per track: quests, per-act quests, live units)
 *      and REFUSES TO START on a mismatch. Idempotent: a second load changes nothing.
 */

export class CampaignLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignLoadError';
  }
}

export const CAMPAIGN_SOURCE_KEY = 'campaign:upskillorder';
const RESEED = 'run `npm run seed:campaign` and commit content/campaign/';

export interface LoadedCampaign {
  dir: string;
  manifest: CampaignManifest;
  manifestSha256: string;
  tracks: CampaignTrackFile[];
}

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

export function readCampaign(dir: string): LoadedCampaign {
  const mPath = join(dir, 'manifest.json');
  if (!existsSync(mPath)) throw new CampaignLoadError(`campaign ${dir}: no manifest.json — ${RESEED}`);
  const mBytes = readFileSync(mPath);
  let manifest: CampaignManifest;
  try {
    manifest = CampaignManifest.parse(JSON.parse(mBytes.toString('utf8')));
  } catch (err) {
    throw new CampaignLoadError(`campaign manifest is malformed (${err instanceof Error ? err.message.slice(0, 300) : String(err)}) — ${RESEED}`);
  }
  const fp = campaignSeederFingerprint();
  if (manifest.seeder.fingerprint !== fp) {
    throw new CampaignLoadError(
      `campaign manifest was stamped by seeder ${manifest.seeder.fingerprint.slice(0, 12)}, but the current seeder is ${fp.slice(0, 12)} ` +
        `(tools/seed/src/campaign or shared/src/campaign.ts changed since the map was built) — ${RESEED}`,
    );
  }
  const tracks: CampaignTrackFile[] = [];
  for (const t of manifest.tracks) {
    const bytes = readFileSync(join(dir, t.file));
    const actual = sha256(bytes);
    if (actual !== t.sha256) throw new CampaignLoadError(`campaign ${t.file}: sha256 ${actual.slice(0, 12)} does not match the manifest (${t.sha256.slice(0, 12)}) — edited by hand? ${RESEED}`);
    const file = CampaignTrackFile.parse(JSON.parse(bytes.toString('utf8')));
    if (file.track !== t.track) throw new CampaignLoadError(`campaign ${t.file} declares track ${file.track}, manifest says ${t.track}`);
    const qs = file.acts.flatMap((a) => a.quests);
    const counts = {
      acts: file.acts.length,
      quests: qs.length,
      studyQuests: qs.filter((q) => q.kind === 'study-quest').length,
      readingSteps: qs.filter((q) => q.kind === 'reading').length,
      units: qs.filter((q) => q.unit !== null).length,
    };
    if (JSON.stringify(counts) !== JSON.stringify(t.counts)) {
      throw new CampaignLoadError(`campaign ${t.file}: counts ${JSON.stringify(counts)} != manifest ${JSON.stringify(t.counts)}`);
    }
    tracks.push(file);
  }
  return { dir, manifest, manifestSha256: sha256(mBytes), tracks };
}

export interface CampaignLoadStats {
  tracks: { track: string; acts: number; built: number; loaded: number; units: number }[];
  inserted: number;
  updated: number;
  unchanged: number;
  /** quests that left the pack: rows deleted, units retired */
  removed: number;
}

function upsertSource(db: Db, c: LoadedCampaign, now: Clock): number {
  const row = db.get<{ id: number }>('SELECT id FROM source WHERE key = ?', CAMPAIGN_SOURCE_KEY);
  if (row) {
    db.run('UPDATE source SET pinned_sha = ?, local_cache_path = ? WHERE id = ?', c.manifestSha256, c.dir, row.id);
    return row.id;
  }
  return db.run(
    `INSERT INTO source (key, repo, subpath, role, origin_kind, pinned_sha, local_cache_path, read_only, created_at)
     VALUES (?, 'local/upskillorder', '', 'curriculum', 'local', ?, ?, 1, ?)`,
    CAMPAIGN_SOURCE_KEY,
    c.manifestSha256,
    c.dir,
    nowMs(now),
  ).lastInsertRowid;
}

function upsertAct(db: Db, track: string, a: CampaignTrackFile['acts'][number]): number {
  const row = db.get<{ id: number }>('SELECT id FROM campaign_act WHERE track_id = ? AND act_no = ?', track, a.actNo);
  if (row) {
    db.run(
      'UPDATE campaign_act SET title = ?, theme = ?, unlock_pct = ?, unlock_level = ?, locked = ? WHERE id = ?',
      a.title,
      a.theme,
      a.unlockPct,
      a.unlockLevel,
      a.locked,
      row.id,
    );
    return row.id;
  }
  return db.run(
    'INSERT INTO campaign_act (track_id, act_no, title, theme, unlock_pct, unlock_level, locked) VALUES (?, ?, ?, ?, ?, ?, ?)',
    track,
    a.actNo,
    a.title,
    a.theme,
    a.unlockPct,
    a.unlockLevel,
    a.locked,
  ).lastInsertRowid;
}

/** Upsert the placeholder unit of a quest. Returns [unit id, changed]. */
function upsertQuestUnit(db: Db, track: string, actNo: number, sourceId: number, q: CampaignQuest, now: Clock): [number | null, boolean] {
  if (!q.unit) return [null, false];
  const u = q.unit;
  const phase = `campaign:act-${actNo}`;
  const existing = db.get<{ id: number; source_id: number | null; track_id: string; kind: string; title: string; phase: string | null; difficulty: number | null; retired_at: number | null }>(
    'SELECT id, source_id, track_id, kind, title, phase, difficulty, retired_at FROM unit WHERE key = ?',
    u.key,
  );
  if (!existing) {
    return [
      db.run(
        `INSERT INTO unit (key, track_id, kind, title, code, phase, difficulty, xp, target_level, source_id, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?)`,
        u.key,
        track,
        u.kind,
        u.title,
        phase,
        u.difficulty,
        sourceId,
        nowMs(now),
      ).lastInsertRowid,
      true,
    ];
  }
  if (existing.source_id !== sourceId) throw new CampaignLoadError(`unit key ${u.key} already belongs to another source (source_id ${String(existing.source_id)})`);
  if (existing.kind !== u.kind || existing.track_id !== track) {
    // attempts / XP reference this unit: a kind or track change is never silently applied
    throw new CampaignLoadError(`campaign unit ${u.key} changed kind/track (${existing.kind}/${existing.track_id} -> ${u.kind}/${track}); refusing`);
  }
  let changed = false;
  if (existing.title !== u.title || existing.phase !== phase || existing.difficulty !== u.difficulty) {
    db.run('UPDATE unit SET title = ?, phase = ?, difficulty = ? WHERE id = ?', u.title, phase, u.difficulty, existing.id);
    changed = true;
  }
  if (existing.retired_at !== null) {
    db.run('UPDATE unit SET retired_at = NULL WHERE id = ?', existing.id);
    changed = true;
  }
  return [existing.id, changed];
}

const QUEST_COLS = [
  'act_id',
  'unit_id',
  'repo',
  'index_rank',
  'verdict',
  'confidence',
  'difficulty',
  'richness',
  'stack',
  'kind',
  'core',
  'family',
  'family_pick',
  'quest_kind',
  'ordinal',
  'content_pending',
  'title',
  'twin_repo',
  'provenance',
] as const;

/**
 * Values in QUEST_COLS order; core / family_pick are booleans because db/hygiene reads those columns back as booleans.
 * W8: content_pending is the pack's flag UNLESS the quest's unit already carries a check (the study-quest
 * loader, store/study-quests.ts, gave it its seeded quiz gate) — so a reload never re-flags a playable quest.
 */
function questValues(q: CampaignQuest, actId: number, unitId: number | null, ordinal: number, gated: boolean): (string | number | boolean | null)[] {
  return [
    actId,
    unitId,
    q.repo,
    q.rank,
    q.verdict,
    q.confidence,
    q.difficulty,
    q.richness,
    q.stack,
    q.repoKind,
    q.core,
    q.family,
    q.familyPick,
    q.kind,
    ordinal,
    q.contentPending && !gated ? 1 : 0,
    q.title,
    q.twinRepo,
    JSON.stringify(q.provenance),
  ];
}

/** Upsert a verified campaign into the DB (one transaction) and assert loaded === built. */
export function loadCampaignIntoDb(db: Db, c: LoadedCampaign, now: Clock): CampaignLoadStats {
  return db.tx(() => {
    const sourceId = upsertSource(db, c, now);
    const stats: CampaignLoadStats = { tracks: [], inserted: 0, updated: 0, unchanged: 0, removed: 0 };
    for (const file of c.tracks) {
      const prefix = `campaign/${file.track}/`;
      const keep = new Set<string>();
      const actIds = new Map<number, number>();
      for (const a of file.acts) {
        const actId = upsertAct(db, file.track, a);
        actIds.set(a.actNo, actId);
        a.quests.forEach((q, i) => {
          keep.add(q.key);
          const [unitId, unitChanged] = upsertQuestUnit(db, file.track, a.actNo, sourceId, q, now);
          const gated = unitId !== null && db.get('SELECT 1 AS x FROM "check" WHERE unit_id = ? LIMIT 1', unitId) !== undefined;
          const want = questValues(q, actId, unitId, i + 1, gated);
          const have = db.get<Record<string, string | number | boolean | null> & { id: number }>(`SELECT id, ${QUEST_COLS.join(', ')} FROM quest WHERE key = ?`, q.key);
          if (!have) {
            db.run(`INSERT INTO quest (key, ${QUEST_COLS.join(', ')}) VALUES (?, ${QUEST_COLS.map(() => '?').join(', ')})`, q.key, ...want);
            stats.inserted++;
            return;
          }
          const differs = QUEST_COLS.some((col, j) => (have[col] ?? null) !== want[j]);
          if (differs) db.run(`UPDATE quest SET ${QUEST_COLS.map((col) => `${col} = ?`).join(', ')} WHERE id = ?`, ...want, have.id);
          stats[differs || unitChanged ? 'updated' : 'unchanged']++;
        });
      }
      // quests that left the pack: delete the (mutable) quest row, retire the unit (history keeps its FK target)
      const stale = db
        .all<{ id: number; key: string; unitId: number | null }>('SELECT id, key, unit_id AS unitId FROM quest WHERE substr(key, 1, ?) = ?', prefix.length, prefix)
        .filter((r) => !keep.has(r.key));
      for (const s of stale) {
        db.run('DELETE FROM quest WHERE id = ?', s.id);
        stats.removed++;
      }
      const staleUnits = db
        .all<{ id: number; key: string }>('SELECT id, key FROM unit WHERE source_id = ? AND substr(key, 1, ?) = ? AND retired_at IS NULL', sourceId, prefix.length, prefix)
        .filter((u) => !file.acts.some((a) => a.quests.some((q) => q.unit?.key === u.key)));
      for (const u of staleUnits) db.run('UPDATE unit SET retired_at = ? WHERE id = ?', nowMs(now), u.id);
      // acts beyond the pack's act list: removed once empty (quests reference them)
      for (const r of db.all<{ id: number; actNo: number }>('SELECT id, act_no AS actNo FROM campaign_act WHERE track_id = ?', file.track)) {
        if (actIds.has(r.actNo)) continue;
        if (db.get('SELECT 1 AS x FROM quest WHERE act_id = ? LIMIT 1', r.id)) throw new CampaignLoadError(`act ${file.track}/${r.actNo} left the pack but still holds non-campaign quests`);
        db.run('DELETE FROM skill_node WHERE act_id = ?', r.id);
        db.run('DELETE FROM campaign_act WHERE id = ?', r.id);
      }

      // ---- loaded === built
      const built = file.acts.reduce((n, a) => n + a.quests.length, 0);
      const builtUnits = file.acts.reduce((n, a) => n + a.quests.filter((q) => q.unit !== null).length, 0);
      const loaded = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM quest WHERE substr(key, 1, ?) = ?', prefix.length, prefix)!.n;
      const units = db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM unit WHERE source_id = ? AND substr(key, 1, ?) = ? AND retired_at IS NULL',
        sourceId,
        prefix.length,
        prefix,
      )!.n;
      const perActBad = file.acts.filter(
        (a) => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM quest WHERE act_id = ? AND substr(key, 1, ?) = ?', actIds.get(a.actNo), prefix.length, prefix)!.n !== a.quests.length,
      );
      const linkedBad = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM quest q JOIN unit u ON u.id = q.unit_id WHERE substr(q.key, 1, ?) = ? AND (u.key <> q.key OR u.retired_at IS NOT NULL)`,
        prefix.length,
        prefix,
      )!.n;
      if (loaded !== built || units !== builtUnits || perActBad.length > 0 || linkedBad > 0) {
        throw new CampaignLoadError(
          `campaign loaded !== built for ${file.track}: quests ${loaded} vs ${built}, live units ${units} vs ${builtUnits}` +
            (perActBad.length ? `; act(s) ${perActBad.map((a) => a.actNo).join(', ')} differ` : '') +
            (linkedBad ? `; ${linkedBad} quest(s) point at a wrong or retired unit` : ''),
        );
      }
      stats.tracks.push({ track: file.track, acts: file.acts.length, built, loaded, units });
    }
    return stats;
  });
}
