import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SEED_GENERATORS, type SeedGenerator, type SeedItem } from '@bootquest/shared';
import type { GraderKind, Toolchain } from '@bootquest/server/grader-fingerprint';
import {
  ALWAYS_ROOTS,
  computeSeedFingerprint,
  extractImports,
  packRunners,
  runnerFiles,
  seedClosure,
  seedFingerprint,
  seedFingerprintFiles,
  seedToolchain,
  type SeedRunner,
} from './fingerprint.ts';
import { REPO_ROOT } from './report.ts';

/*
 * PINNED fingerprint input set. If this test fails, the set of files a seed stamp is bound to
 * changed (a new import, a moved file, a new server edge). Check the new set is right (no gap,
 * no grader dragged into a pack that never runs it), then update the lists here IN THE SAME
 * COMMIT: every seed stamp of the affected generators goes stale (seed:check -- --restamp).
 */
const SHARED = ['api', 'campaign', 'check', 'enums', 'index', 'mutation', 'pack', 'schemas', 'seed-pack', 'sync', 'thresholds'].map((f) => `shared/src/${f}.ts`);
const F = 'tools/seed/src/factory';
const COMMON = [
  'server/src/api/runners.ts', // gradeDeterministic (quests/validate.ts)
  ...SHARED,
  'tools/seed/exclusions.json',
  'tools/seed/src/citations/resolve.ts',
  `${F}/check/check.ts`,
  `${F}/checkout.ts`,
  `${F}/cite.ts`,
  `${F}/exclusions.ts`,
  `${F}/fingerprint.ts`,
  `${F}/guards.ts`, // stamp-path guards: blind-pass, quiz-balance, lint, leaks, secret scan
  `${F}/harness/harness.ts`,
  `${F}/leak.ts`, // shared token rules (noteLeaks + eb-leak)
  `${F}/pack.ts`,
  `${F}/pins.ts`, // git-tree pin verification (checkout.ts)
  `${F}/quests/validate.ts`, // checkProvenance: every generator
  `${F}/report.ts`,
  `${F}/util.ts`,
  'tools/seed/src/validate/verdicts.ts', // NOT_A_VERDICT (harness.ts)
];
const PINNED: Record<SeedGenerator, string[]> = {
  quests: [...COMMON, 'tools/seed/src/citations/parse.ts', `${F}/quests/cli.ts`, `${F}/quests/generate.ts`, `${F}/quests/parse.ts`, `${F}/quests/run.ts`],
  explainback: [...COMMON, `${F}/explainback/cli.ts`, `${F}/explainback/explainback.ts`, `${F}/explainback/run.ts`, `${F}/quests/parse.ts`],
  variants: [...COMMON, `${F}/variants/cli.ts`, `${F}/variants/run.ts`, `${F}/variants/variants.ts`],
  patches: [...COMMON, `${F}/patches/cli.ts`, `${F}/patches/patches.ts`, `${F}/patches/run.ts`],
  notes: [...COMMON, `${F}/notes/cli.ts`, `${F}/notes/notes.ts`, `${F}/notes/run.ts`],
};
const PINNED_RUNNERS: Record<SeedRunner, string[]> = {
  'drill-js': ['server/src/api/runners.ts', 'server/src/runners/js/grade-core.mjs', 'server/src/runners/js/index.ts'],
  'drill-cs': [
    'server/src/api/runner-csharp.ts',
    'server/src/runners/csharp/BqLaunch.cs',
    'server/src/runners/csharp/csbootcamp-split.ts',
    'server/src/runners/csharp/fixtures/csbootcamp/_lib/Check/Check.cs',
    'server/src/runners/csharp/fixtures/jstrain-csbootcamp/_lib/Check/Check.cs',
    'server/src/runners/csharp/fixtures/jstrain-csbootcamp/_lib/Check/Spy.cs',
    'server/src/runners/csharp/index.ts',
    'server/src/runners/csharp/scratch.ts',
    'server/src/runners/result-channel.ts',
    'server/src/runners/self-run/compose.ts',
  ],
  'drill-java': [
    'server/src/api/runner-java.ts',
    'server/src/runners/csharp/scratch.ts',
    'server/src/runners/java/fixtures/javabootcamp/_lib/check/bootcamp/BqMain.java',
    'server/src/runners/java/fixtures/javabootcamp/_lib/check/bootcamp/Check.java',
    'server/src/runners/java/index.ts',
    'server/src/runners/java/split.ts',
    'server/src/runners/result-channel.ts',
  ],
};
/** factory sources deliberately outside every closure: argument parsing / demo drivers that validate nothing */
const NOT_BOUND = [`${F}/check/cli.ts`, `${F}/demo/plant.ts`, `${F}/demo/planted.ts`];

