import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CheckSpec,
  countPackUnits,
  PackCourseFile,
  PackManifest,
  PackQuarantine,
  PackValidationStamp,
  type PackCounts,
  type PackUnit,
} from '@bootquest/shared';
import type { UnitContentEntry } from '@bootquest/shared/api';
import type { Db } from '../db/database.ts';
import { nowMs, type Clock } from '../engines/clock.ts';
import { LIVE_CHECK_SQL, liveChecks, reconcileCheck } from './check-policy.ts';
import { insertCheck } from './content.ts';
import { graderFingerprint, graderKindForManifest, toolchainVersions, type GraderKind } from './grader-fingerprint.ts';

/**
 * Content loader for imported packs (W2). Packs (content/packs/<source>/) are
 * the store of record; at startup the server:
 *   0. REFUSES a pack without a matching import-gate stamp (validation.json:
 *      manifest sha256 + grader fingerprint + quarantine keys) — W2b/F1;
 *   1. reads manifest.json and every selected course file, verifying each
 *      file's sha256 against the manifest and its per-type counts;
 *   2. upserts every non-quarantined unit into the DB, keyed by
 *      (source, stable key) — idempotent: a second load changes nothing;
 *      a quarantined unit already in the DB is RETIRED (retired_at), never
 *      deleted (attempt/XP history keeps its FK target) — W2b/F2; a re-seeded
 *      check follows THE re-seed policy (store/check-policy.ts): updated in
 *      place while unreferenced, retired-and-replaced once history references it;
 *   3. asserts loaded === built (live DB units + checks + content entries vs
 *      the manifest counts minus quarantine) and REFUSES TO START on a mismatch.
 * Per-unit content (instructions, starter, solution, ...) is served from
 * memory via packContentEntries(); it never enters the DB.
 */

export class PackLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackLoadError';
  }
}

export interface LoadedPack {
  dir: string;
  manifest: PackManifest;
  courses: PackCourseFile[];
  /** keys withheld by seed:validate's quarantine list */
  quarantined: Map<string, string>;
  /** the verified import-gate stamp; null only when loaded with allowUnstamped */
  stamp: PackValidationStamp | null;
}

export const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');

/** The opt-out env var: set by test harnesses / the smoke ONLY. The real serve path never sets it. */
export const ALLOW_UNSTAMPED_ENV = 'BOOTQUEST_PACKS_ALLOW_UNSTAMPED';
const RUN_GATE = 'run `npm run seed:validate` (full scope, no --course) to completion';

export interface ReadPackOptions {
  /** restrict which course files are read; built counts then cover only those courses */
  courses?: readonly string[];
  /**
   * Tests / smoke only: accept a pack without a (matching) validation stamp
   * and treat a missing quarantine.json as empty. A malformed quarantine.json
   * is still a hard error.
   */
  allowUnstamped?: boolean;
}

function readQuarantine(dir: string, source: string, required: boolean): Map<string, string> {
  const quarantined = new Map<string, string>();
  const qPath = join(dir, 'quarantine.json');
  if (!existsSync(qPath)) {
    if (required) throw new PackLoadError(`pack ${source}: no quarantine.json (seed:validate always writes one, even empty) — ${RUN_GATE}`);
    return quarantined;
  }
  let q: PackQuarantine;
  try {
    q = PackQuarantine.parse(JSON.parse(readFileSync(qPath, 'utf8')));
  } catch (err) {
    throw new PackLoadError(`pack ${source}: quarantine.json is malformed (${err instanceof Error ? err.message.slice(0, 200) : String(err)}) — fix or restore it, then ${RUN_GATE}`);
  }
  if (q.source !== source) throw new PackLoadError(`quarantine.json is for ${q.source}, not ${source}`);
  for (const e of q.entries) quarantined.set(e.key, e.reason);
  return quarantined;
}

