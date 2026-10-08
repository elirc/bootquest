// Warm scratch-project manager for the C# runner (spec §5, BUILD-PLAN W3a).
//
// One scratch project per exercise SHAPE lives under `<appDataDir>/csharp/<shape>/`.
// It is prepared once (restore + first build), then every attempt only rewrites
// the learner/test sources and recompiles into the SAME bin/ — bin/obj are reused.
//
// Measured on the dev box (see docs/recon/p2-timings.md): MSBuild is the cost.
// `dotnet build`/`dotnet test` on a two-file project is 8-20 s warm here, which
// blows the <10 s gate. So the warm path talks to Roslyn directly:
//   - compile: `dotnet <sdk>/Roslyn/bincore/csc.dll -shared:<pipe>` (warm compiler
//     server, ~1 s), output into the scratch bin/;
//   - console-check: `dotnet bin/Exercise.dll`;
//   - xunit: `dotnet vstest bin/Scratch.Tests.dll` (TRX logger) against the bin/
//     the one-time `dotnet build` populated (deps.json, xunit adapter, testhost).
// The literal spec path (`dotnet test --no-restore`) is kept as engine "msbuild"
// for the xunit shape so the two can be compared.
//
// Process hygiene: every child is spawned without a shell; on timeout the WHOLE
// tree is killed with `taskkill /T /F` (plain kill() on Windows leaves testhost /
// the app grandchild alive, holding bin/*.dll open so the next compile fails).
// A named compiler-server pipe per app-data dir means `shutdown()` stops exactly
// the VBCSCompiler we started, not one another tool is using.

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Shape = 'console-check' | 'xunit';
export type XunitEngine = 'fast' | 'msbuild';

// ── pinned versions (all present in the local NuGet cache → offline restore) ──
export const XUNIT_PACKAGES = {
  'Microsoft.NET.Test.Sdk': '17.14.1',
  xunit: '2.9.3',
  'xunit.runner.visualstudio': '3.1.5',
} as const;

// Implicit usings of Microsoft.NET.Sdk (what file-based apps get by default).
const IMPLICIT_USINGS = [
  'System',
  'System.Collections.Generic',
  'System.IO',
  'System.Linq',
  'System.Net.Http',
  'System.Threading',
  'System.Threading.Tasks',
];

const OUTPUT_CAP = 256 * 1024; // chars kept per stream; runaway printers get truncated

// ── child processes ───────────────────────────────────────────────────────────

export interface ProcResult {
  code: number | null;
  output: string; // stdout + stderr, in arrival order
  timedOut: boolean;
  ms: number;
}

const live = new Set<number>();

export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    } catch {
      /* already gone */
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    }
  }
}

/** PIDs of children still running (for hygiene assertions). */
export function livePids(): number[] {
  return [...live];
}

export function runProc(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: Record<string, string> },
): Promise<ProcResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...BASE_ENV, ...opts.env },
      windowsHide: true,
      shell: false,
      detached: process.platform !== 'win32', // own process group on POSIX for -pid kill
    });
    if (child.pid) live.add(child.pid);
    let output = '';
    let truncated = false;
    const onData = (buf: Buffer) => {
      if (output.length >= OUTPUT_CAP) {
        truncated = true;
        return;
      }
      output += buf.toString('utf8');
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killTree(child.pid);
    }, opts.timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      if (child.pid) live.delete(child.pid);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (child.pid) live.delete(child.pid);
      if (truncated) output += `\n[output truncated at ${OUTPUT_CAP} chars]`;
      resolve({ code, output, timedOut, ms: Date.now() - started });
    });
  });
}

const BASE_ENV: Record<string, string> = {
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_NOLOGO: '1',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
  DOTNET_CLI_UI_LANGUAGE: 'en',
  NO_COLOR: '1',
  MSBUILDDISABLENODEREUSE: '1',
};

// ── toolchain discovery ───────────────────────────────────────────────────────

export interface Toolchain {
  sdkVersion: string;
  cscDll: string;
  vbcscompilerDll: string;
  refDir: string; // Microsoft.NETCore.App.Ref/<ver>/ref/net10.0
}

let cachedToolchain: Toolchain | undefined;