const sorted = (a: readonly string[]) => [...new Set(a)].sort();
const EXECUTING_GENS = ['variants', 'patches'] as const;

describe('seed fingerprint: the pinned input set (derived import closure)', () => {
  it.each(SEED_GENERATORS)('%s: the resolved file set is exactly the pinned one', (g) => {
    expect(seedClosure(g).files).toEqual(sorted(PINNED[g]));
    expect(seedFingerprintFiles(g, [])).toEqual(sorted(PINNED[g]));
    expect(seedClosure(g).deps.map((d) => d.replace(/@[^@]+$/, ''))).toEqual(['zod']);
  });

  it('each runner binds exactly its own grader files (the import gate validators excluded)', () => {
    for (const r of Object.keys(PINNED_RUNNERS) as SeedRunner[]) expect(runnerFiles([r])).toEqual(sorted(PINNED_RUNNERS[r]));
    expect(seedFingerprintFiles('patches', ['drill-js', 'drill-java'])).toEqual(sorted([...PINNED.patches, ...PINNED_RUNNERS['drill-js'], ...PINNED_RUNNERS['drill-java']]));
  });

  it('closes the review gaps: checkProvenance, quests/parse, the restamp gate, shared check/pack and gradeDeterministic are bound', () => {
    for (const g of SEED_GENERATORS) {
      const files = seedClosure(g).files;
      for (const f of [...ALWAYS_ROOTS, `${F}/quests/validate.ts`, 'server/src/api/runners.ts']) expect(files, `${g} ${f}`).toContain(f);
    }
    expect(seedClosure('explainback').files).toContain(`${F}/quests/parse.ts`);
  });

  it('every factory source is in some closure or deliberately unbound (a new file cannot slip through unnoticed)', () => {
    const root = join(REPO_ROOT, ...F.split('/'));
    const all: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) {
          if (n !== 'fixtures') walk(p);
        } else if (/\.(m?ts|tsx)$/.test(n) && !n.endsWith('.test.ts')) all.push(relative(REPO_ROOT, p).split(sep).join('/'));
      }
    };
    walk(root);
    const bound = new Set(SEED_GENERATORS.flatMap((g) => seedClosure(g).files));
    expect(all.filter((f) => !bound.has(f)).sort()).toEqual(sorted(NOT_BOUND));
  });

  it('the regex import extractor agrees with the TypeScript AST on every walked module', () => {
    const modules = sorted(SEED_GENERATORS.flatMap((g) => seedClosure(g).files)).filter((f) => /\.(m?ts|tsx)$/.test(f) && !f.startsWith('server/'));
    expect(modules.length).toBeGreaterThan(20);
    for (const rel of modules) {
      const src = readFileSync(join(REPO_ROOT, ...rel.split('/')), 'utf8');
      const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true);
      const want: string[] = [];
      const visit = (n: ts.Node): void => {
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) want.push(`${n.importClause?.isTypeOnly ? 'type ' : ''}${n.moduleSpecifier.text}`);
        else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) want.push(`${n.isTypeOnly ? 'type ' : ''}${n.moduleSpecifier.text}`);
        else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const a = n.arguments[0];
          want.push(a && ts.isStringLiteral(a) ? a.text : '<non-literal>');
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      const got = extractImports(src, rel).map((r) => `${r.typeOnly ? 'type ' : ''}${r.spec}`);
      expect(got.sort(), rel).toEqual(want.sort());
    }
  });

  it('the extractor: type-only skipped, multi-line + side-effect + dynamic kept, a non-literal dynamic import throws', () => {
    const src = "import type { A } from './a.ts';\nimport {\n  b,\n  type C,\n} from './b.ts';\nexport type { D } from './d.ts';\nexport * from './e.ts';\nimport './f.ts';\nconst g = await import('./g.ts');\n";
    expect(extractImports(src)).toEqual([
      { spec: './a.ts', typeOnly: true },
      { spec: './b.ts', typeOnly: false },
      { spec: './d.ts', typeOnly: true },
      { spec: './e.ts', typeOnly: false },
      { spec: './f.ts', typeOnly: false },
      { spec: './g.ts', typeOnly: false },
    ]);
    expect(() => extractImports('const m = await import(name);', 'x.ts')).toThrow(/non-literal dynamic import/);
  });
});

