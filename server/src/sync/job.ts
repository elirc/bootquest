import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CheckSpec, ContentRef, LessonSpec } from '@bootquest/shared';
import {
  PROGRAM_JSON_PATH,
  SyncReport,
  type CheckSpecTable,
  type CurriculumConfig,
  type SourceEntry,
  type SyncRepoReport,
} from '@bootquest/shared/sync';
import type { Db } from '../db/database.ts';
import { nowMs, type Clock } from '../engines/clock.ts';
import { checkReferenced, LIVE_CHECK_SQL } from '../store/check-policy.ts';
import { insertCheck, insertContentRef, insertUnit } from '../store/content.ts';
import { listFiles, type GithubCache } from './cache.ts';
import { pathSelected } from './config.ts';
import { NetworkUnavailableError, type GithubClient } from './github.ts';
import { assignStableKeys, parseMarkdownSections, STABLE_KEY_ALGO, type KeyedSection } from './markdown.ts';
import {
  gitBlobSha,
  mapCompetencies,
  milestoneLine,
  programRefKey,
  programUnitKey,
  ProgramError,
  readProgram,
  recordedCheckSpec,
  sha256Hex,
} from './program.ts';
import { TsconfigChainError, verifyTsconfigChain } from './tsconfig-chain.ts';

/**
 * The sync job (spec §3.2 / §7 `seed:sync`; BUILD-PLAN W4). For every
 * registered repo: resolve the commit (curriculum.yaml pin > remote HEAD >
 * offline fallback to the last synced sha), make sure that sha's tarball is
 * cached and extracted, walk its markdown, upsert content_ref rows keyed by
 * (repo, stable_key), mark refs that vanished as 'missing-at-sha', queue every
 * stable_key never seen before for the next seed session, and register a
 * first-class program.json as units. Writes POINTERS only — the DB never
 * receives curriculum text (titles are heading text; summary stays null until a
 * seed session authors one).
 */

export interface SyncDeps {
  db: Db;
  clock: Clock;
  github: GithubClient;
  cache: GithubCache;
  config: CurriculumConfig;
  /** recorded node-test-file spec table; null = program units register as study units only */
  checkTable: CheckSpecTable | null;
  log?: (line: string) => void;
}

export interface SyncOptions {
  repos?: string[];
}

export class SyncConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncConfigError';
  }
}

/** A registered ref candidate (markdown section or program milestone) before it meets the DB. */
interface RefCandidate {
  stableKey: string;
  path: string;
  anchor: string | null;
  title: string;
  lineStart: number | null;
  lineEnd: number | null;
  kind: 'guide' | 'program-unit';
  provenance: 'frontmatter' | 'heading-hash' | 'json-pointer';
}

interface RefRow {
  id: number;
  path: string;
  sha: string;
  anchor: string | null;
  title: string;
  line_start: number | null;
  line_end: number | null;
  kind: string;
  provenance: string;
  status: string;
  source_id: number | null;
}

const SYNC_KINDS = ['guide', 'program-unit'] as const;

function sourceKey(repo: string): string {
  return `github:${repo}`;
}

function upsertSource(db: Db, e: SourceEntry, t: number): { id: number; lastSyncedSha: string | null } {
  const row = db.get<{ id: number; last_synced_sha: string | null }>('SELECT id, last_synced_sha FROM source WHERE key = ?', sourceKey(e.repo));
  if (row) {
    db.run('UPDATE source SET role = ?, pinned_sha = ? WHERE id = ?', e.role, e.pinned_sha ?? null, row.id);
    return { id: row.id, lastSyncedSha: row.last_synced_sha };
  }
  const id = db.run(
    `INSERT INTO source (key, repo, subpath, role, origin_kind, pinned_sha, read_only, created_at)
     VALUES (?, ?, '', ?, 'github', ?, 1, ?)`,
    sourceKey(e.repo),
    e.repo,
    e.role,
    e.pinned_sha ?? null,
    t,
  ).lastInsertRowid;
  return { id, lastSyncedSha: null };
}

function candidatesFromSections(sections: KeyedSection[]): RefCandidate[] {
  return sections.map((s) => ({
    stableKey: s.stableKey,
    path: s.path,
    anchor: s.anchor,
    title: s.title,
    lineStart: s.lineStart,
    lineEnd: s.lineEnd,
    kind: 'guide',
    provenance: s.provenance,
  }));
}

