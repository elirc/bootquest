import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { PackCounts } from '@bootquest/shared';

/**
 * javadrills authoring source — committed, hand-written JSON in THIS repo
 * (tools/seed/authoring/javadrills/<NN-module>.json), one file per module.
 * There is no upstream repo and no checkout: seed:import:javadrills reads these
 * files read-only and writes content/packs/javadrills (see import.ts).
 *
 * Shape (Zod, .strict() everywhere — a misspelled key is an error, never dropped):
 *   { format: 'javadrills-authoring@1', module, title, description,
 *     exercises: [{ slug, title, difficulty, skills, instructions, starter,
 *                   solution, explanation, hints: [h1, h2, h3] }] }
 * There is NO tests array: each starter/solution is a single-file javabootcamp-style
 * `class Exercise` whose tests live inside it, between the `// ─── tests ───` and
 * `// ─── end tests ───` marker lines. Hints are REQUIRED, exactly 3.
 * Content rules the schema cannot express (non-empty strings, TODO starters, the
 * tests-marker structure, byte-identical tests, difficulty 1..3, census) are
 * import.ts refusals.
 */

export const JAVADRILLS_FORMAT = 'javadrills-authoring@1';

/**
 * Census of the committed authoring files (10 modules: 8 × 10 drill-java exercises).
 * Appending a module = add its JSON, bump this, re-import, re-validate.
 */
export const JAVADRILLS_EXPECTED: PackCounts = { total: 80, code: 80, quiz: 0, output: 0, written: 0 };

/** module ids and exercise slugs: NN-kebab-case */
export const ID_RE = /^[0-9]{2}-[a-z0-9-]+$/;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export const JavadrillsExercise = z
  .object({
    slug: z.string(),
    title: z.string().min(1),
    difficulty: z.number().int(),
    skills: z.array(z.string().min(1)),
    instructions: z.string(),
    /** the learner's Exercise.java (compiles; stubs throw UnsupportedOperationException("TODO: …")) */
    starter: z.string(),
    /** the reference Exercise.java — its tests block is byte-identical to the starter's */
    solution: z.string(),
    explanation: z.string(),
    /** exactly 3: nudge, API/rule named, approach in words */
    hints: z.array(z.string().min(1)).length(3),
  })
  .strict();
export type JavadrillsExercise = z.infer<typeof JavadrillsExercise>;

export const JavadrillsModuleFile = z
  .object({
    format: z.literal(JAVADRILLS_FORMAT),
    module: z.string(),
    title: z.string().min(1),
    description: z.string().min(1),
    exercises: z.array(JavadrillsExercise).min(1),
  })
  .strict();
export type JavadrillsModuleFile = z.infer<typeof JavadrillsModuleFile>;

export interface JavadrillsModule extends JavadrillsModuleFile {
  /** course order = the module's NN prefix (01-collections-behavior -> 1) */
  order: number;
  /** authoring file name, e.g. 01-collections-behavior.json */
  file: string;
}

/**
 * Read every *.json in authoringDir (sorted by name). Refuses an empty dir, a
 * file that is not JSON or not the schema, a file named differently from its
 * module, a module id outside NN-kebab, and duplicate module ids / orders /
 * exercise slugs. Nothing is written here.
 */
export function readModules(authoringDir: string): JavadrillsModule[] {
  if (!existsSync(authoringDir)) throw new ImportError(`authoring dir ${authoringDir} does not exist`);
  const files = readdirSync(authoringDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new ImportError(`no authoring JSON in ${authoringDir}`);
  const modules: JavadrillsModule[] = [];
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(authoringDir, file), 'utf8'));
    } catch (err) {
      throw new ImportError(`${file}: not JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    const parsed = JavadrillsModuleFile.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new ImportError(`${file}: not a ${JAVADRILLS_FORMAT} module (${issues})`);
    }
    const m = parsed.data;
    if (!ID_RE.test(m.module)) throw new ImportError(`${file}: module id ${JSON.stringify(m.module)} must match ${ID_RE}`);
    if (`${m.module}.json` !== file) throw new ImportError(`${file}: declares module ${m.module} (file must be named ${m.module}.json)`);
    if (ids.has(m.module)) throw new ImportError(`duplicate module id ${m.module}`);
    const order = Number(m.module.slice(0, 2));
    if (order < 1) throw new ImportError(`${file}: module number must be 01 or higher`);
    if (orders.has(order)) throw new ImportError(`${file}: duplicate module order ${order} (two modules numbered ${m.module.slice(0, 2)})`);
    const slugs = new Set<string>();
    for (const ex of m.exercises) {
      if (slugs.has(ex.slug)) throw new ImportError(`${m.module}: duplicate exercise slug ${ex.slug}`);
      slugs.add(ex.slug);
    }
    ids.add(m.module);
    orders.add(order);
    modules.push({ ...m, order, file });
  }
  return modules;
}