/** F1: refuse a pack the import gate has not (or no longer) vouched for. */
function verifyStamp(dir: string, manifest: PackManifest, manifestBytes: Buffer, quarantined: ReadonlyMap<string, string>): PackValidationStamp {
  const sPath = join(dir, 'validation.json');
  const who = `pack ${manifest.source}`;
  if (!existsSync(sPath)) {
    throw new PackLoadError(`${who}: no validation stamp (validation.json) — the import gate has not completed for this pack; ${RUN_GATE}`);
  }
  let stamp: PackValidationStamp;
  try {
    stamp = PackValidationStamp.parse(JSON.parse(readFileSync(sPath, 'utf8')));
  } catch (err) {
    throw new PackLoadError(`${who}: validation.json is malformed (${err instanceof Error ? err.message.slice(0, 200) : String(err)}); ${RUN_GATE}`);
  }
  if (stamp.source !== manifest.source) throw new PackLoadError(`${who}: validation.json is for ${stamp.source}`);
  const manifestSha = sha256(manifestBytes);
  if (stamp.manifestSha256 !== manifestSha) {
    throw new PackLoadError(`${who}: validation stamp is for manifest ${stamp.manifestSha256.slice(0, 12)}, not the current ${manifestSha.slice(0, 12)} (re-imported since validation?); ${RUN_GATE}`);
  }
  // W3a/W3c: the stamp is bound to the grader KIND that executes this pack (js | csharp | selfrun)
  let kind: GraderKind;
  let fp: string;
  try {
    kind = graderKindForManifest(manifest);
    fp = graderFingerprint(kind);
  } catch (err) {
    throw new PackLoadError(`${who}: cannot compute the grader fingerprint (${err instanceof Error ? err.message.slice(0, 300) : String(err)})`);
  }
  if ((stamp.graderKind ?? 'js') !== kind) {
    throw new PackLoadError(`${who}: validation stamp is for the ${stamp.graderKind ?? 'js'} grader, but pack ${manifest.source} (track ${manifest.track}) is graded by ${kind}; ${RUN_GATE}`);
  }
  if (stamp.graderFingerprint !== fp) {
    const fmtT = (t: Record<string, string | undefined>) =>
      Object.entries(t)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(' ');
    throw new PackLoadError(
      `${who}: validation stamp grader fingerprint ${stamp.graderFingerprint.slice(0, 12)} != current ${kind} ${fp.slice(0, 12)} ` +
        `(grader/validator bytes or toolchain changed; stamped ${fmtT(stamp.toolchain)}, now ${fmtT({ ...toolchainVersions(kind) })}); ${RUN_GATE}`,
    );
  }
  if (JSON.stringify(stamp.counts) !== JSON.stringify(manifest.totals)) {
    throw new PackLoadError(`${who}: validation stamp counts ${JSON.stringify(stamp.counts)} != manifest totals ${JSON.stringify(manifest.totals)}; ${RUN_GATE}`);
  }
  const qKeys = [...quarantined.keys()].sort();
  const sKeys = [...stamp.quarantinedKeys].sort();
  if (JSON.stringify(qKeys) !== JSON.stringify(sKeys)) {
    throw new PackLoadError(`${who}: quarantine.json (${qKeys.length} keys) does not match the validation stamp (${sKeys.length} keys) — edited after validation?; ${RUN_GATE}`);
  }
  return stamp;
}

/**
 * Read + verify a pack directory: manifest, per-file sha256 + counts, the
 * quarantine list and (unless allowUnstamped) the import-gate stamp.
 */