interface RefOutcome {
  ids: Map<string, number>;
  inserted: number;
  updated: number;
  unchanged: number;
  missing: number;
  newIds: number[];
}

/** Upsert ref candidates for one repo; mark this source's vanished sync refs missing. Caller holds the tx. */
function upsertRefs(db: Db, repo: string, sourceId: number, sha: string, cands: RefCandidate[], t: number): RefOutcome {
  const out: RefOutcome = { ids: new Map(), inserted: 0, updated: 0, unchanged: 0, missing: 0, newIds: [] };
  for (const c of cands) {
    const existing = db.get<RefRow>(
      `SELECT id, path, sha, anchor, title, line_start, line_end, kind, provenance, status, source_id
         FROM content_ref WHERE repo = ? AND stable_key = ?`,
      repo,
      c.stableKey,
    );
    if (!existing) {
      const id = insertContentRef(
        db,
        {
          repo,
          path: c.path,
          sha,
          anchor: c.anchor,
          title: c.title,
          summary: null,
          stableKey: c.stableKey,
          stableKeyAlgo: STABLE_KEY_ALGO,
          lineStart: c.lineStart,
          lineEnd: c.lineEnd,
          kind: c.kind,
          provenance: c.provenance,
          status: 'ok',
        },
        () => new Date(t),
        sourceId,
      );
      out.ids.set(c.stableKey, id);
      out.inserted++;
      out.newIds.push(id);
      continue;
    }
    out.ids.set(c.stableKey, existing.id);
    const same =
      existing.path === c.path &&
      existing.sha === sha &&
      existing.anchor === c.anchor &&
      existing.title === c.title &&
      existing.line_start === c.lineStart &&
      existing.line_end === c.lineEnd &&
      existing.kind === c.kind &&
      existing.provenance === c.provenance &&
      existing.status === 'ok' &&
      existing.source_id === sourceId;
    if (same) {
      out.unchanged++;
      continue;
    }
    // validate the new pointer through the same boundary schema as inserts
    const r = ContentRef.parse({
      repo,
      path: c.path,
      sha,
      anchor: c.anchor,
      title: c.title,
      stableKey: c.stableKey,
      lineStart: c.lineStart,
      lineEnd: c.lineEnd,
      kind: c.kind,
      provenance: c.provenance,
    });
    db.run(
      `UPDATE content_ref SET source_id = ?, path = ?, sha = ?, anchor = ?, title = ?, line_start = ?, line_end = ?,
              kind = ?, provenance = ?, stable_key_algo = ?, status = 'ok', updated_at = ? WHERE id = ?`,
      sourceId,
      r.path,
      r.sha,
      r.anchor,
      r.title,
      r.lineStart,
      r.lineEnd,
      r.kind,
      r.provenance,
      STABLE_KEY_ALGO,
      t,
      existing.id,
    );
    out.updated++;
  }
  // vanished: this source's sync-produced refs not present at this sha
  const present = new Set(cands.map((c) => c.stableKey));
  const rows = db.all<{ id: number; stable_key: string; status: string }>(
    `SELECT id, stable_key, status FROM content_ref WHERE repo = ? AND kind IN (${SYNC_KINDS.map(() => '?').join(', ')})`,
    repo,
    ...SYNC_KINDS,
  );
  for (const r of rows) {
    if (present.has(r.stable_key) || r.status === 'missing-at-sha') continue;
    db.run(`UPDATE content_ref SET status = 'missing-at-sha', updated_at = ? WHERE id = ?`, t, r.id);
    out.missing++;
  }
  return out;
}

interface ProgramOutcome {
  units: number;
  checked: number;
  study: number;
  checkDrift: string[];
}

interface ProgramPlan {
  repo: string;
  sha: string;
  sourceId: number;
  milestones: ReturnType<typeof readProgram>['program']['milestones'];
  /** per code: verified recorded check (or null = study unit) */
  checks: Map<string, CheckSpec | null>;
  checkDrift: string[];
  guideKeys: Map<string, string>;
  ticketKeys: Map<string, string>;
}