// ---------------------------------------------------------------- sensitivity (injected bytes / versions)

const BASE: Record<GraderKind, Toolchain> = {
  js: { node: 'v22.16.0', esbuild: '0.25.0' },
  csharp: { node: 'v22.16.0', dotnetSdk: '10.0.100', dotnetRef: '10.0.0' },
  java: { node: 'v22.16.0', jdk: '17.0.10' },
  selfrun: { node: 'v22.16.0' },
};
const versions =
  (over: Partial<Record<GraderKind, Toolchain>> = {}) =>
  (k: GraderKind): Toolchain => over[k] ?? BASE[k];
const disk = (rel: string) => readFileSync(join(REPO_ROOT, ...rel.split('/')), 'utf8');
const editing = (target: string) => (rel: string) => (rel === target ? `${disk(rel)}\n// edited\n` : disk(rel));

/** every (generator, runner set) a real pack can have */
const SHAPES: Array<[SeedGenerator, SeedRunner[]]> = [
  ['quests', []],
  ['explainback', []],
  ['notes', []],
  ['variants', ['drill-js']],
  ['variants', ['drill-java']],
  ['patches', []],
  ['patches', ['drill-js']],
  ['patches', ['drill-cs']],
  ['patches', ['drill-java']],
  ['patches', ['drill-cs', 'drill-java', 'drill-js']],
];
const fp = (g: SeedGenerator, r: SeedRunner[], read?: (rel: string) => string, v = versions()) => computeSeedFingerprint(g, r, { versions: v, ...(read ? { read } : {}) });

