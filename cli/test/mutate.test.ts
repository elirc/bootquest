import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROJECT_UNIT_KINDS } from '@bootquest/shared';
import { MUTATE_TIMEOUT_MS } from '@bootquest/shared/mutation';
import { JS_REPORT, mutateProject, NET_OUTPUT, PROJECT_KINDS, type ToolRun, type ToolRunner } from '../src/mutate.ts';
import { runCli } from '../src/program.ts';
import { captureIo, drillDetail, fakeFetch, httpDetail } from './helpers.ts';

const mutant = (status: string, line: number) => ({ id: `${line}-${status}`, mutatorName: 'EqualityOperator', replacement: 'a !== b', status, location: { start: { line, column: 1 }, end: { line, column: 5 } } });
/** a mutation-testing-elements report: honest cart (9/10) + a file whose assertions were gutted (0/6) */
function report(gutted: boolean) {
  return {
    schemaVersion: '1',
    thresholds: { high: 80, low: 60 },
    files: {
      'src/cart.js': { language: 'javascript', source: '', mutants: [...Array.from({ length: 9 }, (_, i) => mutant('Killed', i + 1)), mutant('Survived', 20)] },
      'src/slug.js': {
        language: 'javascript',
        source: '',
        mutants: gutted ? Array.from({ length: 6 }, (_, i) => mutant(i < 2 ? 'NoCoverage' : 'Survived', i + 1)) : [...Array.from({ length: 5 }, (_, i) => mutant('Killed', i + 1)), mutant('Survived', 9)],
      },
    },
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bq-mutate-'));
  writeFileSync(join(dir, '.bootquest.json'), JSON.stringify({ unitId: 21 }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** fake Stryker: records the invocation, writes the JSON report where Stryker JS does */
function fakeStryker(opts: { gutted?: boolean; timedOut?: boolean; writeReport?: boolean } = {}): { run: ToolRunner; runs: ToolRun[] } {
  const runs: ToolRun[] = [];
  const run: ToolRunner = async (r, onOutput) => {
    runs.push(r);
    onOutput('fake stryker output\n');
    if (opts.writeReport !== false && !opts.timedOut) {
      mkdirSync(join(r.cwd, 'reports', 'mutation'), { recursive: true });
      writeFileSync(join(r.cwd, JS_REPORT), JSON.stringify(report(opts.gutted ?? false)));
    }
    return { exitCode: opts.timedOut ? null : 0, timedOut: opts.timedOut ?? false, durationMs: 1234 };
  };
  return { run, runs };
}

const MUTATION_OK = { status: 200, body: { unitId: 21, attemptId: 77, verdict: { pass: true, overallPct: 87.5, floorPct: 40, breakPct: 60, files: [], failures: [] }, evidenceIds: [301] } };

describe('bootquest mutate', () => {
  it('PROJECT_KINDS mirrors shared PROJECT_UNIT_KINDS (drills are never mutated)', () => {
    expect([...PROJECT_KINDS].sort()).toEqual([...PROJECT_UNIT_KINDS].sort());
  });

  it('JS project: runs Stryker with the vitest runner + --incremental in the project dir, 15-min cap; posts counts only on pass (exit 0)', async () => {
    const { fetch, calls } = fakeFetch({ 'GET /api/units/21': { status: 200, body: httpDetail() }, 'POST /api/units/21/mutation': MUTATION_OK });
    const tool = fakeStryker();
    const io = { ...captureIo(dir, fetch), runTool: tool.run };
    expect(await runCli(['mutate', '--quiet'], io)).toBe(0);
    const r = tool.runs[0]!;
    expect(r.command).toBe(process.execPath);
    expect(r.args[0]).toMatch(/@stryker-mutator[\\/]core[\\/]bin[\\/]stryker\.js$/);
    expect(r.args).toEqual(expect.arrayContaining(['run', '--incremental', '--testRunner', 'vitest', '--reporters', 'json,clear-text']));
    expect(r.args[r.args.indexOf('--plugins') + 1]).toMatch(/vitest-runner[\\/]dist[\\/]src[\\/]index\.js$/);
    expect(r.cwd).toBe(dir);
    expect(r.timeoutMs).toBe(MUTATE_TIMEOUT_MS);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({
      tool: 'stryker-js',
      toolVersion: '10.0.0',
      durationMs: 1234,
      files: [
        { path: 'src/cart.js', killed: 9, timeout: 0, survived: 1, noCoverage: 0 },
        { path: 'src/slug.js', killed: 5, timeout: 0, survived: 1, noCoverage: 0 },
      ],
    });
    expect(io.stdout.join('\n')).toMatch(/Recorded: mutation evidence #301 on attempt #77/);
    expect(io.stdout.join('\n')).toMatch(/src\/cart\.js:20 {2}EqualityOperator -> a !== b/);
  });

  it('a gutted file fails the per-file floor even though nothing else is wrong: exit 1, survivors listed, NOTHING posted', async () => {
    const { fetch, calls } = fakeFetch({ 'GET /api/units/21': { status: 200, body: httpDetail() }, 'POST /api/units/21/mutation': MUTATION_OK });
    const io = { ...captureIo(dir, fetch), runTool: fakeStryker({ gutted: true }).run };
    expect(await runCli(['mutate', '--quiet'], io)).toBe(1);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    const out = io.stdout.join('\n');
    expect(out).toMatch(/FAIL\s+0\.00%\s+src\/slug\.js/);
    expect(out).toMatch(/src\/slug\.js: 0% < per-file floor 40%/);
    expect(out).toMatch(/\(no test covers it\)/);
  });

  it('the lesson threshold overrides the floor (threshold 0.95 fails a 90% file)', async () => {
    const strict = { ...httpDetail(), check: { ...httpDetail().check!, threshold: 0.95 } };
    const { fetch, calls } = fakeFetch({ 'GET /api/units/21': { status: 200, body: strict }, 'POST /api/units/21/mutation': MUTATION_OK });
    const io = { ...captureIo(dir, fetch), runTool: fakeStryker().run };
    expect(await runCli(['mutate', '--quiet'], io)).toBe(1);
    expect(io.stdout.join('\n')).toMatch(/src\/cart\.js: 90% < per-file floor 95%/);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('refuses drills (exit 2, Stryker never started), the hard timeout (exit 2), and a run that wrote no fresh report (exit 2)', async () => {
    const drill = fakeFetch({ 'GET /api/units/21': { status: 200, body: drillDetail({ id: 21 }) } });
    const t1 = fakeStryker();
    const io1 = { ...captureIo(dir, drill.fetch), runTool: t1.run };
    expect(await runCli(['mutate'], io1)).toBe(2);
    expect(t1.runs).toHaveLength(0);
    expect(io1.stderr.join('\n')).toMatch(/solo-project units only.*never to drills/);

    const proj = fakeFetch({ 'GET /api/units/21': { status: 200, body: httpDetail() } });
    const io2 = { ...captureIo(dir, proj.fetch), runTool: fakeStryker({ timedOut: true }).run };
    expect(await runCli(['mutate', '--quiet'], io2)).toBe(2);
    expect(io2.stderr.join('\n')).toMatch(/15-minute hard limit and was killed/);

    // a stale report from an earlier run must never be read
    mkdirSync(join(dir, 'reports', 'mutation'), { recursive: true });
    writeFileSync(join(dir, JS_REPORT), JSON.stringify(report(false)));
    const io3 = { ...captureIo(dir, proj.fetch), runTool: fakeStryker({ writeReport: false }).run };
    expect(await runCli(['mutate', '--quiet'], io3)).toBe(2);
    expect(io3.stderr.join('\n')).toMatch(/without a JSON report/);
    expect(proj.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('C# project: Stryker.NET from the test project dir, no shared compiler server, leftovers reaped even when the run throws', async () => {
    const cs = { ...httpDetail(), unit: { ...httpDetail().unit, trackId: 'csharp' as const } };
    const runs: ToolRun[] = [];
    const reaped: number[] = [];
    const run: ToolRunner = async (r) => {
      runs.push(r);
      mkdirSync(join(r.cwd, NET_OUTPUT, 'reports'), { recursive: true });
      writeFileSync(join(r.cwd, NET_OUTPUT, 'reports', 'mutation-report.json'), JSON.stringify(report(false)));
      return { exitCode: 0, timedOut: false, durationMs: 5000 };
    };
    const o = await mutateProject(cs, dir, {
      run,
      onOutput: () => {},
      env: { VITEST: '1', PATH: 'x' },
      dotnetStrykerExe: 'C:/fake/dotnet-stryker.exe',
      reap: async (t) => {
        reaped.push(t);
        return ['123 VBCSCompiler.exe'];
      },
      now: () => 42,
    });
    expect(o.tool).toBe('stryker-net');
    expect(o.toolVersion).toBe('5.0.0');
    expect(o.verdict.pass).toBe(true);
    expect(runs[0]!.command).toBe('C:/fake/dotnet-stryker.exe');
    expect(runs[0]!.args).toEqual(expect.arrayContaining(['--reporter', 'json', '--output', NET_OUTPUT]));
    expect(runs[0]!.env.UseSharedCompilation).toBe('false');
    expect(runs[0]!.env.VITEST).toBeUndefined();
    expect(reaped).toEqual([42]);
    expect(o.reaped).toEqual(['123 VBCSCompiler.exe']);

    const boom: ToolRunner = async () => {
      throw new Error('spawn failed');
    };
    await expect(mutateProject(cs, dir, { run: boom, onOutput: () => {}, env: {}, dotnetStrykerExe: 'x', reap: async (t) => (reaped.push(t), []), now: () => 7 })).rejects.toThrow(
      'spawn failed',
    );
    expect(reaped).toEqual([42, 7]);
    expect(existsSync(join(dir, NET_OUTPUT))).toBe(false); // the previous run's output was cleared first
    expect(readFileSync(join(dir, '.bootquest.json'), 'utf8')).toContain('21');
  });
});
