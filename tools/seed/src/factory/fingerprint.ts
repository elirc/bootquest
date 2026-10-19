/**
 * Seed fingerprint, kind 'seed:<generator>' — the seed-pack analogue of the
 * server's grader fingerprint (server/src/store/grader-fingerprint.ts). A stamp is
 * bound to:
 *
 *   1. the generator's FULL import closure, derived (not hand-listed): a static walk
 *      of the value imports (`import type` / `export type` are elided at runtime and
 *      skipped) starting from
 *        - factory/<generator>/cli.ts, the generator entry (run.ts, its validator and
 *          everything they import: quests/validate.ts, quests/parse.ts, checkout.ts,
 *          cite.ts, citations/*, pack.ts, this file, ...);
 *        - factory/check/check.ts, the seed:check / --restamp gate. Its edges into
 *          OTHER generators' folders are per-generator dispatch: each must be declared
 *          in CHECK_DISPATCH (an undeclared one throws) and is followed only for the
 *          generators listed there;
 *        - shared/src/seed-pack.ts, shared/src/check.ts, shared/src/pack.ts (always).
 *      The walk covers tools/seed/src and shared/src (`@bootquest/shared[/sub]` resolves
 *      through shared/package.json "exports"). External packages (zod, ...) are bound by
 *      their installed version. `@bootquest/server/*` is a BOUNDARY, never walked: every
 *      server entry the closure imports must be declared in SERVER_EDGES (an undeclared
 *      one throws) as fixed bytes (gradeDeterministic in api/runners.ts), a per-pack
 *      runner, or bound-by-outputs. Anything unplaceable (a relative import outside the
 *      walked trees, an unknown export, a missing file, a non-literal dynamic import)
 *      throws: the set is closed and fails loudly. fingerprint.test.ts pins it.
 *   2. the exclusion registry (tools/seed/exclusions.json, read at runtime).
 *   3. PER PACK, only the graders its items actually execute: the runner types of its
 *      shipped + review-held items (variant.check, patch-kata test.check). Each runner
 *      binds the server's grader file list for its kind (FINGERPRINT_FILES, the same
 *      list that binds code-pack stamps, minus the import gate's validators the factory
 *      never runs) and its toolchain: drill-js -> esbuild, drill-cs -> the .NET SDK +
 *      ref pack, drill-java -> the JDK. A mixed pack binds the union; a pack with no
 *      runnable check (quests / explainback / notes, test-less katas) binds none. So a
 *      .NET update stales only the packs that run drill-cs.
 * Every bound file is hashed with its repo-relative path and CRLF-normalised bytes.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { FINGERPRINT_FILES, toolchainVersions, type GraderKind, type Toolchain } from '@bootquest/server/grader-fingerprint';
import { SEED_GENERATORS, type SeedGenerator, type SeedItem, type SeedRunnableCheck } from '@bootquest/shared';
import { sha256 } from './util.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
const abs = (rel: string): string => join(REPO, ...rel.split('/'));
const relOf = (a: string): string => relative(REPO, a).split(sep).join('/');

/** a check type the factory harness executes */
export type SeedRunner = SeedRunnableCheck['type'];
export const SEED_RUNNERS: readonly SeedRunner[] = ['drill-cs', 'drill-java', 'drill-js'];
const RUNNER_GRADER: Readonly<Record<SeedRunner, GraderKind>> = { 'drill-js': 'js', 'drill-cs': 'csharp', 'drill-java': 'java' };

/** generators that execute code through the real runner */
export const EXECUTING: ReadonlySet<SeedGenerator> = new Set(['variants', 'patches']);

/** walk roots bound for every generator (besides factory/<generator>/cli.ts) */
export const ALWAYS_ROOTS: readonly string[] = ['shared/src/seed-pack.ts', 'shared/src/check.ts', 'shared/src/pack.ts', 'tools/seed/src/factory/check/check.ts'];
/** files the closure reads at runtime (not imported) */
export const DATA_FILES: readonly string[] = ['tools/seed/exclusions.json'];
/** the only trees the walk enters */
const WALKED: readonly string[] = ['tools/seed/src/', 'shared/src/'];