describe('seed fingerprint: what invalidates what', () => {
  it.each([...ALWAYS_ROOTS, `${F}/quests/validate.ts`, 'server/src/api/runners.ts', 'tools/seed/exclusions.json', 'shared/src/index.ts', `${F}/pack.ts`])(
    'editing %s changes EVERY generator fingerprint (every pack shape)',
    (file) => {
      for (const [g, r] of SHAPES) expect(fp(g, r, editing(file)), `${g} [${r}]`).not.toBe(fp(g, r));
    },
  );

  it('a generator-private file stales only the generators that import it', () => {
    const changed = (file: string) => SHAPES.filter(([g, r]) => fp(g, r, editing(file)) !== fp(g, r)).map(([g]) => g);
    expect(sorted(changed(`${F}/quests/parse.ts`))).toEqual(['explainback', 'quests']);
    expect(sorted(changed(`${F}/notes/notes.ts`))).toEqual(['notes']);
    expect(sorted(changed(`${F}/variants/variants.ts`))).toEqual(['variants']);
    expect(sorted(changed('tools/seed/src/citations/parse.ts'))).toEqual(['quests']);
  });

  it('a JS-only patches pack ignores a .NET SDK / JDK bump; a java pack does not; a C# pack does not', () => {
    const bumped = versions({ csharp: { node: 'v22.16.0', dotnetSdk: '10.0.101', dotnetRef: '10.0.1' }, java: { node: 'v22.16.0', jdk: '17.0.11' } });
    expect(fp('patches', ['drill-js'], undefined, bumped)).toBe(fp('patches', ['drill-js']));
    expect(fp('variants', ['drill-js'], undefined, bumped)).toBe(fp('variants', ['drill-js']));
    expect(fp('patches', [], undefined, bumped)).toBe(fp('patches', []));
    expect(fp('quests', [], undefined, bumped)).toBe(fp('quests', []));
    expect(fp('patches', ['drill-java'], undefined, bumped)).not.toBe(fp('patches', ['drill-java']));
    expect(fp('patches', ['drill-cs'], undefined, bumped)).not.toBe(fp('patches', ['drill-cs']));
    expect(fp('patches', ['drill-java', 'drill-js'], undefined, bumped)).not.toBe(fp('patches', ['drill-java', 'drill-js']));
    // and the reverse: an esbuild bump leaves java / C# packs alone
    const esb = versions({ js: { node: 'v22.16.0', esbuild: '0.26.0' } });
    expect(fp('patches', ['drill-java'], undefined, esb)).toBe(fp('patches', ['drill-java']));
    expect(fp('patches', ['drill-js'], undefined, esb)).not.toBe(fp('patches', ['drill-js']));
  });

  it('a grader source edit stales only the packs that run that grader', () => {
    const java = editing('server/src/runners/java/fixtures/javabootcamp/_lib/check/bootcamp/Check.java');
    expect(fp('patches', ['drill-js'], java)).toBe(fp('patches', ['drill-js']));
    expect(fp('patches', ['drill-java'], java)).not.toBe(fp('patches', ['drill-java']));
    const cs = editing('server/src/runners/csharp/index.ts');
    expect(fp('variants', ['drill-js'], cs)).toBe(fp('variants', ['drill-js']));
    expect(fp('patches', ['drill-cs'], cs)).not.toBe(fp('patches', ['drill-cs']));
    const js = editing('server/src/runners/js/grade-core.mjs');
    expect(fp('patches', ['drill-java'], js)).toBe(fp('patches', ['drill-java']));
    expect(fp('patches', ['drill-js'], js)).not.toBe(fp('patches', ['drill-js']));
  });

  it('the runner set itself is bound (same bytes, different runners -> different fingerprint)', () => {
    const all = SHAPES.map(([g, r]) => fp(g, r));
    expect(new Set(all).size).toBe(all.length);
  });

  it('toolchain: node always, each runner adds only its own versions', () => {
    const v = versions();
    expect(seedToolchain('quests', [], v)).toEqual({ node: process.version });
    expect(seedToolchain('patches', [], v)).toEqual({ node: process.version });
    expect(seedToolchain('patches', ['drill-js'], v)).toEqual({ node: process.version, esbuild: '0.25.0' });
    expect(seedToolchain('patches', ['drill-java'], v)).toEqual({ node: process.version, jdk: '17.0.10' });
    expect(seedToolchain('variants', ['drill-cs'], v)).toEqual({ node: process.version, dotnetSdk: '10.0.100', dotnetRef: '10.0.0' });
    expect(seedToolchain('patches', ['drill-js', 'drill-js', 'drill-java'], v)).toEqual({ node: process.version, esbuild: '0.25.0', jdk: '17.0.10' });
  });

  it('a generator that executes nothing cannot be asked to bind a runner', () => {
    for (const g of SEED_GENERATORS.filter((x) => !(EXECUTING_GENS as readonly string[]).includes(x))) {
      expect(() => computeSeedFingerprint(g, ['drill-js'])).toThrow(/executes nothing/);
    }
  });

  it('packRunners: variant checks + kata tests (test-less katas bind nothing), sorted union', () => {
    const variant = (type: SeedRunner) => ({ kind: 'variant', check: { type } }) as unknown as SeedItem;
    const kata = (type?: SeedRunner) => ({ kind: 'patch-kata', ...(type ? { test: { module: 'm', check: { type } } } : {}) }) as unknown as SeedItem;
    expect(packRunners([kata(), kata()])).toEqual([]);
    expect(packRunners([kata('drill-js'), kata()])).toEqual(['drill-js']);
    expect(packRunners([kata('drill-js'), kata('drill-java'), kata('drill-js')])).toEqual(['drill-java', 'drill-js']);
    expect(packRunners([variant('drill-cs'), variant('drill-js')])).toEqual(['drill-cs', 'drill-js']);
    expect(packRunners([{ kind: 'quiz' } as unknown as SeedItem])).toEqual([]);
  });

  it('the cached real fingerprint equals the computed one and is runner-order independent', () => {
    expect(seedFingerprint('quests', [])).toBe(computeSeedFingerprint('quests', []));
    expect(seedFingerprint('patches', ['drill-js', 'drill-java'])).toBe(seedFingerprint('patches', ['drill-java', 'drill-js']));
  });
});
