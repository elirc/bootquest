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
      /**
       * W3c (jstrain-cs): frozen scaffolding sections (`// ─── given ───`,
       * `implementations`, `helpers`) the learner must leave as shipped; see
       * SelfRunFrozenBlock. Optional so csbootcamp specs are unchanged.
       */
      frozen: z.array(z.object({ label: z.string().min(1), body: z.string().min(1) }).strict()).optional(),
    })
    .strict(),
  /**
   * W3c: which Check harness revision compiles the program. Absent =
   * 'csbootcamp' (github elirc/csbootcamp: `return Report();`). 'jstrain' =
   * jstrain2.2's embedded revision (Report at ProcessExit, Spy.cs): its own
   * Check.dll + scratch dir, tests end at the next divider instead of Report().
   */
  harness: z.enum(['csbootcamp', 'jstrain']).optional(),
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
  /**
   * How the import gate re-executes the snippet (PRIVATE; absent = 'esm', the
   * BootForge grade-core path). 'script' = `node snippet.js` in a dir whose
   * package.json has no "type" — CommonJS with node's module-syntax detection,
   * i.e. exactly how jstrain2.2 captured its quiz answers (W3c: ESM changes
   * sloppy-mode `this`, nextTick-vs-promise order and `require`).
   */
  runAs: z.enum(['esm', 'script']).optional(),
  /**
   * PRIVATE import-gate cross-check: the upstream answer key's literal tokens,
   * which must appear IN ORDER in `expected` (jstrain quiz items whose captured
   * output contradicts their own key are never shipped as gradable).
   */
  keyTokens: z.array(z.string().min(1)).min(1).optional(),
});

export const GuidedStepCheck = z.object({
  type: z.literal('guided-step'),
  step: z.number().int().positive(),
  testFile: relPath,
  runner: z.enum(['node-test', 'vitest', 'dotnet-test']),
  timeoutMs: timeoutMs.default(60000),
});

/**
 * JSON-shape predicate (W3c) — a deliberately SMALL structural matcher, not a
 * JSON-schema engine. A shape is one of:
 *   "string" | "number" | "integer" | "boolean" | "null" | "object" | "array" | "any"
 *                                   type only
 *   { "equals": <string|number|boolean|null> }
 *                                   literal value (strict ===)
 *   { "object": { "<key>": <shape>, ... } }
 *                                   a non-null, non-array object that HAS every listed
 *                                   key (extra keys are allowed) whose values match
 *   { "array": <shape>, "minItems"?: n }
 *                                   an array (at least minItems long) whose EVERY item matches
 * Mismatches are reported with a JSONPath-ish location ("$.items[0].id").
 */
export const JSON_SHAPE_TYPES = ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array', 'any'] as const;
export type JsonShape =
  | (typeof JSON_SHAPE_TYPES)[number]
  | { equals: string | number | boolean | null }
  | { object: { [key: string]: JsonShape } }
  | { array: JsonShape; minItems?: number };
export const JsonShape: z.ZodType<JsonShape> = z.lazy(() =>
  z.union([
    z.enum(JSON_SHAPE_TYPES),
    z.object({ equals: z.union([z.string(), z.number(), z.boolean(), z.null()]) }).strict(),
    z.object({ object: z.record(z.string().min(1), JsonShape) }).strict(),
    z.object({ array: JsonShape, minItems: z.number().int().nonnegative().optional() }).strict(),
  ]),
);