function registerProgram(db: Db, plan: ProgramPlan, refIds: Map<string, number>, t: number): ProgramOutcome {
  const clock = () => new Date(t);
  const out: ProgramOutcome = { units: 0, checked: 0, study: 0, checkDrift: plan.checkDrift };
  for (const m of plan.milestones) {
    const key = programUnitKey(plan.repo, m.code);
    const check = plan.checks.get(m.code) ?? null;
    const kind = check ? 'program-unit' : 'study';
    const competencies = mapCompetencies(db, m.competencies);
    const prereqKeys = m.prerequisites.map((p) => programUnitKey(plan.repo, p));
    const title = `${m.code}: ${m.title}`;
    const programRefId = refIds.get(programRefKey(m.code));
    if (programRefId === undefined) throw new ProgramError(`no program ref for ${m.code}`);
    const existing = db.get<{ id: number; kind: string }>('SELECT id, kind FROM unit WHERE key = ?', key);
    let unitId: number;
    if (!existing) {
      const spec = LessonSpec.parse({
        key,
        track: 'js',
        kind,
        title,
        code: m.code,
        phase: m.phase,
        // signalpost targetLevel (3|4) doubles as the difficulty that scales code XP (10 x difficulty)
        difficulty: m.targetLevel,
        targetLevel: m.targetLevel,
        competencies,
        prerequisites: prereqKeys,
        contentRef: { repo: plan.repo, stableKey: programRefKey(m.code) },
        checks: check ? [{ spec: check }] : [],
      });
      unitId = insertUnit(db, spec, clock);
      db.run('UPDATE unit SET source_id = ? WHERE id = ?', plan.sourceId, unitId);
    } else {
      unitId = existing.id;
      if (existing.kind !== kind) {
        out.checkDrift.push(`${m.code}: unit is ${existing.kind} in the DB but ${kind} now — kind not changed (re-seed decision)`);
      }
      db.run(
        `UPDATE unit SET title = ?, phase = ?, difficulty = ?, target_level = ?, content_ref_id = ?, source_id = ?, retired_at = NULL WHERE id = ?`,
        title,
        m.phase,
        m.targetLevel,
        m.targetLevel,
        programRefId,
        plan.sourceId,
        unitId,
      );
      db.run('DELETE FROM unit_competency WHERE unit_id = ?', unitId);
      for (const c of competencies) db.run('INSERT INTO unit_competency (unit_id, competency_id) VALUES (?, ?)', unitId, c);
      db.run('DELETE FROM unit_prerequisite WHERE unit_id = ?', unitId);
      for (const pk of prereqKeys) {
        const p = db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', pk);
        if (!p) throw new ProgramError(`${m.code}: prerequisite ${pk} is not registered`);
        db.run('INSERT INTO unit_prerequisite (unit_id, prereq_unit_id) VALUES (?, ?)', unitId, p.id);
      }
      if (check) {
        const cur = db.get<{ id: number; type: string; spec: string }>(`SELECT id, type, spec FROM "check" WHERE unit_id = ? AND ${LIVE_CHECK_SQL} ORDER BY id LIMIT 1`, unitId);
        if (!cur) insertCheck(db, unitId, check, clock, { contentRefId: programRefId });
        else if (cur.spec !== JSON.stringify(check)) {
          // THE re-seed policy (store/check-policy.ts), PIN variant: an UNREFERENCED registered
          // check (no attempt / run row points at it) is re-registered in place, so a DB synced
          // before a recorded-spec change (e.g. U03 gaining tsc_project) picks the new check up on
          // its next sync. A referenced check is never rebound: here it stays PINNED (its attempts
          // were graded by it) and the drift is reported; GET /units then surfaces what that older
          // check does not cover (sync/carve-outs.ts).
          const referenced = checkReferenced(db, cur.id);
          if (!referenced && cur.type === check.type) {
            const timeout = 'timeoutMs' in check ? check.timeoutMs : null;
            db.run('UPDATE "check" SET spec = ?, timeout_ms = ? WHERE id = ?', JSON.stringify(check), timeout, cur.id);
            out.checkDrift.push(`${m.code}: recorded check spec changed — re-registered the check (no attempts referenced the old one)`);
          } else {
            const why = referenced ? 'attempts reference it' : `type ${cur.type} -> ${check.type} is a re-seed decision`;
            out.checkDrift.push(`${m.code}: recorded check spec differs from the registered one — kept the registered check (${why})`);
          }
        }
      }
    }
    if (check) {
      db.run('UPDATE "check" SET content_ref_id = ? WHERE unit_id = ? AND content_ref_id IS NULL', programRefId, unitId);
    }
    // unit -> refs: the milestone pointer and its lesson guide (docs/curriculum/Uxx.md H1)
    db.run(`INSERT INTO unit_ref (unit_id, content_ref_id, role) VALUES (?, ?, 'program')
            ON CONFLICT (unit_id, role) DO UPDATE SET content_ref_id = excluded.content_ref_id`, unitId, programRefId);
    const guideKey = plan.guideKeys.get(m.code);
    const guideId = guideKey !== undefined ? refIds.get(guideKey) : undefined;
    if (guideId !== undefined) {
      db.run(`INSERT INTO unit_ref (unit_id, content_ref_id, role) VALUES (?, ?, 'guide')
              ON CONFLICT (unit_id, role) DO UPDATE SET content_ref_id = excluded.content_ref_id`, unitId, guideId);
    } else {
      db.run(`DELETE FROM unit_ref WHERE unit_id = ? AND role = 'guide'`, unitId);
    }
    // tickets (structure only; their prose stays in the repo, reachable via content_ref)
    for (const tk of m.tickets) {
      const tKey = plan.ticketKeys.get(tk.id);
      const tRef = tKey !== undefined ? (refIds.get(tKey) ?? null) : null;
      db.run(
        `INSERT INTO ticket (unit_id, ticket_code, title, mode, step, estimate_lo, estimate_hi, dependencies, content_ref_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (ticket_code) DO UPDATE SET unit_id = excluded.unit_id, title = excluded.title, mode = excluded.mode,
           step = excluded.step, estimate_lo = excluded.estimate_lo, estimate_hi = excluded.estimate_hi,
           dependencies = excluded.dependencies, content_ref_id = excluded.content_ref_id`,
        unitId,
        tk.id,
        tk.title,
        tk.mode,
        tk.step,
        tk.estimate[0],
        tk.estimate[1],
        JSON.stringify(tk.dependencies),
        tRef,
      );
    }
    out.units++;
    if (check) out.checked++;
    else out.study++;
  }
  return out;
}

