import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { PackCounts } from '@bootquest/shared';

/**
 * sysdrills authoring source — committed, hand-written JSON in THIS repo
 * (tools/seed/authoring/sysdrills/<NN-module>.json), one file per module.
 * There is no upstream repo and no checkout: seed:import:sysdrills reads these
 * files read-only and writes content/packs/sysdrills (see import.ts).
 *
 * Shape (Zod, .strict() everywhere — a misspelled key is an error, never dropped):
 *   { format: 'sysdrills-authoring@1', module, title, description,
 *     exercises: [{ slug, title, difficulty, skills, instructions, starter,
 *                   solution, tests: [{ name, code, input? }], explanation, hints? }] }
 * Content rules the schema cannot express (non-empty strings, TODO starters,
 * tests that touch `mod.`, difficulty 1..3, census) are import.ts refusals.
 */

export const SYSDRILLS_FORMAT = 'sysdrills-authoring@1';

/**
 * Census of the committed authoring files (14 modules: 8 + 6 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 drill-js exercises).
 * Appending a module = add its JSON, bump this, re-import, re-validate.
 */
export const SYSDRILLS_EXPECTED: PackCounts = { total: 110, code: 110, quiz: 0, output: 0, written: 0 };

/** module ids and exercise slugs: NN-kebab-case */
export const ID_RE = /^[0-9]{2}-[a-z0-9-]+$/;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export const SysdrillsTest = z
  .object({
    name: z.string(),
    /** body of AsyncFunction('mod', 'assert') — assert is node:assert/strict */
    code: z.string(),
    /** optional metadata mirroring the call's arguments */
    input: z.unknown().optional(),
  })
  .strict();
export type SysdrillsTest = z.infer<typeof SysdrillsTest>;

export const SysdrillsExercise = z
  .object({
    slug: z.string(),
    title: z.string().min(1),
    difficulty: z.number().int(),
    skills: z.array(z.string().min(1)),
    instructions: z.string(),
    starter: z.string(),
    solution: z.string(),
    tests: z.array(SysdrillsTest),
    explanation: z.string(),
    hints: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type SysdrillsExercise = z.infer<typeof SysdrillsExercise>;

export const SysdrillsModuleFile = z
  .object({
    format: z.literal(SYSDRILLS_FORMAT),
    module: z.string(),
    title: z.string().min(1),
    description: z.string().min(1),
    exercises: z.array(SysdrillsExercise).min(1),
  })
  .strict();
export type SysdrillsModuleFile = z.infer<typeof SysdrillsModuleFile>;

export interface SysdrillsModule extends SysdrillsModuleFile {
  /** course order = the module's NN prefix (01-estimation -> 1) */
  order: number;
  /** authoring file name, e.g. 01-estimation.json */
  file: string;
}

/**
 * Read every *.json in authoringDir (sorted by name). Refuses an empty dir, a
 * file that is not JSON or not the schema, a file named differently from its
 * module, a module id outside NN-kebab, and duplicate module ids / orders /
 * exercise slugs. Nothing is written here.
 */
export function readModules(authoringDir: string): SysdrillsModule[] {
  if (!existsSync(authoringDir)) throw new ImportError(`authoring dir ${authoringDir} does not exist`);
  const files = readdirSync(authoringDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new ImportError(`no authoring JSON in ${authoringDir}`);
  const modules: SysdrillsModule[] = [];
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(authoringDir, file), 'utf8'));
    } catch (err) {
      throw new ImportError(`${file}: not JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    const parsed = SysdrillsModuleFile.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new ImportError(`${file}: not a ${SYSDRILLS_FORMAT} module (${issues})`);
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