function versionCmp(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function discoverToolchain(major = 10): Toolchain {
  if (cachedToolchain) return cachedToolchain;
  const out = execFileSync('dotnet', ['--list-sdks'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...BASE_ENV } });
  const sdks = out
    .split(/\r?\n/)
    .map((l) => /^(\S+) \[(.+)\]$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m && m[1]!.startsWith(`${major}.`))
    .sort((a, b) => versionCmp(b[1]!, a[1]!));
  if (!sdks.length) throw new Error(`no .NET ${major} SDK found in:\n${out}`);
  const [, sdkVersion, sdkRoot] = sdks[0]!;
  if (!sdkVersion || !sdkRoot) throw new Error(`unparseable SDK line in:\n${out}`);
  const bincore = join(sdkRoot, sdkVersion, 'Roslyn', 'bincore');
  const refBase = join(sdkRoot, '..', 'packs', 'Microsoft.NETCore.App.Ref');
  const refVer = readdirSync(refBase)
    .filter((v) => v.startsWith(`${major}.`))
    .sort((a, b) => versionCmp(b, a))[0];
  if (!refVer) throw new Error(`no Microsoft.NETCore.App.Ref ${major}.x under ${refBase}`);
  const tc: Toolchain = {
    sdkVersion,
    cscDll: join(bincore, 'csc.dll'),
    vbcscompilerDll: join(bincore, 'VBCSCompiler.dll'),
    refDir: join(refBase, refVer, 'ref', `net${major}.0`),
  };
  cachedToolchain = tc;
  return tc;
}

// ── per-shape mutex ───────────────────────────────────────────────────────────