async function resolveSha(
  deps: SyncDeps,
  e: SourceEntry,
  lastSyncedSha: string | null,
): Promise<{ sha: string; from: 'network' | 'pinned' | 'cache' }> {
  if (e.pinned_sha) return { sha: e.pinned_sha, from: 'pinned' };
  try {
    return { sha: (await deps.github.resolveHead(e.repo)).sha, from: 'network' };
  } catch (err) {
    if (!(err instanceof NetworkUnavailableError)) throw err;
    if (lastSyncedSha && (deps.cache.hasTree(e.repo, lastSyncedSha) || deps.cache.hasTarball(e.repo, lastSyncedSha))) {
      deps.log?.(`[sync] ${e.repo}: network unavailable (${err.message}); revalidating the cached ${lastSyncedSha.slice(0, 7)}`);
      return { sha: lastSyncedSha, from: 'cache' };
    }
    throw err;
  }
}

/** Plan the program registration from the extracted tree (async-free reads; verifies recorded check pins). */
async function planProgram(
  deps: SyncDeps,
  repo: string,
  sha: string,
  sourceId: number,
  dir: string,
  keyed: KeyedSection[],
): Promise<{ plan: ProgramPlan; refs: RefCandidate[] } | null> {
  const abs = join(dir, ...PROGRAM_JSON_PATH.split('/'));
  if (!existsSync(abs)) return null;
  const { program, text } = readProgram(abs);
  const table = deps.checkTable?.repos[repo];
  const checks = new Map<string, CheckSpec | null>();
  const checkDrift: string[] = [];
  for (const m of program.milestones) {
    const rec = table?.units[m.code];
    if (!rec || !table) {
      checks.set(m.code, null);
      continue;
    }
    // the recorded pin must hold at the recorded sha (that tree must be cached: one download if not)
    const pinnedFile = await deps.cache.treeFile(repo, table.sha, rec.path);
    const pinnedBytes = readFileSync(pinnedFile);
    if (sha256Hex(pinnedBytes) !== rec.sha256 || gitBlobSha(pinnedBytes) !== rec.blob_sha) {
      throw new ProgramError(`${m.code}: recorded check ${rec.path} does not hash to its pin at ${table.sha} — the table is wrong`);
    }
    // campaign 2 (OPS review): the recorded tsconfig-chain pins must hold at the recorded sha too.
    // F15: verified by the SAME walker the runner adapter uses before every U03 run, so sync also
    // proves the pins are exactly the project's extends chain (sha256 + git blob sha). The schema
    // guarantees tsc_files implies tsc_project.
    if (rec.tsc_files !== undefined && rec.tsc_project !== undefined) {
      try {
        await verifyTsconfigChain((r, s, rel) => deps.cache.treeFile(r, s, rel), repo, table.sha, rec.tsc_project, rec.tsc_files);
      } catch (err) {
        if (err instanceof TsconfigChainError) {
          throw new ProgramError(`${m.code}: recorded tsconfig chain does not hold at ${table.sha} — the table is wrong (${err.message})`);
        }
        throw err;
      }
    }
    // drift at the synced sha is reported, never auto-re-pinned
    if (sha !== table.sha) {
      const here = join(dir, ...rec.path.split('/'));
      if (!existsSync(here)) checkDrift.push(`${m.code}: ${rec.path} no longer exists at ${sha.slice(0, 7)} (check stays pinned at ${table.sha.slice(0, 7)})`);
      else if (sha256Hex(readFileSync(here)) !== rec.sha256) {
        checkDrift.push(`${m.code}: ${rec.path} changed at ${sha.slice(0, 7)} (check stays pinned at ${table.sha.slice(0, 7)}; re-record in a seed session)`);
      }
    }
    checks.set(m.code, CheckSpec.parse(recordedCheckSpec(repo, table.sha, rec)));
  }
  const guideKeys = new Map<string, string>();
  const ticketKeys = new Map<string, string>();
  for (const m of program.milestones) {
    const guidePath = `docs/curriculum/${m.code}.md`;
    const inGuide = keyed.filter((s) => s.path === guidePath);
    const h1 = inGuide.find((s) => s.level === 1);
    if (h1) guideKeys.set(m.code, h1.stableKey);
    for (const tk of m.tickets) {
      const sec = inGuide.find((s) => s.level === 2 && s.title.startsWith(`${tk.id} `));
      if (sec) ticketKeys.set(tk.id, sec.stableKey);
    }
  }
  const refs: RefCandidate[] = program.milestones.map((m) => ({
    stableKey: programRefKey(m.code),
    path: PROGRAM_JSON_PATH,
    anchor: `milestones[code=${m.code}]`,
    title: `${m.code}: ${m.title}`,
    lineStart: milestoneLine(text, m.code),
    lineEnd: null,
    kind: 'program-unit',
    provenance: 'json-pointer',
  }));
  return { plan: { repo, sha, sourceId, milestones: program.milestones, checks, checkDrift, guideKeys, ticketKeys }, refs };
}

