import { z } from 'zod';
import { CheckType } from './enums.ts';

/**
 * Check specs: a discriminated union over every check type in spec §4 plus the
 * estate-driven types (estate-contract §6). These describe HOW to verify; they
 * reference content (test files, quiz items, katas) by path/key and carry no
 * curriculum prose. Stored as check.spec JSON; check.type mirrors `type`.
 */

const timeoutMs = z.number().int().positive();
const relPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split(/[\\/]/).includes('..'), {
    message: 'must be a repo-relative path without ..',
  });
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** One BootForge-style test: AsyncFunction('mod','assert') body. */
export const DrillTest = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  input: z.unknown().optional(),
});

export const DrillJsCheck = z.object({
  type: z.literal('drill-js'),
  language: z.enum(['js', 'ts', 'sql']),
  tests: z.array(DrillTest).min(1),
  timeoutMs: timeoutMs.default(8000),
});

/**
 * C# drill graded by the warm C# runner (server/src/runners/csharp, W3a).
 *   console-check  csbootcamp file-based app: the graded program is
 *                  learner.head + files.tests + learner.tail (three-part split);
 *                  files.tests is the exercise's `// ─── tests ───` block through
 *                  `return Report();`, files.tail its types section (used only
 *                  when the learner sends code without the tests marker).
 *                  Pass = Check's `#done` with failed == 0 AND todo == 0 (never the
 *                  exit code alone: untouched csbootcamp starters exit 0).
 *   xunit          files.tests is an xunit test class compiled next to the
 *                  learner's Solution.cs.
 * files.* are PRIVATE (not in the public whitelist).
 */
export const DrillCsCheck = z.object({
  type: z.literal('drill-cs'),
  shape: z.enum(['console-check', 'xunit']),
  files: z
    .object({
      tests: z.string().min(1),
      tail: z.string().default(''),
    })
    .strict(),
  timeoutMs: timeoutMs.default(10000),
});

export const QuizCheck = z.object({
  type: z.literal('quiz'),
  itemKey: z.string().min(1),
  grading: z.enum(['exact', 'choice', 'self']),
  /** single-keyed answer (exact text or choice index) */
  answerKey: z.union([z.string().min(1), z.number().int().nonnegative()]),
  choices: z.array(z.string().min(1)).min(2).optional(),
});

export const PredictOutputCheck = z.object({
  type: z.literal('predict-output'),
  language: z.enum(['js', 'ts', 'cs']),
  /** pre-captured expected stdout (normalized: CRLF->LF, rtrim lines) */
  expected: z.string(),
  normalize: z.boolean().default(true),
});

export const GuidedStepCheck = z.object({
  type: z.literal('guided-step'),
  step: z.number().int().positive(),
  testFile: relPath,
  runner: z.enum(['node-test', 'vitest', 'dotnet-test']),
  timeoutMs: timeoutMs.default(60000),
});

export const HttpExpect = z.object({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string()).optional(),
  /** JSON-shape assertion: key -> typeof name ('string','number','boolean','object','array','null') */
  jsonShape: z.record(z.enum(['string', 'number', 'boolean', 'object', 'array', 'null'])).optional(),
});

export const HttpCheck = z.object({
  type: z.literal('http'),
  port: z.number().int().min(1).max(65535).optional(),
  requests: z
    .array(
      z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        path: z.string().startsWith('/'),
        body: z.unknown().optional(),
        headers: z.record(z.string()).optional(),
        expect: HttpExpect,
      }),
    )
    .min(1),
  timeoutMs: timeoutMs.default(10000),
});

export const RepoPredicate = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('branch-exists'), branch: z.string().min(1) }),
  z.object({ kind: z.literal('ci-green'), branch: z.string().min(1).optional() }),
  z.object({ kind: z.literal('pr-has-section'), section: z.string().min(1) }),
  z.object({ kind: z.literal('file-exists'), path: relPath }),
]);

export const RepoCheck = z.object({
  type: z.literal('repo'),
  predicates: z.array(RepoPredicate).min(1),
});

export const StudyQuizCheck = z.object({
  type: z.literal('study-quiz'),
  itemKeys: z.array(z.string().min(1)).min(1),
  /** pass mark as a fraction; spec §4 = 0.8 */
  passPct: z.number().min(0).max(1).default(0.8),
});

export const ExplainBackCheck = z.object({
  type: z.literal('explain-back'),
  questionSetKey: z.string().min(1),
  questionCount: z.number().int().positive().default(3),
  minCoverage: z.number().min(0).max(1).default(0.8),
});

export const PatchKataCheck = z.object({
  type: z.literal('patch-kata'),
  kataKey: z.string().min(1),
  defectCount: z.number().int().positive(),
});

export const ReviewCheck = z.object({
  type: z.literal('review'),
  cardKey: z.string().min(1),
});

/** signalpost `node:test` check files; workspace mirrors repo layout. */
export const NodeTestFileCheck = z.object({
  type: z.literal('node-test-file'),
  checkPath: relPath, // e.g. practice/checks/u01.test.mjs
  learnerPath: relPath, // e.g. practice/learner/u01.mjs
  sha: z.string().min(7), // pinned source commit
  checkSha256: sha256.optional(), // hash-verified check file
  tsx: z.boolean().default(false), // .ts checks run with --import tsx
  timeoutMs: timeoutMs.default(30000),
});

/** jstrain / csbootcamp self-testing files printing `#done passed= failed= todo=`. */
export const SelfRunCheck = z.object({
  type: z.literal('self-run'),
  language: z.enum(['js', 'ts', 'cs']),
  file: relPath,
  /** TS track: run real tsc first (esbuild drops type-assertion grading) */
  tsc: z.boolean().default(false),
  fixtures: z.array(relPath).default([]),
  /** module must FAIL by design (*-debug / *-hunts); mirrors check.inverted */
  inverted: z.boolean().default(false),
  timeoutMs: timeoutMs.default(30000),
});

export const VitestProjectCheck = z.object({
  type: z.literal('vitest-project'),
  project: relPath,
  testFile: relPath,
  env: z.record(z.string()).optional(),
  timeoutMs: timeoutMs.default(60000),
});

export const CheckSpec = z.discriminatedUnion('type', [
  DrillJsCheck,
  DrillCsCheck,
  QuizCheck,
  PredictOutputCheck,
  GuidedStepCheck,
  HttpCheck,
  RepoCheck,
  StudyQuizCheck,
  ExplainBackCheck,
  PatchKataCheck,
  ReviewCheck,
  NodeTestFileCheck,
  SelfRunCheck,
  VitestProjectCheck,
]);
export type CheckSpec = z.infer<typeof CheckSpec>;
export type CheckSpecInput = z.input<typeof CheckSpec>;

/** Compile-time + runtime guard that the union covers exactly CheckType. */
export const CHECK_SPEC_TYPES: readonly CheckType[] = CheckSpec.options.map((o) => o.shape.type.value);
