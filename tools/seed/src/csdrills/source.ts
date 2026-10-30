import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { PackCounts } from '@bootquest/shared';

/**
 * csdrills authoring source — committed, hand-written JSON in THIS repo
 * (tools/seed/authoring/csdrills/<NN-module>.json), one file per module.
 * There is no upstream repo and no checkout: seed:import:csdrills reads these
 * files read-only and writes content/packs/csdrills (see import.ts).
 *
 * Shape (Zod, .strict() everywhere — a misspelled key is an error, never dropped):
 *   { format: 'csdrills-authoring@1', module, title, description,
 *     exercises: [{ slug, title, difficulty, skills, instructions, starterHead,
 *                   solutionHead, tests, tail?, solutionTail?, explanation, hints[3] }] }
 * The one structural difference from sysdrills: a C# drill is a jstrain-harness
 * console-check program, graded as learner.head + CANONICAL tests + learner.tail,
 * so the authoring carries the tests as ONE block string (starting with the
 * `// ─── tests ───` divider) and the starter/solution as their heads (plus an
 * optional `// ─── types ───` tail, shared by both unless a solutionTail is given — used
 * when the learner implements a class, which must live in the tail).
 * Content rules the schema cannot express (non-empty strings, TODO starters,
 * divider placement, literal test names, difficulty 1..3, census) are import.ts
 * refusals.
 */

export const CSDRILLS_FORMAT = 'csdrills-authoring@1';

/**
 * Census of the committed authoring files (10 modules × 8 drill-cs exercises).
 * Appending a module = add its JSON, bump this, re-import, re-validate.
 */
export const CSDRILLS_EXPECTED: PackCounts = { total: 73, code: 73, quiz: 0, output: 0, written: 0 };

/** module ids and exercise slugs: NN-kebab-case */
export const ID_RE = /^[0-9]{2}-[a-z0-9-]+$/;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export const CsdrillsExercise = z
  .object({
    slug: z.string(),
    title: z.string().min(1),
    difficulty: z.number().int(),
    skills: z.array(z.string().min(1)).min(1).max(3),
    instructions: z.string(),
    /** C# above the tests divider: usings + stub local functions (TODO + NotImplementedException) */
    starterHead: z.string(),
    /** the same shape with the bodies implemented */
    solutionHead: z.string(),
    /** the canonical tests block: starts with the `// ─── tests ───` divider line, ends with \n */
    tests: z.string(),
    /**
     * optional `// ─── types ───` section (enum/class/record declarations after the top-level
     * statements). It is the STARTER's tail and the spec's canonical tail; shared with the
     * solution unless solutionTail is given.
     */
    tail: z.string().optional(),
    /**
     * optional solution-side tail, for drills whose learner work is a CLASS (types must follow the
     * top-level statements, so the class lives in the tail): `tail` then carries the stubbed class
     * (TODO + NotImplementedException) and this field the implemented one. The grader composes
     * learner.head + canonical tests + learner.tail, so the solution's own tail is what runs —
     * the jstrain-cs precedent (solution tail ≠ spec tail). Requires `tail`.
     */
    solutionTail: z.string().optional(),
    explanation: z.string(),
    hints: z.array(z.string().min(1)).length(3),
  })
  .strict();
export type CsdrillsExercise = z.infer<typeof CsdrillsExercise>;

export const CsdrillsModuleFile = z
  .object({
    format: z.literal(CSDRILLS_FORMAT),
    module: z.string(),
    title: z.string().min(1),
    description: z.string().min(1),
    exercises: z.array(CsdrillsExercise).min(1),
  })
  .strict();
export type CsdrillsModuleFile = z.infer<typeof CsdrillsModuleFile>;

export interface CsdrillsModule extends CsdrillsModuleFile {
  /** course order = the module's NN prefix (01-linq-set-reconciliation -> 1) */
  order: number;
  /** authoring file name, e.g. 01-linq-set-reconciliation.json */
  file: string;
}

/**
 * Read every *.json in authoringDir (sorted by name). Refuses an empty dir, a
 * file that is not JSON or not the schema, a file named differently from its
 * module, a module id outside NN-kebab, and duplicate module ids / orders /
 * exercise slugs. Nothing is written here.
 */
export function readModules(authoringDir: string): CsdrillsModule[] {
  if (!existsSync(authoringDir)) throw new ImportError(`authoring dir ${authoringDir} does not exist`);
  const files = readdirSync(authoringDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new ImportError(`no authoring JSON in ${authoringDir}`);
  const modules: CsdrillsModule[] = [];
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(authoringDir, file), 'utf8'));
    } catch (err) {
      throw new ImportError(`${file}: not JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    const parsed = CsdrillsModuleFile.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new ImportError(`${file}: not a ${CSDRILLS_FORMAT} module (${issues})`);
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
