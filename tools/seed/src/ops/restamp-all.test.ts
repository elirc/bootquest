import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatStatusTable, listCodePackDirs, listSeedPackDirs, runRestampAll, type RestampAllDeps, type RestampAllPaths } from './restamp-all.ts';

/** A fake estate on disk (discovery is real fs) + fully faked execution/probes. */
let root: string;
let paths: RestampAllPaths;

function estate(): void {
  for (const d of ['packs/alpha', 'packs/beta', 'seed/quests/p1', 'seed/patches/p2', 'campaign']) mkdirSync(join(root, d), { recursive: true });
  for (const m of ['packs/alpha', 'packs/beta', 'seed/quests/p1', 'seed/patches/p2']) writeFileSync(join(root, m, 'manifest.json'), '{}');
  // a packs dir without a manifest is NOT a source; a stray file is ignored
  mkdirSync(join(root, 'packs', 'not-a-pack'));
  writeFileSync(join(root, 'packs', 'README.md'), 'x');
  writeFileSync(join(root, 'campaign', 'manifest.json'), JSON.stringify({ seeder: { name: 'seed:campaign', fingerprint: 'fp-current' } }));
}

interface Fakes {
  deps: RestampAllDeps;
  calls: string[];
}

function fakes(over: Partial<RestampAllDeps> = {}): Fakes {
  const calls: string[] = [];
  const deps: RestampAllDeps = {
    async validate({ packDir, journalPath }) {
      calls.push(`validate:${basename(packDir)}`);
      expect(journalPath).toBe(join(paths.journalDir, `${basename(packDir)}.jsonl`));
      return { ok: true, stampPath: join(packDir, 'validation.json') };
    },
    async shutdown() {
      calls.push('shutdown');
    },
    async check() {
      calls.push('check');
      return { ok: true };
    },
    probeCodePack: (dir) => calls.push(`probe-code:${basename(dir)}`),
    probeSeedPack: (dir) => calls.push(`probe-seed:${basename(dir)}`),
    campaignFingerprint: () => 'fp-current',
    ...over,
  };
  return { deps, calls };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bq-restamp-all-'));
  estate();
  paths = {
    packsDir: join(root, 'packs'),
    seedDir: join(root, 'seed'),
    campaignDir: join(root, 'campaign'),
    journalDir: join(root, '.seed-journal'),
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('discovery', () => {
  it('code packs = packs/* dirs with a manifest.json, sorted; seed packs = <generator>/<name>, sorted', () => {
    expect(listCodePackDirs(paths.packsDir).map((d) => basename(d))).toEqual(['alpha', 'beta']);
    expect(listSeedPackDirs(paths.seedDir).map((d) => basename(d))).toEqual(['p2', 'p1']); // patches < quests
    expect(listCodePackDirs(join(root, 'nope'))).toEqual([]);
    expect(listSeedPackDirs(join(root, 'nope'))).toEqual([]);
  });
});

describe('full run', () => {
  it('sweeps every source sequentially, shuts the runners down EXACTLY ONCE after all sweeps, then checks, then probes', async () => {
    const { deps, calls } = fakes();
    const r = await runRestampAll({ paths, deps, dryRun: false });
    expect(calls.slice(0, 4)).toEqual(['validate:alpha', 'validate:beta', 'shutdown', 'check']);
    expect(calls.filter((c) => c === 'shutdown')).toHaveLength(1);
    // probes run AFTER the executions (the table reflects the post-run bytes)
    expect(calls.slice(4)).toEqual(['probe-code:alpha', 'probe-code:beta', 'probe-seed:p2', 'probe-seed:p1']);
    expect(r).toMatchObject({ ok: true, dryRun: false, checkOk: true });
    expect(r.sweeps).toEqual([{ source: 'alpha', ok: true }, { source: 'beta', ok: true }]);
    expect(r.rows.map((x) => [x.kind, x.name, x.ok])).toEqual([
      ['code', 'alpha', true],
      ['code', 'beta', true],
      ['seed', 'patches/p2', true],
      ['seed', 'quests/p1', true],
      ['campaign', 'campaign', true],
    ]);
  });

  it('a FAILED sweep does not stop the others, still shuts down once, still checks, and fails the run', async () => {
    const { deps, calls } = fakes({
      async validate({ packDir }) {
        calls.push(`validate:${basename(packDir)}`);
        return { ok: basename(packDir) !== 'alpha', stampPath: null };
      },
    });
    const r = await runRestampAll({ paths, deps, dryRun: false });
    expect(calls.slice(0, 4)).toEqual(['validate:alpha', 'validate:beta', 'shutdown', 'check']);
    expect(r.ok).toBe(false);
    expect(r.sweeps).toEqual([{ source: 'alpha', ok: false }, { source: 'beta', ok: true }]);
  });

  it('a CRASHED sweep still shuts the runners down (finally), and the crash propagates', async () => {
    const { deps, calls } = fakes({
      async validate() {
        calls.push('validate:boom');
        throw new Error('dotnet exploded');
      },
    });
    await expect(runRestampAll({ paths, deps, dryRun: false })).rejects.toThrow('dotnet exploded');
    expect(calls).toEqual(['validate:boom', 'shutdown']); // no check, no probes — but never a leaked runner
  });

  it('a failed seed:check fails the run even when every stamp probes fresh', async () => {
    const { deps } = fakes({ check: async () => ({ ok: false }) });
    const r = await runRestampAll({ paths, deps, dryRun: false });
    expect(r.checkOk).toBe(false);
    expect(r.ok).toBe(false);
  });
});

describe('--dry-run', () => {
  it('executes NOTHING (no validate, no shutdown, no check) and still prints the plan + probes the table', async () => {
    const { deps, calls } = fakes();
    const lines: string[] = [];
    const r = await runRestampAll({ paths, deps, dryRun: true, log: (l) => lines.push(l) });
    expect(calls.some((c) => c.startsWith('validate') || c === 'shutdown' || c === 'check')).toBe(false);
    expect(calls).toEqual(['probe-code:alpha', 'probe-code:beta', 'probe-seed:p2', 'probe-seed:p1']);
    expect(r).toMatchObject({ ok: true, dryRun: true, checkOk: null, sweeps: [] });
    expect(lines.some((l) => l.includes('DRY RUN'))).toBe(true);
    expect(lines.filter((l) => l.includes('seed:validate'))).toHaveLength(2);
    expect(lines.some((l) => l.includes('seed:check --restamp'))).toBe(true);
    expect(lines.some((l) => l === 'STAMP STATUS')).toBe(true);
    expect(lines.some((l) => l.includes('5/5 fresh'))).toBe(true);
  });

  it('a stale stamp shows in the table and fails the dry run (cheap estate-freshness gate)', async () => {
    const { deps } = fakes({
      probeSeedPack: (dir) => {
        if (basename(dir) === 'p1') throw new Error(`${dir}: stale/invalid stamp: seed fingerprint abc != current def`);
      },
    });
    const r = await runRestampAll({ paths, deps, dryRun: true });
    expect(r.ok).toBe(false);
    const bad = r.rows.find((x) => x.name === 'quests/p1')!;
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain('stale/invalid stamp');
    expect(formatStatusTable(r.rows).some((l) => l.includes('STALE') && l.includes('quests/p1'))).toBe(true);
  });

  it('a campaign map stamped by another seeder is STALE; a matching one is OK with the fingerprint prefix', async () => {
    const good = await runRestampAll({ paths, deps: fakes().deps, dryRun: true });
    expect(good.rows.at(-1)).toMatchObject({ kind: 'campaign', ok: true });
    expect(good.rows.at(-1)!.detail).toContain('fp-current'.slice(0, 12));
    const { deps } = fakes({ campaignFingerprint: () => 'fp-after-edit' });
    const r = await runRestampAll({ paths, deps, dryRun: true });
    const row = r.rows.at(-1)!;
    expect(row).toMatchObject({ kind: 'campaign', ok: false });
    expect(row.detail).toContain('fp-current'.slice(0, 12));
    expect(row.detail).toContain('fp-after-edit'.slice(0, 12));
    expect(r.ok).toBe(false);
  });

  it('a missing campaign manifest is reported, never thrown', async () => {
    rmSync(join(root, 'campaign', 'manifest.json'));
    const r = await runRestampAll({ paths, deps: fakes().deps, dryRun: true });
    expect(r.rows.at(-1)).toMatchObject({ kind: 'campaign', ok: false });
    expect(r.rows.at(-1)!.detail).toContain('no manifest.json');
  });
});