async function syncRepo(deps: SyncDeps, e: SourceEntry, syncId: number): Promise<SyncRepoReport> {
  const { db } = deps;
  const report: SyncRepoReport = {
    repo: e.repo,
    role: e.role,
    sha: null,
    shaFrom: null,
    tarball: null,
    markdownFiles: 0,
    refs: { inserted: 0, updated: 0, unchanged: 0, missing: 0 },
    newKeys: 0,
    queued: 0,
    program: null,
    error: null,
  };
  try {
    const t0 = nowMs(deps.clock);
    const src = db.tx(() => upsertSource(db, e, t0));
    const { sha, from } = await resolveSha(deps, e, src.lastSyncedSha);
    report.sha = sha;
    report.shaFrom = from;
    const tree = await deps.cache.ensureTree(e.repo, sha);
    report.tarball = tree.tarball;
    const mdFiles = listFiles(tree.dir).filter((p) => /\.(md|markdown)$/i.test(p) && pathSelected(e, p));
    report.markdownFiles = mdFiles.length;
    const sections = mdFiles.flatMap((p) => parseMarkdownSections(p, readFileSync(join(tree.dir, ...p.split('/')), 'utf8')));
    const keyed = assignStableKeys(e.repo, sections);
    const program = e.role === 'curriculum' ? await planProgram(deps, e.repo, sha, src.id, tree.dir, keyed) : null;
    const cands = [...candidatesFromSections(keyed), ...(program?.refs ?? [])];

    const t = nowMs(deps.clock);
    db.tx(() => {
      const firstSync = src.lastSyncedSha === null && db.get('SELECT 1 AS x FROM seed_queue q JOIN content_ref r ON r.id = q.content_ref_id WHERE r.repo = ?', e.repo) === undefined;
      const refs = upsertRefs(db, e.repo, src.id, sha, cands, t);
      report.refs = { inserted: refs.inserted, updated: refs.updated, unchanged: refs.unchanged, missing: refs.missing };
      report.newKeys = refs.newIds.length;
      for (const id of refs.newIds) {
        const res = db.run(
          `INSERT INTO seed_queue (content_ref_id, reason, sync_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)
           ON CONFLICT (content_ref_id) DO NOTHING`,
          id,
          firstSync ? 'initial' : 'new',
          syncId,
          t,
        );
        report.queued += res.changes;
      }
      if (program) report.program = registerProgram(db, program.plan, refs.ids, t);
      db.run('UPDATE source SET last_synced_sha = ?, last_sync_id = ? WHERE id = ?', sha, syncId, src.id);
    });
    deps.log?.(
      `[sync] ${e.repo}@${sha.slice(0, 7)} (${from}, tarball ${tree.tarball}): ${mdFiles.length} md files, refs +${report.refs.inserted} ~${report.refs.updated} =${report.refs.unchanged} -${report.refs.missing}, new keys ${report.newKeys}` +
        (report.program ? `, program units ${report.program.units} (${report.program.checked} checked, ${report.program.study} study)` : ''),
    );
  } catch (err) {
    report.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    deps.log?.(`[sync] ${e.repo}: ERROR ${report.error}`);
  }
  return report;
}