export function readPack(dir: string, opts: ReadPackOptions = {}): LoadedPack {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new PackLoadError(`pack ${dir}: no manifest.json`);
  const manifestBytes = readFileSync(manifestPath);
  const manifest = PackManifest.parse(JSON.parse(manifestBytes.toString('utf8')));
  const quarantined = readQuarantine(dir, manifest.source, !opts.allowUnstamped);
  const stamp = opts.allowUnstamped ? null : verifyStamp(dir, manifest, manifestBytes, quarantined);
  const wanted = opts.courses ? new Set(opts.courses) : null;
  if (wanted) {
    const known = new Set(manifest.courses.map((c) => c.id));
    const unknown = [...wanted].filter((c) => !known.has(c));
    if (unknown.length) throw new PackLoadError(`pack ${manifest.source}: unknown course(s) ${unknown.join(', ')}`);
  }
  const courses: PackCourseFile[] = [];
  for (const mc of [...manifest.courses].sort((a, b) => a.order - b.order)) {
    if (wanted && !wanted.has(mc.id)) continue;
    const bytes = readFileSync(join(dir, mc.file));
    const actual = sha256(bytes);
    if (actual !== mc.sha256) {
      throw new PackLoadError(`pack ${manifest.source}/${mc.file}: sha256 ${actual} does not match the manifest (${mc.sha256}) — re-run the importer`);
    }
    const file = PackCourseFile.parse(JSON.parse(bytes.toString('utf8')));
    if (file.source !== manifest.source || file.course.id !== mc.id) {
      throw new PackLoadError(`pack ${manifest.source}/${mc.file}: declares ${file.source}/${file.course.id}`);
    }
    const counts = countPackUnits(file.units);
    if (JSON.stringify(counts) !== JSON.stringify(mc.counts)) {
      throw new PackLoadError(`pack ${manifest.source}/${mc.id}: units count ${JSON.stringify(counts)} != manifest ${JSON.stringify(mc.counts)}`);
    }
    const prefix = unitKeyPrefix(manifest.source, mc.id);
    for (const u of file.units) {
      if (!u.unit.key.startsWith(prefix)) throw new PackLoadError(`unit key ${u.unit.key} must start with ${prefix}`);
    }
    courses.push(file);
  }
  return { dir, manifest, courses, quarantined, stamp };
}

export const unitKeyPrefix = (source: string, course: string): string => `${source}/${course}/`;

export interface LoadStats {
  source: string;
  courses: string[];
  inserted: number;
  updated: number;
  unchanged: number;
  /** quarantined units of the selected courses (not shipped) */
  withheld: number;
  /** quarantined units that were live in the DB and got retired by this load */
  retired: number;
  /** re-seeded checks that attempts/runs referenced: retired (kept for history) and replaced by a new live check */
  checksReplaced: number;
  /** built = manifest counts (selected courses) minus quarantine */
  built: number;
  /** loaded = DB units under the selected course prefixes (minus quarantine) */
  loaded: number;
  checks: number;
  contentEntries: number;
}

function upsertSource(db: Db, m: PackManifest, now: Clock): number {
  const row = db.get<{ id: number }>('SELECT id FROM source WHERE key = ?', m.source);
  const f = m.importedFrom;
  if (row) {
    db.run(
      'UPDATE source SET repo = ?, subpath = ?, role = ?, origin_kind = ?, pinned_sha = ?, local_cache_path = ? WHERE id = ?',
      f.repo,
      f.subpath,
      'pack',
      f.originKind,
      f.gitHead,
      f.path,
      row.id,
    );
    return row.id;
  }
  return db.run(
    `INSERT INTO source (key, repo, subpath, role, origin_kind, pinned_sha, local_cache_path, read_only, created_at)
     VALUES (?, ?, ?, 'pack', ?, ?, ?, 1, ?)`,
    m.source,
    f.repo,
    f.subpath,
    f.originKind,
    f.gitHead,
    f.path,
    nowMs(now),
  ).lastInsertRowid;
}

interface UnitRow {
  id: number;
  source_id: number | null;
  track_id: string;
  kind: string;
  title: string;
  phase: string | null;
  difficulty: number | null;
  xp: number | null;
  retired_at: number | null;
}