const CHECK = 'tools/seed/src/factory/check/check.ts';
/** check.ts's dispatch edges into generator folders: the generators whose packs each target validates */
export const CHECK_DISPATCH: Readonly<Record<string, readonly SeedGenerator[]>> = {
  'tools/seed/src/factory/explainback/explainback.ts': ['explainback'],
  'tools/seed/src/factory/notes/notes.ts': ['notes'],
  'tools/seed/src/factory/patches/patches.ts': ['patches'],
  'tools/seed/src/factory/quests/validate.ts': ['quests', 'variants'],
  'tools/seed/src/factory/variants/variants.ts': ['variants'],
};

export type ServerEdge =
  | { bind: 'bytes'; files: readonly string[]; why: string }
  | { bind: 'runner'; runner: SeedRunner; why: string }
  | { bind: 'outputs'; why: string };
/** every @bootquest/server entry the walked closure may import, and how it is bound */
export const SERVER_EDGES: Readonly<Record<string, ServerEdge>> = {
  '@bootquest/server/runners': {
    bind: 'bytes',
    files: ['server/src/api/runners.ts'],
    why: 'gradeDeterministic grades every generated quiz (quests/validate.ts); its drillJsRunner (harness.ts) is additionally bound per pack under drill-js',
  },
  '@bootquest/server/runner-csharp': { bind: 'runner', runner: 'drill-cs', why: 'the drill-cs adapter harness.ts executes through' },
  '@bootquest/server/runner-java': { bind: 'runner', runner: 'drill-java', why: 'the drill-java adapter harness.ts executes through' },
  '@bootquest/server/grader-fingerprint': {
    bind: 'outputs',
    why: 'only FINGERPRINT_FILES + toolchainVersions are read from it, and both outputs are bound (each listed file by path + bytes, each version by value)',
  },
};

/** the import gate's validators (seed:validate) ride in the grader file lists; the factory never runs them */
const IMPORT_GATE_VALIDATORS: ReadonlySet<string> = new Set(['validate.ts', 'validate-java.ts']);

// ------------------------------------------------------------------ import extraction

export interface ImportRef {
  spec: string;
  /** `import type` / `export type`: elided at runtime, not part of the closure */
  typeOnly: boolean;
}