/** Run one sync over the registry (or the named subset). Never throws for a per-repo failure: it lands in the report. */
export async function runSync(deps: SyncDeps, opts: SyncOptions = {}): Promise<SyncReport> {
  const { db } = deps;
  const wanted = opts.repos;
  if (wanted) {
    const known = new Set(deps.config.sources.map((s) => s.repo));
    const unknown = wanted.filter((r) => !known.has(r));
    if (unknown.length) throw new SyncConfigError(`not registered in curriculum.yaml: ${unknown.join(', ')}`);
  }
  const entries = deps.config.sources.filter((s) => !wanted || wanted.includes(s.repo));
  const syncId = db.run('INSERT INTO sync_run (started_at, offline) VALUES (?, ?)', nowMs(deps.clock), deps.github.offline).lastInsertRowid;
  const repos: SyncRepoReport[] = [];
  for (const e of entries) repos.push(await syncRepo(deps, e, syncId)); // sequential: one tarball at a time
  const report = SyncReport.parse({ syncId, offline: deps.github.offline, repos, ok: repos.every((r) => r.error === null) });
  db.run('UPDATE sync_run SET finished_at = ?, ok = ?, report = ? WHERE id = ?', nowMs(deps.clock), report.ok, JSON.stringify(report), syncId);
  return report;
}

/** Pending (or all) seed-queue rows, oldest first. */
export function seedQueue(db: Db, opts: { status?: 'pending' | 'seeded' | 'all'; limit?: number } = {}) {
  const status = opts.status ?? 'pending';
  const rows = db.all<{
    id: number;
    contentRefId: number;
    repo: string;
    stableKey: string;
    path: string;
    anchor: string | null;
    title: string;
    sha: string;
    reason: 'initial' | 'new';
    syncId: number;
    status: 'pending' | 'seeded';
  }>(
    `SELECT q.id, q.content_ref_id AS contentRefId, r.repo, r.stable_key AS stableKey, r.path, r.anchor, r.title, r.sha,
            q.reason, q.sync_id AS syncId, q.status
       FROM seed_queue q JOIN content_ref r ON r.id = q.content_ref_id
      WHERE (? = 'all' OR q.status = ?)
      ORDER BY q.id LIMIT ?`,
    status,
    status,
    opts.limit ?? 1_000_000,
  );
  const count = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM seed_queue WHERE (? = 'all' OR status = ?)`, status, status)?.n ?? 0;
  return { count, items: rows };
}