/** Upsert one unit row + its single check + competencies. Returns [id, 'inserted'|'updated'|'unchanged']. */
function upsertUnit(db: Db, sourceId: number, course: string, pu: PackUnit, now: Clock, checksReplaced: { n: number }): [number, 'inserted' | 'updated' | 'unchanged'] {
  const u = pu.unit;
  const existing = db.get<UnitRow>(
    'SELECT id, source_id, track_id, kind, title, phase, difficulty, xp, retired_at FROM unit WHERE key = ?',
    u.key,
  );
  let id: number;
  let changed = false;
  if (!existing) {
    id = db.run(
      `INSERT INTO unit (key, track_id, kind, title, code, phase, difficulty, xp, target_level, source_id, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)`,
      u.key,
      u.track,
      u.kind,
      u.title,
      course,
      u.difficulty,
      u.xp,
      sourceId,
      nowMs(now),
    ).lastInsertRowid;
  } else {
    id = existing.id;
    if (existing.source_id !== sourceId) {
      throw new PackLoadError(`unit key ${u.key} already belongs to another source (source_id ${String(existing.source_id)})`);
    }
    if (existing.kind !== u.kind || existing.track_id !== u.track) {
      // attempts/XP rows reference this unit: a kind or track change is never silently applied
      throw new PackLoadError(`unit ${u.key} changed kind/track (${existing.kind}/${existing.track_id} -> ${u.kind}/${u.track}); refusing`);
    }
    if (existing.title !== u.title || existing.phase !== course || existing.difficulty !== (u.difficulty ?? null) || existing.xp !== (u.xp ?? null)) {
      db.run('UPDATE unit SET title = ?, phase = ?, difficulty = ?, xp = ? WHERE id = ?', u.title, course, u.difficulty, u.xp, id);
      changed = true;
    }
    if (existing.retired_at !== null) {
      // left the quarantine (fixed upstream, re-imported, re-validated): live again
      db.run('UPDATE unit SET retired_at = NULL WHERE id = ?', id);
      changed = true;
    }
  }

  // single LIVE check (written units have none); a re-seeded check follows THE re-seed policy
  // (store/check-policy.ts): in place while unreferenced, retired-and-replaced once attempts or runs
  // reference it — so past attempts keep the exact spec (choices, key, threshold) they were graded by
  const want = u.checks[0];
  const have = liveChecks(db, id);
  if (want) {
    const spec = CheckSpec.parse(want.spec);
    const first = have[0];
    if (!first) {
      insertCheck(db, id, spec, now, want.threshold === undefined ? {} : { threshold: want.threshold });
      changed = true;
    } else {
      if (have.length > 1) throw new PackLoadError(`unit ${u.key} has ${have.length} live checks in the DB; packs carry one`);
      if (first.type !== spec.type) throw new PackLoadError(`unit ${u.key} check type changed ${first.type} -> ${spec.type}; refusing`);
      const r = reconcileCheck(db, id, first, { spec, threshold: want.threshold ?? null }, now);
      if (r.outcome !== 'unchanged') changed = true;
      if (r.outcome === 'replaced') checksReplaced.n++;
    }
  } else if (have.length > 0) {
    throw new PackLoadError(`unit ${u.key} has a check in the DB but none in the pack; refusing`);
  }

  // competencies (join table, not append-only)
  const comps = db.all<{ c: string }>('SELECT competency_id AS c FROM unit_competency WHERE unit_id = ? ORDER BY competency_id', id).map((r) => r.c);
  const wantComps = [...new Set(u.competencies)].sort();
  if (JSON.stringify(comps) !== JSON.stringify(wantComps)) {
    db.run('DELETE FROM unit_competency WHERE unit_id = ?', id);
    for (const c of wantComps) db.run('INSERT INTO unit_competency (unit_id, competency_id) VALUES (?, ?)', id, c);
    changed = true;
  }
  return [id, !existing ? 'inserted' : changed ? 'updated' : 'unchanged'];
}