/** Names are the learner-facing test names: unique within one check. */
function uniqueNames(what: string) {
  return (items: readonly { name: string }[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    items.forEach((it, i) => {
      if (seen.has(it.name)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate ${what} name "${it.name}"`, path: [i, 'name'] });
      seen.add(it.name);
    });
  };
}

const headerName = z.string().regex(/^[A-Za-z0-9-]{1,100}$/, 'header name');

export const HttpExpect = z
  .object({
    status: z.number().int().min(100).max(599),
    /**
     * Subset match: every listed header must be present (names case-insensitive).
     * A value matches when it equals the actual value, or the actual value's part
     * before the first ';' (so "application/json" matches "application/json; charset=utf-8").
     */
    headers: z.record(headerName, z.string()).optional(),
    /** structural predicate over the parsed JSON body (see JsonShape) */
    jsonShape: JsonShape.optional(),
  })
  .strict();

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

export const HttpRequestSpec = z
  .object({
    /** the named test this request becomes (public) */
    name: z.string().min(1).max(120),
    method: z.enum(HTTP_METHODS),
    /** origin-relative path (+ optional query); the server always targets 127.0.0.1/::1 */
    path: z
      .string()
      .max(2000)
      .regex(/^\/(?!\/)[^\s\\#]*$/, 'must be an origin-relative path like /api/tasks?x=1 (no //, no whitespace, no backslash, no fragment)'),
    /** request headers (Host is refused: the target is fixed to loopback) */
    headers: z
      .record(headerName, z.string().max(4000))
      .refine((h) => !Object.keys(h).some((k) => k.toLowerCase() === 'host'), { message: 'the Host header cannot be set' })
      .optional(),
    /** JSON body (sent with content-type application/json unless headers set one) */
    body: z.unknown().optional(),
    expect: HttpExpect,
  })
  .strict();

/**
 * HTTP check (spec §4): the SERVER sends each request, in order, to
 * http://127.0.0.1:<port> (falling back to [::1] when nothing listens on the
 * IPv4 loopback) — the learner supplies ONLY the port. No redirects are
 * followed, no retries. `port` here is a public HINT (the CLI's default).
 */
export const HttpCheck = z
  .object({
    type: z.literal('http'),
    port: z.number().int().min(1).max(65535).optional(),
    requests: z.array(HttpRequestSpec).min(1).max(50).superRefine(uniqueNames('request')),
    /** per-request timeout */
    timeoutMs: timeoutMs.default(5000),
    /** cap for the whole request script; requests after the cap fail unrun */
    totalTimeoutMs: timeoutMs.default(30000),
  })
  .strict();

/** A local branch name that is safe to pass to git as refs/heads/<name>. */
const branchName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/, 'branch name')
  .refine((b) => !b.includes('..') && !b.includes('//') && !b.endsWith('/') && !b.endsWith('.lock') && !b.endsWith('.'), {
    message: 'not a valid git branch name',
  });

const regexSource = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (p) => {
      try {
        new RegExp(p);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'must be a valid JavaScript regular expression' },
  );

const predName = z.string().min(1).max(120);

/**
 * Repo-check predicates (spec §4), evaluated IN ORDER against a LOCAL git repo
 * (read-only git plumbing via `git -C`, nothing in the repo is executed).
 * `name` is the public, learner-facing test name; the other fields are private.
 *   branch-exists          refs/heads/<branch> exists
 *   head-on-branch         HEAD is the symbolic ref refs/heads/<branch>
 *   file-exists-at-head    <path> is in the HEAD commit's tree (committed, not just on disk)
 *   clean-worktree         `git status --porcelain` is empty (incl. untracked files)
 *   min-commits            at least n commits reachable from <branch> (default HEAD)
 *   commit-message-matches the tip commit's full message (which:'tip', default) or ANY of
 *                          the newest 200 commits (which:'any') on <branch> matches pattern
 *   ci-green               REMOTE (gh CLI token): every check run on the GitHub commit
 *                          equal to the local <branch> tip (default HEAD) completed green
 *   pr-has-section         REMOTE (gh CLI token): the newest PR whose head is <branch>
 *                          (default: current branch) has a markdown heading <heading>
 *                          followed by non-empty text
 */
export const RepoPredicate = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('branch-exists'), name: predName, branch: branchName }).strict(),
  z.object({ kind: z.literal('head-on-branch'), name: predName, branch: branchName }).strict(),
  z.object({ kind: z.literal('file-exists-at-head'), name: predName, path: relPath }).strict(),
  z.object({ kind: z.literal('clean-worktree'), name: predName }).strict(),
  z.object({ kind: z.literal('min-commits'), name: predName, n: z.number().int().positive(), branch: branchName.optional() }).strict(),
  z
    .object({
      kind: z.literal('commit-message-matches'),
      name: predName,
      pattern: regexSource,
      flags: z.string().regex(/^[ims]{0,3}$/).optional(),
      which: z.enum(['tip', 'any']).default('tip'),
      branch: branchName.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('ci-green'), name: predName, branch: branchName.optional() }).strict(),
  z.object({ kind: z.literal('pr-has-section'), name: predName, heading: z.string().min(1).max(200), branch: branchName.optional() }).strict(),
]);
export type RepoPredicate = z.infer<typeof RepoPredicate>;
export const REPO_REMOTE_PREDICATES = ['ci-green', 'pr-has-section'] as const;

export const RepoCheck = z
  .object({
    type: z.literal('repo'),
    predicates: z.array(RepoPredicate).min(1).max(50).superRefine(uniqueNames('predicate')),
    /** per git / gh invocation */
    timeoutMs: timeoutMs.default(15000),
  })
  .strict();

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
  /**
   * U03 composite: repo-relative tsconfig (e.g. practice/tsconfig.json). When set,
   * the runner materializes the project's tsconfig chain (adapter pins it from the
   * tarball cache at `sha`) and runs the repo-pinned `tsc -p <this> --noEmit`
   * BEFORE `node --test`; type errors are structured '(tsc)' failures.
   */
  tscProject: relPath.optional(),
  /**
   * campaign 2 (OPS review, PRIVATE): repo-relative path -> sha256 of every tsconfig in the
   * tscProject extends chain at `sha`. When set, the adapter refuses a chain that differs.
   */
  tscFiles: z.record(relPath, sha256).optional(),
  timeoutMs: timeoutMs.default(30000),
  // W4: the pins the node-test-file runner needs (all PRIVATE: not in the public whitelist)
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/).optional(), // owner/name the check file is cached from
  blobSha: z.string().regex(/^[0-9a-f]{40}$/).optional(), // git blob sha of the check file at `sha`
  expectedTests: z.array(z.string().min(1)).min(1).optional(), // top-level test names a pass must report ok
  moduleType: z.enum(['module', 'commonjs']).optional(), // workspace package.json `type` (mirrors the repo)
});

/**
 * Frozen scaffolding of a self-run exercise (W3c): a learner-file section the
 * reference solution leaves untouched (fixtures, fake responses, the "provided"
 * implementations of write-the-test). The grader requires `body` verbatim in
 * the learner's code (compared with `//` comments and trailing blanks
 * stripped), so tampering with what the tests rely on is a structured failure.
 */
export const SelfRunFrozenBlock = z.object({ label: z.string().min(1), body: z.string().min(1) }).strict();

/** jstrain / csbootcamp self-testing files printing `#done passed= failed= todo=`. */
export const SelfRunCheck = z.object({
  type: z.literal('self-run'),
  language: z.enum(['js', 'ts', 'cs']),
  /** repo-relative path of the exercise file; the runner's workspace mirrors it */
  file: relPath,
  /** TS track: run real tsc first (esbuild drops type-assertion grading) */
  tsc: z.boolean().default(false),
  fixtures: z.array(relPath).default([]),
  /** module must FAIL by design (*-debug / *-hunts); mirrors check.inverted */
  inverted: z.boolean().default(false),
  timeoutMs: timeoutMs.default(30000),
  /**
   * PRIVATE grading bytes (W3c). `tests` = the exercise's protected block, from
   * its tests divider (`tests` / `runtime tests` / `meta-tests`) to EOF: the
   * graded program is learner head + THESE tests, never the learner's copy.
   * `fixtures` = file contents keyed by the paths listed in `fixtures`.
   * Optional so spec-only callers (schema tests) stay valid; the runner
   * refuses a spec without it.
   */
  files: z
    .object({
      tests: z.string().min(1),
      fixtures: z.record(relPath, z.string()).default({}),
      frozen: z.array(SelfRunFrozenBlock).default([]),
    })
    .strict()
    .optional(),
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