const FROM_RE = /^[ \t]*(import|export)\b(?![ \t]*\()([^;]*?)\bfrom[ \t]*(['"])([^'"\n]+)\3/gm;
const BARE_RE = /^[ \t]*import[ \t]*(['"])([^'"\n]+)\1/gm;
const DYNAMIC_RE = /\bimport\(\s*(['"`]?)([^'"`)\s]*)\1\s*\)/g;

/** Static, side-effect and dynamic import specifiers of a module (regex; cross-checked against the TypeScript AST in fingerprint.test.ts). */
export function extractImports(src: string, file = '<module>'): ImportRef[] {
  const out: ImportRef[] = [];
  for (const m of src.matchAll(FROM_RE)) out.push({ spec: m[4]!, typeOnly: /^\s+type\s/.test(m[2]!) });
  for (const m of src.matchAll(BARE_RE)) out.push({ spec: m[2]!, typeOnly: false });
  for (const m of src.matchAll(DYNAMIC_RE)) {
    if (!m[1] || m[1] === '`') throw new Error(`fingerprint: ${file}: non-literal dynamic import of '${m[2]}': the closure cannot be derived`);
    out.push({ spec: m[2]!, typeOnly: false });
  }
  return out;
}

// ------------------------------------------------------------------ resolution

const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

function resolveRelative(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  const tries = [base];
  if (/\.m?js$/.test(base)) tries.push(base.replace(/\.(m?)js$/, '.$1ts'));
  if (!extname(base)) tries.push(`${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, join(base, 'index.ts'));
  const hit = tries.find(isFile);
  if (!hit) throw new Error(`fingerprint: ${relOf(from)}: cannot resolve import '${spec}'`);
  return hit;
}

const WORKSPACES: Readonly<Record<string, string>> = { '@bootquest/shared': 'shared', '@bootquest/server': 'server' };

function resolveWorkspace(pkg: string, spec: string, from: string): string {
  const dir = abs(WORKSPACES[pkg]!);
  const exportsMap = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { exports?: Record<string, string> }).exports ?? {};
  const target = exportsMap[spec === pkg ? '.' : `.${spec.slice(pkg.length)}`];
  if (!target) throw new Error(`fingerprint: ${relOf(from)}: '${spec}' is not exported by ${pkg}`);
  return resolve(dir, target);
}

const packageName = (spec: string): string => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

function depVersion(name: string): string {
  const p = join(REPO, 'node_modules', ...name.split('/'), 'package.json');
  if (!isFile(p)) throw new Error(`fingerprint: external dependency ${name} is not installed at ${relOf(p)}`);
  return (JSON.parse(readFileSync(p, 'utf8')) as { version: string }).version;
}

const generatorDirOf = (rel: string): SeedGenerator | null => {
  const m = /^tools\/seed\/src\/factory\/([^/]+)\//.exec(rel);
  return m && (SEED_GENERATORS as readonly string[]).includes(m[1]!) ? (m[1] as SeedGenerator) : null;
};

export interface SeedClosure {
  /** repo-relative files bound by bytes (walked modules + server byte edges + data files), sorted */
  files: string[];
  /** external packages the closure imports, `name@version`, sorted */
  deps: string[];
  /** runner adapters the closure reaches (bound per pack, never here), sorted */
  runnerEdges: SeedRunner[];
}

const closureCache = new Map<SeedGenerator, SeedClosure>();

/** The generator's static import closure (see the header). Throws on anything it cannot place. */
export function seedClosure(generator: SeedGenerator): SeedClosure {
  const hit = closureCache.get(generator);
  if (hit) return hit;
  const files = new Set<string>(DATA_FILES);
  const deps = new Set<string>();
  const runnerEdges = new Set<SeedRunner>();
  const seen = new Set<string>();
  const queue = [`tools/seed/src/factory/${generator}/cli.ts`, ...ALWAYS_ROOTS];
  while (queue.length) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!WALKED.some((w) => rel.startsWith(w))) throw new Error(`fingerprint: ${rel} is outside the walked trees (${WALKED.join(', ')})`);
    const file = abs(rel);
    if (!isFile(file)) throw new Error(`fingerprint: ${rel} does not exist`);
    files.add(rel);
    for (const ref of extractImports(readFileSync(file, 'utf8'), rel)) {
      if (ref.typeOnly || ref.spec.startsWith('node:')) continue;
      let target: string;
      if (ref.spec.startsWith('.')) target = relOf(resolveRelative(file, ref.spec));
      else {
        const pkg = packageName(ref.spec);
        if (pkg === '@bootquest/server') {
          const edge = SERVER_EDGES[ref.spec];
          if (!edge) throw new Error(`fingerprint: ${rel} imports '${ref.spec}', which SERVER_EDGES does not declare (bytes / runner / outputs)`);
          if (edge.bind === 'bytes') for (const f of edge.files) files.add(f);
          else if (edge.bind === 'runner') runnerEdges.add(edge.runner);
          continue;
        }
        if (!(pkg in WORKSPACES)) {
          deps.add(`${pkg}@${depVersion(pkg)}`);
          continue;
        }
        target = relOf(resolveWorkspace(pkg, ref.spec, file));
      }
      if (rel === CHECK) {
        const owner = generatorDirOf(target);
        if (owner !== null) {
          const users = CHECK_DISPATCH[target];
          if (!users) throw new Error(`fingerprint: ${CHECK} imports ${target} (a generator folder) but CHECK_DISPATCH does not declare which generators it validates`);
          if (!users.includes(generator)) continue;
        }
      }
      queue.push(target);
    }
  }
  for (const f of files) if (!isFile(abs(f))) throw new Error(`fingerprint: bound file ${f} does not exist`);
  const out: SeedClosure = { files: [...files].sort(), deps: [...deps].sort(), runnerEdges: [...runnerEdges].sort() };
  closureCache.set(generator, out);
  return out;
}

// ------------------------------------------------------------------ per-pack runners

/** The runner types a pack's items execute (variant.check / patch-kata test.check), sorted + unique. */
export function packRunners(items: readonly SeedItem[]): SeedRunner[] {
  const r = new Set<SeedRunner>();
  for (const it of items) {
    if (it.kind === 'variant') r.add(it.check.type);
    else if (it.kind === 'patch-kata' && it.test) r.add(it.test.check.type);
  }
  return [...r].sort();
}

function normRunners(generator: SeedGenerator, runners: readonly SeedRunner[]): SeedRunner[] {
  const r = [...new Set(runners)].sort();
  for (const x of r) if (!SEED_RUNNERS.includes(x)) throw new Error(`fingerprint: unknown runner ${String(x)}`);
  if (r.length && !EXECUTING.has(generator)) throw new Error(`fingerprint: seed:${generator} executes nothing, yet runners [${r.join(', ')}] were asked for`);
  // drill-js rides on @bootquest/server/runners (a bytes edge, so not in runnerEdges)
  const reachable = new Set<SeedRunner>([...seedClosure(generator).runnerEdges, 'drill-js']);
  for (const x of r) if (!reachable.has(x)) throw new Error(`fingerprint: seed:${generator}'s closure reaches no ${x} adapter`);
  return r;
}

/** Grader files (repo-relative, sorted) bound by these runners. */
export function runnerFiles(runners: readonly SeedRunner[]): string[] {
  const out = new Set<string>();
  for (const r of runners) for (const f of FINGERPRINT_FILES[RUNNER_GRADER[r]]) if (!IMPORT_GATE_VALIDATORS.has(basename(f))) out.add(relOf(f));
  return [...out].sort();
}

/** Every repo-relative file a pack of this generator + runner set is bound to, sorted. */
export function seedFingerprintFiles(generator: SeedGenerator, runners: readonly SeedRunner[]): string[] {
  return [...new Set([...seedClosure(generator).files, ...runnerFiles(normRunners(generator, runners))])].sort();
}

// ------------------------------------------------------------------ toolchain

export interface SeedToolchain {
  node: string;
  /** drill-js */
  esbuild?: string;
  /** drill-cs: the .NET SDK + Microsoft.NETCore.App.Ref versions it compiles with */
  dotnetSdk?: string;
  dotnetRef?: string;
  /** drill-java: the JDK (`javac -version`) it compiles + runs with */
  jdk?: string;
}

export type VersionProbe = (kind: GraderKind) => Toolchain;

/** a missing toolchain probes as 'unknown' (an execution through it then fails, never passes) */
const probeVersions: VersionProbe = (kind) => {
  try {
    return toolchainVersions(kind);
  } catch {
    return { node: process.version };
  }
};

/** node always; each runner's toolchain only when the pack uses that runner. */
export function seedToolchain(generator: SeedGenerator, runners: readonly SeedRunner[], versions: VersionProbe = probeVersions): SeedToolchain {
  const r = normRunners(generator, runners);
  const tc: SeedToolchain = { node: process.version };
  if (r.includes('drill-js')) tc.esbuild = versions('js').esbuild ?? 'unknown';
  if (r.includes('drill-cs')) {
    const cs = versions('csharp');
    tc.dotnetSdk = cs.dotnetSdk ?? 'unknown';
    tc.dotnetRef = cs.dotnetRef ?? 'unknown';
  }
  if (r.includes('drill-java')) tc.jdk = versions('java').jdk ?? 'unknown';
  return tc;
}

// ------------------------------------------------------------------ fingerprint

export interface FingerprintIo {
  /** file text by repo-relative path (default: the working tree) */
  read?: (rel: string) => string;
  versions?: VersionProbe;
}

/** The fingerprint with injectable bytes / versions (tests); seedFingerprint() is the cached real one. */
export function computeSeedFingerprint(generator: SeedGenerator, runners: readonly SeedRunner[], io: FingerprintIo = {}): string {
  const read = io.read ?? ((rel: string) => readFileSync(abs(rel), 'utf8'));
  const r = normRunners(generator, runners);
  const files = seedFingerprintFiles(generator, r).map((f) => `file=${f}\n${read(f).replace(/\r\n/g, '\n')}`);
  const deps = seedClosure(generator).deps.map((d) => `dep=${d}`);
  const tc = Object.entries(seedToolchain(generator, r, io.versions)).map(([k, v]) => `${k}=${v}`);
  return sha256([`kind=seed:${generator}`, `runners=${r.join(',')}`, ...files, ...deps, ...tc].join('\u0000'));
}

const cache = new Map<string, string>();

/** The current fingerprint for a pack of `generator` whose items execute `runners` (packRunners). */
export function seedFingerprint(generator: SeedGenerator, runners: readonly SeedRunner[]): string {
  const key = `${generator}|${[...new Set(runners)].sort().join(',')}`;
  let fp = cache.get(key);
  if (fp === undefined) {
    fp = computeSeedFingerprint(generator, runners);
    cache.set(key, fp);
  }
  return fp;
}