/** Bring a unit's prerequisite edges in line with the pack (after all units exist). */
function syncPrereqs(db: Db, unitId: number, prereqKeys: readonly string[], idOf: (key: string) => number): boolean {
  const have = db
    .all<{ p: number }>('SELECT prereq_unit_id AS p FROM unit_prerequisite WHERE unit_id = ? ORDER BY prereq_unit_id', unitId)
    .map((r) => r.p);
  const want = [...new Set(prereqKeys.map(idOf))].sort((a, b) => a - b);
  if (JSON.stringify(have) === JSON.stringify(want)) return false;
  db.run('DELETE FROM unit_prerequisite WHERE unit_id = ?', unitId);
  for (const p of want) db.run('INSERT INTO unit_prerequisite (unit_id, prereq_unit_id) VALUES (?, ?)', unitId, p);
  return true;
}

/** Bring a unit's variation_of_unit_id (BootForge reviewOf, a review HINT — W2b/F6) in line with the pack. */
function syncVariation(db: Db, unitId: number, target: number | null): boolean {
  const have = db.get<{ v: number | null }>('SELECT variation_of_unit_id AS v FROM unit WHERE id = ?', unitId)?.v ?? null;
  if (have === target) return false;
  db.run('UPDATE unit SET variation_of_unit_id = ? WHERE id = ?', target, unitId);
  return true;
}

/**
 * Upsert a verified pack into the DB (one transaction) and assert
 * loaded === built. Throws PackLoadError (and rolls back) on any mismatch.
 */
