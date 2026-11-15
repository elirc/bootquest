import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { PackCounts } from '@bootquest/shared';
import { ImportError } from '../sysdrills/source.ts';

/**
 * agentdrills authoring source (rv3 S4 W8, the C8 eval lab) — committed, hand-written JSON in THIS repo:
 *   tools/seed/authoring/agentdrills/<NN-module>.json            the sysdrills source schema, unchanged
 *                                                                  (format sysdrills-authoring@1, read by
 *                                                                  sysdrills/source.ts readModules)
 *   tools/seed/authoring/agentdrills/fixtures/<NN-module>/<slug>.json   one fixture per exercise (below)
 *
 * Every agentdrill grades RECORDED outputs (or recorded runs / cases) against HAND LABELS. Its fixture
 * holds the cases, each with `label` (true = the property the grader flags holds for this case), the
 * expression that asks the learner's module for its verdict on one case (`flag`, over `mod` and `c`), and
 * the pinned estate source it is built over (ruling 7: `<repo>@<sha>` plus path:line citations). The
 * importer appends one generated test per exercise, "precision and recall >= 0.9 against N hand labels",
 * so the drill's own test suite is the grader check (W8 acceptance), and the census of fixtures is
 * enforced (every exercise has exactly one, no fixture without an exercise).
 */

export const FIXTURE_FORMAT = 'agentdrills-fixture@1';
export const FIXTURES_SUBDIR = 'fixtures';

/** Census of the committed authoring (2 modules x 4 drill-js exercises). */
export const AGENTDRILLS_EXPECTED: PackCounts = { total: 8, code: 8, quiz: 0, output: 0, written: 0 };

/** the bar each reference grader must clear against the hand labels (PLAN W8) */
export const PRECISION_MIN = 0.9;
export const RECALL_MIN = 0.9;
/** a fixture needs enough cases to measure, and both labels; at most 70% positives, so "flag everything" fails precision */
export const MIN_CASES = 10;
export const MIN_EACH_LABEL = 3;
export const MAX_POSITIVE_SHARE = 0.7;

const citeRe = /^[^\s:]+:\d+(-\d+)?$/;

export const FixtureCase = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    label: z.boolean(),
  })
  .passthrough();
export type FixtureCase = z.infer<typeof FixtureCase>;

export const AgentdrillsFixture = z
  .object({
    format: z.literal(FIXTURE_FORMAT),
    /** <module>/<slug> of the exercise it belongs to */
    drill: z.string(),
    source: z
      .object({
        repo: z.string().min(1),
        sha: z.string().regex(/^[0-9a-f]{40}$/),
        /** repo-root path:line or path:start-end */
        cites: z.array(z.string().regex(citeRe)).min(1),
      })
      .strict(),
    /** how the outputs were recorded and labelled */
    note: z.string().min(1),
    /** what label true means */
    positive: z.string().min(1),
    /** JS expression over `mod` (the learner module) and `c` (one case): the learner's flag for that case */
    flag: z.string().min(1),
    cases: z.array(FixtureCase).min(1),
  })
  .strict();
export type AgentdrillsFixture = z.infer<typeof AgentdrillsFixture>;

/** Read and check every fixture under <authoringDir>/fixtures/<module>/<slug>.json; keyed by "<module>/<slug>". */
export function readFixtures(authoringDir: string): Map<string, AgentdrillsFixture> {
  const root = join(authoringDir, FIXTURES_SUBDIR);
  const out = new Map<string, AgentdrillsFixture>();
  if (!existsSync(root)) return out;
  for (const module of readdirSync(root).sort()) {
    const dir = join(root, module);
    if (!statSync(dir).isDirectory()) throw new ImportError(`${FIXTURES_SUBDIR}/${module}: not a module directory`);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const label = `${FIXTURES_SUBDIR}/${module}/${file}`;
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      } catch (err) {
        throw new ImportError(`${label}: not JSON (${err instanceof Error ? err.message : String(err)})`);
      }
      const parsed = AgentdrillsFixture.safeParse(raw);
      if (!parsed.success) throw new ImportError(`${label}: not a ${FIXTURE_FORMAT} fixture (${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')})`);
      const fx = parsed.data;
      const want = `${module}/${file.replace(/\.json$/, '')}`;
      if (fx.drill !== want) throw new ImportError(`${label}: declares drill ${fx.drill} (must be ${want})`);
      checkFixture(fx, label);
      out.set(want, fx);
    }
  }
  return out;
}

/** Content rules the schema cannot express. */
export function checkFixture(fx: AgentdrillsFixture, label: string): void {
  const ids = new Set<string>();
  for (const c of fx.cases) {
    if (ids.has(c.id)) throw new ImportError(`${label}: duplicate case id ${c.id}`);
    ids.add(c.id);
  }
  const pos = fx.cases.filter((c) => c.label).length;
  const neg = fx.cases.length - pos;
  if (fx.cases.length < MIN_CASES) throw new ImportError(`${label}: ${fx.cases.length} case(s), need at least ${MIN_CASES} to measure precision and recall`);
  if (pos < MIN_EACH_LABEL || neg < MIN_EACH_LABEL) throw new ImportError(`${label}: ${pos} positive and ${neg} negative case(s), need at least ${MIN_EACH_LABEL} of each`);
  if (pos / fx.cases.length > MAX_POSITIVE_SHARE) throw new ImportError(`${label}: ${pos} of ${fx.cases.length} cases are positive (max ${MAX_POSITIVE_SHARE * 100}%): a grader that flags everything would pass`);
  if (!fx.flag.includes('mod.')) throw new ImportError(`${label}: flag ${JSON.stringify(fx.flag)} never asks the learner module (no \`mod.\`)`);
}

/** The test the importer appends: the learner's grader against the hand labels. */
export function precisionRecallTest(fx: AgentdrillsFixture): { name: string; code: string } {
  const cases = JSON.stringify(fx.cases);
  return {
    name: `precision and recall >= ${PRECISION_MIN} against the ${fx.cases.length} hand-labelled recorded cases`,
    code: [
      `const cases = ${cases};`,
      `const flag = (c) => ${fx.flag};`,
      'let tp = 0, fp = 0, fn = 0;',
      'for (const c of cases) {',
      '  const flagged = flag(c) === true;',
      '  if (flagged && c.label) tp++;',
      '  else if (flagged) fp++;',
      '  else if (c.label) fn++;',
      '}',
      'const precision = tp + fp === 0 ? 0 : tp / (tp + fp);',
      'const recall = tp + fn === 0 ? 0 : tp / (tp + fn);',
      `assert.ok(precision >= ${PRECISION_MIN} && recall >= ${RECALL_MIN}, 'precision ' + precision.toFixed(2) + ', recall ' + recall.toFixed(2) + ' (tp ' + tp + ', fp ' + fp + ', fn ' + fn + ' over ' + cases.length + ' cases)');`,
    ].join('\n'),
  };
}
