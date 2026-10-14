/**
 * restamp:all — the ONE re-sweep every fingerprinted-code change needs (OPS item 1).
 * After grader/validator/factory bytes change, every stamp in the estate goes stale:
 *   1. code packs (content/packs/<source>/): sequential full-scope `seed:validate`
 *      per source — validate.ts removes the stamp at run start and only a clean
 *      full run rewrites it; the per-source journal makes an interrupted sweep
 *      resumable, so running this again continues instead of restarting;
 *   2. ONE shutdownValidatorRunners() after every source (the warm C# compiler
 *      server is per-process; shutting it down between sources wastes warmup);
 *   3. seed packs (content/seed/<generator>/<name>/): `seed:check --restamp`
 *      re-validates every shipped item and restamps stale-fingerprint-only packs;
 *   4. a STAMP STATUS table over the whole estate: code packs through the server's
 *      own pack loader (readPack = the verifyStamp the serve path runs), seed packs
 *      through loadSeedPack({requireStamp}), the campaign map via its seeder
 *      fingerprint. The table never lies: it probes the bytes on disk AFTER the run.
 * --dry-run prints the plan + the current table and EXECUTES NOTHING (the full run
 * re-executes every reference solution: ~60 min on this machine).
 *
 * This module is deliberately outside every fingerprint set (new tools/seed/src/ops/
 * dir) and holds only orchestration: the sweep/check/probe implementations are
 * injected (tools/seed/src/ops/cli.ts wires the real ones; the unit test fakes them).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface RestampAllDeps {
  /** full-scope import-gate sweep of one code pack (rewrites its validation.json on success) */
  validate(opts: { packDir: string; journalPath: string }): Promise<{ ok: boolean; stampPath: string | null }>;
  /** stops the warm C# runner the validator may have started — called exactly once, after every sweep */
  shutdown(): Promise<void>;
  /** seed:check --restamp over every seed pack */
  check(): Promise<{ ok: boolean }>;
  /** verifyStamp mirror: the server pack loader with the import-gate stamp required; throws with the problem */
  probeCodePack(packDir: string): void;
  /** loadSeedPack({ requireStamp: true }); throws with the problem */
  probeSeedPack(packDir: string): void;
  /** the CURRENT campaign seeder fingerprint (campaignSeederFingerprint()) */
  campaignFingerprint(): string;
}

export interface RestampAllPaths {
  /** content/packs — each subdir with a manifest.json is a code-pack source */
  packsDir: string;
  /** content/seed — <generator>/<name> dirs with a manifest.json */
  seedDir: string;
  /** content/campaign — manifest.json carries the seeder fingerprint */
  campaignDir: string;
  /** .seed-journal — per-source journals (<source>.jsonl) */
  journalDir: string;
}

export interface StampStatusRow {
  kind: 'code' | 'seed' | 'campaign';
  name: string;
  ok: boolean;
  detail: string;
}

export interface RestampAllReport {
  ok: boolean;
  dryRun: boolean;
  /** per-source sweep verdicts (empty on a dry run) */
  sweeps: { source: string; ok: boolean }[];
  /** seed:check --restamp verdict (null on a dry run) */
  checkOk: boolean | null;
  rows: StampStatusRow[];
}

/** Code-pack sources: direct children of content/packs that carry a manifest.json. */
export function listCodePackDirs(packsDir: string): string[] {
  if (!existsSync(packsDir)) return [];
  return readdirSync(packsDir)
    .sort()
    .map((n) => join(packsDir, n))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'manifest.json')));
}

/** Seed packs: content/seed/<generator>/<name> dirs with a manifest.json (mirrors check.ts findPacks). */
export function listSeedPackDirs(seedDir: string): string[] {
  if (!existsSync(seedDir)) return [];
  const out: string[] = [];
  for (const g of readdirSync(seedDir).sort()) {
    const gd = join(seedDir, g);
    if (!statSync(gd).isDirectory()) continue;
    for (const n of readdirSync(gd).sort()) {
      const pd = join(gd, n);
      if (statSync(pd).isDirectory() && existsSync(join(pd, 'manifest.json'))) out.push(pd);
    }
  }
  return out;
}

const trim = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 200);

function probe(kind: StampStatusRow['kind'], name: string, fn: () => string): StampStatusRow {
  try {
    return { kind, name, ok: true, detail: fn() };
  } catch (err) {
    return { kind, name, ok: false, detail: trim(err instanceof Error ? err.message : String(err)) };
  }
}