export function loadPackIntoDb(db: Db, pack: LoadedPack, now: Clock): LoadStats {
  const { manifest, quarantined } = pack;
  return db.tx(() => {
    const sourceId = upsertSource(db, manifest, now);
    const stats: LoadStats = {
      source: manifest.source,
      courses: pack.courses.map((c) => c.course.id),
      inserted: 0,
      updated: 0,
      unchanged: 0,
      withheld: 0,
      retired: 0,
      checksReplaced: 0,
      built: 0,
      loaded: 0,
      checks: 0,
      contentEntries: 0,
    };
    const ids = new Map<string, number>();
    const replaced = { n: 0 };
    const shipped: { pu: PackUnit; id: number; what: 'inserted' | 'updated' | 'unchanged' }[] = [];
    for (const file of pack.courses) {
      for (const pu of file.units) {
        if (quarantined.has(pu.unit.key)) {
          stats.withheld++;
          // F2: quarantined after it was loaded -> withdraw it (retire; history rows keep their FK target)
          const live = db.get<{ id: number; source_id: number | null }>('SELECT id, source_id FROM unit WHERE key = ? AND retired_at IS NULL', pu.unit.key);
          if (live) {
            if (live.source_id !== sourceId) throw new PackLoadError(`unit key ${pu.unit.key} already belongs to another source (source_id ${String(live.source_id)})`);
            db.run('UPDATE unit SET retired_at = ? WHERE id = ?', nowMs(now), live.id);
            stats.retired++;
          }
          continue;
        }
        const [id, what] = upsertUnit(db, sourceId, file.course.id, pu, now, replaced);
        ids.set(pu.unit.key, id);
        shipped.push({ pu, id, what });
      }
    }
    // pass 2: prerequisite edges + variation hints (targets may appear later in upstream order)
    const idOf = (key: string): number => {
      if (quarantined.has(key)) throw new PackLoadError(`prerequisite ${key} is quarantined`);
      const known = ids.get(key);
      if (known === undefined) throw new PackLoadError(`prerequisite ${key} is not in the loaded courses`);
      return known;
    };
    const variationTarget = (key: string): number | null => {
      // a hint, not a gate: a quarantined original simply has no live variant link
      if (quarantined.has(key)) return null;
      const known = ids.get(key);
      if (known !== undefined) return known;
      const row = db.get<{ id: number }>('SELECT id FROM unit WHERE key = ? AND source_id = ? AND retired_at IS NULL', key, sourceId);
      if (!row) throw new PackLoadError(`variationOf ${key} is not in the loaded courses or the DB`);
      return row.id;
    };
    for (const s of shipped) {
      const edgesChanged = syncPrereqs(db, s.id, s.pu.unit.prerequisites, idOf);
      const v = s.pu.unit.variationOf;
      const variationChanged = syncVariation(db, s.id, v === undefined ? null : variationTarget(v));
      stats[(edgesChanged || variationChanged) && s.what === 'unchanged' ? 'updated' : s.what]++;
    }

    // ---- loaded === built
    for (const file of pack.courses) {
      const mc = manifest.courses.find((c) => c.id === file.course.id)!;
      const withheldHere = file.units.filter((u) => quarantined.has(u.unit.key));
      const built = mc.counts.total - withheldHere.length;
      const builtChecks = built - (mc.counts.written - withheldHere.filter((u) => u.origin.type === 'written').length);
      const prefix = unitKeyPrefix(manifest.source, file.course.id);
      // live = not retired: a quarantined key can only be counted out by being retired, never by a filter
      const live = db.all<{ key: string; checks: number }>(
        `SELECT u.key AS key, (SELECT COUNT(*) FROM "check" c WHERE c.unit_id = u.id AND c.${LIVE_CHECK_SQL}) AS checks
           FROM unit u WHERE u.source_id = ? AND substr(u.key, 1, ?) = ? AND u.retired_at IS NULL`,
        sourceId,
        prefix.length,
        prefix,
      );
      const packKeys = new Set(file.units.map((u) => u.unit.key));
      const stale = live.filter((r) => !packKeys.has(r.key)).map((r) => r.key);
      const liveQuarantined = live.filter((r) => quarantined.has(r.key)).map((r) => r.key);
      const loaded = live.length;
      const checks = live.reduce((n, r) => n + r.checks, 0);
      if (loaded !== built || checks !== builtChecks || stale.length > 0 || liveQuarantined.length > 0) {
        throw new PackLoadError(
          `loaded !== built for ${manifest.source}/${file.course.id}: units loaded ${loaded} vs built ${built}, ` +
            `checks loaded ${checks} vs built ${builtChecks}` +
            (stale.length ? `; ${stale.length} DB unit(s) not in the pack: ${stale.slice(0, 5).join(', ')}` : '') +
            (liveQuarantined.length ? `; ${liveQuarantined.length} quarantined unit(s) still live: ${liveQuarantined.slice(0, 5).join(', ')}` : ''),
        );
      }
      stats.built += built;
      stats.loaded += loaded;
      stats.checks += checks;
    }
    stats.checksReplaced = replaced.n;
    const content = packContentEntries(pack);
    stats.contentEntries = content.size;
    if (content.size !== stats.built) {
      throw new PackLoadError(`content entries ${content.size} !== built ${stats.built} for ${manifest.source}`);
    }
    return stats;
  });
}

/** Per-unit content of the shipped (non-quarantined) units of a pack. */
export function packContentEntries(pack: LoadedPack): Map<string, UnitContentEntry> {
  const out = new Map<string, UnitContentEntry>();
  for (const file of pack.courses) {
    for (const u of file.units) {
      if (pack.quarantined.has(u.unit.key)) continue;
      const entry = file.content[u.unit.key];
      if (!entry) throw new PackLoadError(`no content entry for ${u.unit.key}`);
      out.set(u.unit.key, entry);
    }
  }
  return out;
}

/** Built counts for a pack's selected courses (manifest per-type counts, before quarantine). */
export function builtCounts(pack: LoadedPack): PackCounts {
  const c = { total: 0, code: 0, quiz: 0, output: 0, written: 0 };
  for (const file of pack.courses) {
    const mc = pack.manifest.courses.find((x) => x.id === file.course.id)!;
    for (const k of Object.keys(c) as (keyof typeof c)[]) c[k] += mc.counts[k];
  }
  return c;
}
