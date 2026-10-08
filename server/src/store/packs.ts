import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CheckSpec,
  countPackUnits,
  PackCourseFile,
  PackManifest,
  PackQuarantine,
  type PackCounts,
  type PackUnit,
} from '@bootquest/shared';
import type { UnitContentEntry } from '@bootquest/shared/api';
import type { Db } from '../db/database.ts';
import { nowMs, type Clock } from '../engines/clock.ts';
import { insertCheck } from './content.ts';

/**
 * Content loader for imported packs (W2). Packs (content/packs/<source>/) are
 * the store of record; at startup the server:
 *   1. reads manifest.json and every selected course file, verifying each
 *      file's sha256 against the manifest and its per-type counts;
 *   2. upserts every non-quarantined unit into the DB, keyed by
 *      (source, stable key) — idempotent: a second load changes nothing;
 *   3. asserts loaded === built (DB units + checks + content entries vs the
 *      manifest counts minus quarantine) and REFUSES TO START on a mismatch.
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
}

export const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');

/**
 * Read + verify a pack directory. `courses` (optional) restricts which course
 * files are read; built counts then cover only those courses.
 */
export function readPack(dir: string, opts: { courses?: readonly string[] } = {}): LoadedPack {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new PackLoadError(`pack ${dir}: no manifest.json`);
  const manifest = PackManifest.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
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
  const quarantined = new Map<string, string>();
  const qPath = join(dir, 'quarantine.json');
  if (existsSync(qPath)) {
    const q = PackQuarantine.parse(JSON.parse(readFileSync(qPath, 'utf8')));
    if (q.source !== manifest.source) throw new PackLoadError(`quarantine.json is for ${q.source}, not ${manifest.source}`);
    for (const e of q.entries) quarantined.set(e.key, e.reason);
  }
  return { dir, manifest, courses, quarantined };
}

export const unitKeyPrefix = (source: string, course: string): string => `${source}/${course}/`;

export interface LoadStats {
  source: string;
  courses: string[];
  inserted: number;
  updated: number;
  unchanged: number;
  withheld: number;
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
}

/** Upsert one unit row + its single check + competencies. Returns [id, 'inserted'|'updated'|'unchanged']. */
function upsertUnit(db: Db, sourceId: number, course: string, pu: PackUnit, now: Clock): [number, 'inserted' | 'updated' | 'unchanged'] {
  const u = pu.unit;
  const existing = db.get<UnitRow>(
    'SELECT id, source_id, track_id, kind, title, phase, difficulty, xp FROM unit WHERE key = ?',
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
  }

  // single check (written units have none)
  const want = u.checks[0];
  const have = db.all<{ id: number; type: string; spec: string; threshold: number | null }>(
    'SELECT id, type, spec, threshold FROM "check" WHERE unit_id = ? ORDER BY id',
    id,
  );
  if (want) {
    const spec = CheckSpec.parse(want.spec);
    const json = JSON.stringify(spec);
    const first = have[0];
    if (!first) {
      insertCheck(db, id, spec, now, want.threshold === undefined ? {} : { threshold: want.threshold });
      changed = true;
    } else {
      if (have.length > 1) throw new PackLoadError(`unit ${u.key} has ${have.length} checks in the DB; packs carry one`);
      if (first.type !== spec.type) throw new PackLoadError(`unit ${u.key} check type changed ${first.type} -> ${spec.type}; refusing`);
      if (first.spec !== json || first.threshold !== (want.threshold ?? null)) {
        db.run('UPDATE "check" SET spec = ?, threshold = ? WHERE id = ?', json, want.threshold, first.id);
        changed = true;
      }
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
      built: 0,
      loaded: 0,
      checks: 0,
      contentEntries: 0,
    };
    const ids = new Map<string, number>();
    const shipped: { pu: PackUnit; id: number; what: 'inserted' | 'updated' | 'unchanged' }[] = [];
    for (const file of pack.courses) {
      for (const pu of file.units) {
        if (quarantined.has(pu.unit.key)) {
          stats.withheld++;
          continue;
        }
        const [id, what] = upsertUnit(db, sourceId, file.course.id, pu, now);
        ids.set(pu.unit.key, id);
        shipped.push({ pu, id, what });
      }
    }
    // pass 2: prerequisite edges (targets may appear later in upstream order)
    const idOf = (key: string): number => {
      if (quarantined.has(key)) throw new PackLoadError(`prerequisite ${key} is quarantined`);
      const known = ids.get(key);
      if (known === undefined) throw new PackLoadError(`prerequisite ${key} is not in the loaded courses`);
      return known;
    };
    for (const s of shipped) {
      const edgesChanged = syncPrereqs(db, s.id, s.pu.unit.prerequisites, idOf);
      stats[edgesChanged && s.what === 'unchanged' ? 'updated' : s.what]++;
    }

    // ---- loaded === built
    for (const file of pack.courses) {
      const mc = manifest.courses.find((c) => c.id === file.course.id)!;
      const withheldHere = file.units.filter((u) => quarantined.has(u.unit.key));
      const built = mc.counts.total - withheldHere.length;
      const builtChecks = built - (mc.counts.written - withheldHere.filter((u) => u.origin.type === 'written').length);
      const prefix = unitKeyPrefix(manifest.source, file.course.id);
      const rows = db.all<{ key: string; checks: number }>(
        `SELECT u.key AS key, (SELECT COUNT(*) FROM "check" c WHERE c.unit_id = u.id) AS checks
           FROM unit u WHERE u.source_id = ? AND substr(u.key, 1, ?) = ?`,
        sourceId,
        prefix.length,
        prefix,
      );
      const live = rows.filter((r) => !quarantined.has(r.key));
      const packKeys = new Set(file.units.map((u) => u.unit.key));
      const stale = live.filter((r) => !packKeys.has(r.key)).map((r) => r.key);
      const loaded = live.length;
      const checks = live.reduce((n, r) => n + r.checks, 0);
      if (loaded !== built || checks !== builtChecks || stale.length > 0) {
        throw new PackLoadError(
          `loaded !== built for ${manifest.source}/${file.course.id}: units loaded ${loaded} vs built ${built}, ` +
            `checks loaded ${checks} vs built ${builtChecks}` +
            (stale.length ? `; ${stale.length} DB unit(s) not in the pack: ${stale.slice(0, 5).join(', ')}` : ''),
        );
      }
      stats.built += built;
      stats.loaded += loaded;
      stats.checks += checks;
    }
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