/** The whole estate's stamp status, probed read-only from the bytes on disk. */
export function stampStatusTable(paths: RestampAllPaths, deps: RestampAllDeps): StampStatusRow[] {
  const rows: StampStatusRow[] = [];
  for (const dir of listCodePackDirs(paths.packsDir)) {
    rows.push(probe('code', basename(dir), () => {
      deps.probeCodePack(dir);
      return 'stamp verified (manifest sha256 + grader fingerprint + counts + quarantine keys)';
    }));
  }
  for (const dir of listSeedPackDirs(paths.seedDir)) {
    rows.push(probe('seed', `${basename(join(dir, '..'))}/${basename(dir)}`, () => {
      deps.probeSeedPack(dir);
      return 'stamp verified (bytes + seed fingerprint + quarantine/review keys)';
    }));
  }
  rows.push(probe('campaign', basename(paths.campaignDir), () => {
    const mPath = join(paths.campaignDir, 'manifest.json');
    if (!existsSync(mPath)) throw new Error('no manifest.json (run seed:campaign)');
    const m = JSON.parse(readFileSync(mPath, 'utf8')) as { seeder?: { fingerprint?: string } };
    const stamped = m.seeder?.fingerprint;
    if (typeof stamped !== 'string') throw new Error('manifest has no seeder.fingerprint (re-run seed:campaign)');
    const fp = deps.campaignFingerprint();
    if (stamped !== fp) throw new Error(`stamped by seeder ${stamped.slice(0, 12)}, current is ${fp.slice(0, 12)} (re-run seed:campaign)`);
    return `seeder fingerprint ${fp.slice(0, 12)} matches`;
  }));
  return rows;
}

export function formatStatusTable(rows: readonly StampStatusRow[]): string[] {
  const nameW = Math.max(4, ...rows.map((r) => r.name.length));
  return [
    'STAMP STATUS',
    ...rows.map((r) => `  ${r.ok ? 'OK   ' : 'STALE'} ${r.kind.padEnd(8)} ${r.name.padEnd(nameW)}  ${r.detail}`),
    `  ${rows.filter((r) => r.ok).length}/${rows.length} fresh`,
  ];
}

export interface RestampAllOptions {
  paths: RestampAllPaths;
  deps: RestampAllDeps;
  dryRun: boolean;
  log?: (line: string) => void;
}

export async function runRestampAll(o: RestampAllOptions): Promise<RestampAllReport> {
  const log = o.log ?? (() => {});
  const sources = listCodePackDirs(o.paths.packsDir);
  const seedPacks = listSeedPackDirs(o.paths.seedDir);
  const journalFor = (dir: string): string => join(o.paths.journalDir, `${basename(dir)}.jsonl`);

  log(`[restamp:all] ${sources.length} code pack(s), ${seedPacks.length} seed pack(s), 1 campaign map${o.dryRun ? ' — DRY RUN (nothing executes)' : ''}`);
  log(`PLAN (sequential${o.dryRun ? ', NOT executed' : ''}):`);
  sources.forEach((dir, i) => log(`  ${i + 1}. seed:validate  pack ${dir}  journal ${journalFor(dir)}`));
  log(`  ${sources.length + 1}. shutdown validator runners (once, after every sweep)`);
  log(`  ${sources.length + 2}. seed:check --restamp over ${o.paths.seedDir}`);

  const sweeps: RestampAllReport['sweeps'] = [];
  let checkOk: boolean | null = null;
  if (!o.dryRun) {
    try {
      for (const dir of sources) {
        const source = basename(dir);
        log(`[restamp:all] sweeping ${source} ...`);
        const r = await o.deps.validate({ packDir: dir, journalPath: journalFor(dir) });
        sweeps.push({ source, ok: r.ok });
        log(`[restamp:all] ${source}: ${r.ok ? `OK (stamp ${r.stampPath ?? '?'})` : 'FAIL (no stamp written — the journal keeps the progress; fix and re-run)'}`);
      }
    } finally {
      await o.deps.shutdown();
      log('[restamp:all] validator runners shut down');
    }
    log('[restamp:all] seed:check --restamp ...');
    checkOk = (await o.deps.check()).ok;
    log(`[restamp:all] seed:check --restamp: ${checkOk ? 'OK' : 'FAIL'}`);
  }

  const rows = stampStatusTable(o.paths, o.deps);
  for (const line of formatStatusTable(rows)) log(line);
  const ok = rows.every((r) => r.ok) && sweeps.every((s) => s.ok) && (o.dryRun || checkOk === true);
  return { ok, dryRun: o.dryRun, sweeps, checkOk, rows };
}