class KeyedMutex {
  private tails = new Map<string, Promise<void>>();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => mine);
    this.tails.set(key, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

// ── the manager ───────────────────────────────────────────────────────────────

export interface PrepareInfo {
  dir: string;
  prepared: boolean; // true = this call did the one-time setup
  ms: number;
  log: string;
}

export interface CompileOutcome {
  ok: boolean;
  output: string; // verbatim compiler output
  ms: number;
}

export interface AttemptRaw {
  compile: CompileOutcome;
  run?: ProcResult;
  trx?: string; // xunit: TRX XML text when produced
  totalMs: number;
}

export interface ScratchOptions {
  appDataDir: string;
  /** Source of the csbootcamp `Check` harness compiled once for console-check. */
  checkHarnessPath?: string;
  xunitEngine?: XunitEngine;
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CHECK_DEFAULT = join(HERE, 'fixtures', 'csbootcamp', '_lib', 'Check', 'Check.cs');

const XUNIT_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <LangVersion>latest</LangVersion>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
    <AssemblyName>Scratch.Tests</AssemblyName>
    <RootNamespace>Scratch</RootNamespace>
    <GenerateDocumentationFile>false</GenerateDocumentationFile>
  </PropertyGroup>
  <ItemGroup>
${Object.entries(XUNIT_PACKAGES)
  .map(([id, v]) => `    <PackageReference Include="${id}" Version="${v}" />`)
  .join('\n')}
  </ItemGroup>
  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>
</Project>
`;

export class ScratchManager {
  readonly root: string;
  readonly pipe: string;
  private mutex = new KeyedMutex();
  private opts: ScratchOptions;

  constructor(opts: ScratchOptions) {
    this.opts = opts;
    this.root = join(opts.appDataDir, 'csharp');
    this.pipe = 'bq-' + createHash('sha1').update(this.root.toLowerCase()).digest('hex').slice(0, 16);
  }

  dir(shape: Shape): string {
    return join(this.root, shape);
  }

  /** Serialize `fn` with every other grade of the same shape. */
  withShape<T>(shape: Shape, fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(shape, fn);
  }

  // ── one-time preparation ────────────────────────────────────────────────────

  async prepare(shape: Shape): Promise<PrepareInfo> {
    const dir = this.dir(shape);
    const marker = join(dir, '.ready');
    const started = Date.now();
    if (existsSync(marker)) return { dir, prepared: false, ms: 0, log: '' };
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'bin'), { recursive: true });
    const log = shape === 'console-check' ? await this.prepareConsole(dir) : await this.prepareXunit(dir);
    writeFileSync(marker, JSON.stringify({ shape, sdk: discoverToolchain().sdkVersion, at: new Date().toISOString() }));
    return { dir, prepared: true, ms: Date.now() - started, log };
  }

  private writeCommonRsp(dir: string, extraRefs: string[], extraUsings: string[] = []): void {
    const tc = discoverToolchain();
    const refs = readdirSync(tc.refDir)
      .filter((f) => f.endsWith('.dll'))
      .map((f) => join(tc.refDir, f));
    const lines = [
      '-nologo',
      '-nullable:enable',
      '-langversion:latest',
      '-debug:portable',
      '-deterministic',
      '-define:DEBUG;TRACE',
      '-nowarn:1701,1702',
      '-utf8output',
      ...[...refs, ...extraRefs].map((r) => `-r:"${r}"`),
    ];
    writeFileSync(join(dir, 'refs.rsp'), lines.join('\n') + '\n');
    const usings = [...IMPLICIT_USINGS, ...extraUsings].map((u) => `global using ${u};`);
    // Redirected stdout on Windows defaults to the OEM code page, which turns the
    // harness's ✔ ☐ ✘ into '?'. A module initializer in the graded assembly forces
    // UTF-8 before user code (or Check) prints anything.
    const utf8Init =
      'namespace BootQuestRuntime { internal static class Utf8Console { [System.Runtime.CompilerServices.ModuleInitializer] internal static void Init() { try { System.Console.OutputEncoding = new System.Text.UTF8Encoding(false); } catch { } } } }';
    writeFileSync(
      join(dir, 'src', '_globals.cs'),
      [...usings, '[assembly: System.Runtime.Versioning.TargetFramework(".NETCoreApp,Version=v10.0")]', utf8Init, ''].join('\n'),
    );
  }

  private async prepareConsole(dir: string): Promise<string> {
    const check = readFileSync(this.opts.checkHarnessPath ?? CHECK_DEFAULT, 'utf8');
    writeFileSync(join(dir, 'src', 'Check.cs'), check);
    const checkDll = join(dir, 'bin', 'Check.dll');
    this.writeCommonRsp(dir, []);
    // Check.dll once (the `#:project ../../_lib/Check/Check.csproj` of every exercise).
    const c = await this.csc(dir, ['-target:library', `-out:${checkDll}`, join(dir, 'src', '_globals.cs'), join(dir, 'src', 'Check.cs')]);
    if (!c.ok) throw new Error(`console-check: Check.dll failed to compile\n${c.output}`);
    this.writeCommonRsp(dir, [checkDll]);
    writeFileSync(
      join(dir, 'bin', 'Exercise.runtimeconfig.json'),
      JSON.stringify({ runtimeOptions: { tfm: 'net10.0', framework: { name: 'Microsoft.NETCore.App', version: '10.0.0' } } }, null, 2),
    );
    return c.output;
  }

  private async prepareXunit(dir: string): Promise<string> {
    writeFileSync(join(dir, 'Scratch.Tests.csproj'), XUNIT_CSPROJ);
    writeFileSync(join(dir, 'src', 'Solution.cs'), 'public static class Placeholder { public static int One() => 1; }\n');
    writeFileSync(join(dir, 'src', 'Tests.cs'), 'public class PlaceholderTests { [Fact] public void One() => Assert.Equal(1, Placeholder.One()); }\n');
    writeFileSync(join(dir, 'Directory.Build.props'), '<Project><PropertyGroup><EnableDefaultCompileItems>false</EnableDefaultCompileItems></PropertyGroup><ItemGroup><Compile Include="src/Solution.cs;src/Tests.cs" /></ItemGroup></Project>\n');
    const r = await runProc('dotnet', ['restore', '--nologo'], { cwd: dir, timeoutMs: 300_000 });
    if (r.code !== 0) throw new Error(`xunit: dotnet restore failed\n${r.output}`);
    const b = await runProc('dotnet', ['build', '--no-restore', '--nologo', '-nodeReuse:false', `-p:SharedCompilationId=${this.pipe}`, '-p:OutDir=bin/'], {
      cwd: dir,
      timeoutMs: 300_000,
    });
    if (b.code !== 0) throw new Error(`xunit: first dotnet build failed\n${b.output}`);
    const bin = join(dir, 'bin');
    this.writeCommonRsp(dir, ['xunit.abstractions.dll', 'xunit.assert.dll', 'xunit.core.dll'].map((f) => join(bin, f)), ['Xunit']);
    return r.output + b.output;
  }

  // ── compile + run ──────────────────────────────────────────────────────────

  async csc(dir: string, args: string[]): Promise<CompileOutcome> {
    const tc = discoverToolchain();
    const r = await runProc('dotnet', [tc.cscDll, '-noconfig', `-shared:${this.pipe}`, `@${join(dir, 'refs.rsp')}`, ...args], {
      cwd: join(dir, 'src'),
      timeoutMs: 120_000,
    });
    if (r.timedOut) return { ok: false, output: `compiler timed out after ${r.ms} ms\n${r.output}`, ms: r.ms };
    return { ok: r.code === 0, output: r.output, ms: r.ms };
  }

  /** console-check: write Program.cs, compile against Check.dll, run with timeout. */
  async attemptConsole(program: string, timeoutMs: number): Promise<AttemptRaw> {
    const started = Date.now();
    const dir = this.dir('console-check');
    writeFileSync(join(dir, 'src', 'Program.cs'), program);
    const compile = await this.csc(dir, [
      '-target:exe',
      `-out:${join(dir, 'bin', 'Exercise.dll')}`,
      '_globals.cs',
      'Program.cs',
    ]);
    if (!compile.ok) return { compile, totalMs: Date.now() - started };
    const run = await runProc('dotnet', [join(dir, 'bin', 'Exercise.dll')], { cwd: join(dir, 'bin'), timeoutMs });
    return { compile, run, totalMs: Date.now() - started };
  }

  /** xunit: write Solution.cs + Tests.cs, build (fast: csc / msbuild: dotnet test), run vstest, read TRX. */
  async attemptXunit(solution: string, tests: string, timeoutMs: number): Promise<AttemptRaw> {
    const started = Date.now();
    const dir = this.dir('xunit');
    writeFileSync(join(dir, 'src', 'Solution.cs'), solution);
    writeFileSync(join(dir, 'src', 'Tests.cs'), tests);
    const results = join(dir, 'results');
    rmSync(results, { recursive: true, force: true });
    const trxPath = join(results, 'result.trx');
    const engine = this.opts.xunitEngine ?? 'fast';

    if (engine === 'msbuild') {
      const run = await runProc(
        'dotnet',
        ['test', '--nologo', '--no-restore', '-nodeReuse:false', `-p:SharedCompilationId=${this.pipe}`, '-p:OutDir=bin/', '--logger', 'trx;LogFileName=result.trx', '--results-directory', results],
        { cwd: dir, timeoutMs: timeoutMs + 60_000 },
      );
      const trx = existsSync(trxPath) ? readFileSync(trxPath, 'utf8') : undefined;
      const compileFailed = !trx && /error CS\d+/.test(run.output);
      return {
        compile: { ok: !compileFailed, output: compileFailed ? run.output : '', ms: 0 },
        run: compileFailed ? undefined : run,
        trx,
        totalMs: Date.now() - started,
      };
    }

    const dll = join(dir, 'bin', 'Scratch.Tests.dll');
    const compile = await this.csc(dir, ['-target:library', `-out:${dll}`, '_globals.cs', 'Solution.cs', 'Tests.cs']);
    if (!compile.ok) return { compile, totalMs: Date.now() - started };
    const run = await runProc('dotnet', ['vstest', dll, '--logger:trx;LogFileName=result.trx', `--ResultsDirectory:${results}`], {
      cwd: dir,
      timeoutMs,
    });
    const trx = existsSync(trxPath) ? readFileSync(trxPath, 'utf8') : undefined;
    return { compile, run, trx, totalMs: Date.now() - started };
  }

  /** Stop the compiler server this manager started (named pipe), then nothing of ours lingers. */
  async shutdown(): Promise<void> {
    const tc = discoverToolchain();
    await runProc('dotnet', [tc.vbcscompilerDll, '-shutdown', `-pipename:${this.pipe}`], {
      cwd: this.opts.appDataDir,
      timeoutMs: 30_000,
    }).catch(() => undefined);
    for (const pid of livePids()) killTree(pid);
  }
}
