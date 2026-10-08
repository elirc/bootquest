/**
 * `node-test-file` check runner (BootQuest W1.5 / P3 spike).
 *
 * Runs an upstream, read-only `node:test` contract file (e.g. signalpost
 * `practice/checks/u01.test.mjs`) against a learner submission:
 *
 *  1. The check file is pinned by {repo, sha, path} and its bytes are verified
 *     against the stored sha256 (and git blob sha, when recorded) BEFORE every
 *     run. Any mismatch throws CheckIntegrityError — the caller must refuse and
 *     record nothing.
 *  2. A fresh temp workspace mirrors the source repo layout (checks import
 *     `../learner/uNN.mjs` by relative path), so the check is copied to
 *     `spec.path` and the submission written to `spec.learner_path`.
 *  3. `process.execPath --test --test-reporter=tap <check>` is spawned with no
 *     shell (plus `--import <tsx loader URL>` resolved from BootQuest's own
 *     node_modules when `needs_tsx`). Wall-clock timeout kills the whole tree
 *     (`taskkill /T /F` on Windows, process-group SIGKILL elsewhere).
 *  4. TAP output is parsed into the canonical runner result.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Shape of `check.spec` JSON for `check.type = 'node-test-file'`. */
export interface NodeTestFileSpec {
  /** GitHub `owner/name`, case-sensitive exact. */
  repo: string;
  /** Pinned commit sha the check file was recorded at. */
  sha: string;
  /** Repo-relative POSIX path of the check file, e.g. `practice/checks/u01.test.mjs`. */
  path: string;
  /** sha256 (hex) of the exact check-file bytes at `sha`. Verified before every run. */
  sha256: string;
  /** Optional git blob sha (from the GitHub tree at `sha`); verified when present. */
  blob_sha?: string;
  /** Repo-relative POSIX path the submission is materialized at, e.g. `practice/learner/u01.mjs`. */
  learner_path: string;
  /** true ⇒ spawn with `--import tsx` (resolved from BootQuest's node_modules). */
  needs_tsx: boolean;
  /** Wall-clock timeout for the whole `node --test` tree. Default 30 000. */
  timeout_ms?: number;
  /** `type` field of the workspace-root package.json (mirrors the source repo). Default "module". */
  module_type?: "module" | "commonjs";
  /**
   * Top-level test names the check declares (recorded at seed time from a reference run).
   * When present, a pass requires every one of them reported `ok`. Strongly recommended:
   * without it, a submission that calls `process.exit(0)` at import makes node report a
   * single synthetic file-level "ok" — the runner also rejects that shape, but the list is
   * the positive proof that the contract's tests actually executed.
   */
  expected_tests?: string[];
  /** Upstream starter the learner begins from (not needed to run; used by seed/UI). */
  starter?: { path: string; blob_sha?: string; sha256: string };
}

export interface NodeTestFileExercise {
  id: string;
  spec: NodeTestFileSpec;
  /** Local path of the cached check-file bytes (per-SHA cache in W4; fixture dir in tests). */
  checkFile: string;
}

export interface Submission {
  /** Full source of the learner module written at `spec.learner_path`. */
  code: string;
}

export interface RunnerFailure {
  name: string;
  message: string;
  expected?: string;
  actual?: string;
}

/** Canonical runner result (docs/BUILD-PLAN.md). */
export interface RunnerResult {
  pass: boolean;
  output: string;
  failures: RunnerFailure[];
  durationMs: number;
}

export class CheckIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckIntegrityError";
  }
}

export interface RunOptions {
  /** Override the tsx loader (tests). Default: resolved from BootQuest's own node_modules. */
  tsxLoaderUrl?: string;
  /** Called with the spawned top-level pid (tests use it to prove the tree was reaped). */
  onSpawn?: (pid: number) => void;
  /** Parent dir of the per-run `bq-ntf-*` workspace (default os.tmpdir()). */
  workRoot?: string;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 64 * 1024;

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function gitBlobSha(bytes: Buffer): string {
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest("hex");
}

/** Reads the cached check file and verifies it against the pinned hashes. Throws on tamper. */
export async function loadVerifiedCheck(exercise: NodeTestFileExercise): Promise<Buffer> {
  const { spec } = exercise;
  let bytes: Buffer;
  try {
    bytes = await readFile(exercise.checkFile);
  } catch (err) {
    throw new CheckIntegrityError(
      `check file for ${spec.repo}@${spec.sha}:${spec.path} is missing from the cache (${String(err)})`,
    );
  }
  const actual = sha256Hex(bytes);
  if (actual !== spec.sha256.toLowerCase()) {
    throw new CheckIntegrityError(
      `refusing to run: ${spec.repo}@${spec.sha}:${spec.path} sha256 ${actual} != pinned ${spec.sha256}`,
    );
  }
  if (spec.blob_sha !== undefined && gitBlobSha(bytes) !== spec.blob_sha.toLowerCase()) {
    throw new CheckIntegrityError(
      `refusing to run: ${spec.repo}@${spec.sha}:${spec.path} git blob sha mismatch (pinned ${spec.blob_sha})`,
    );
  }
  return bytes;
}

/** Validates a repo-relative POSIX path and resolves it inside `root`. */
function resolveInside(root: string, rel: string, what: string): string {
  if (rel.length === 0 || rel.includes("\\") || rel.includes("\0") || path.posix.isAbsolute(rel)) {
    throw new CheckIntegrityError(`invalid ${what} path: ${JSON.stringify(rel)}`);
  }
  const norm = path.posix.normalize(rel);
  if (norm !== rel || norm.split("/").includes("..")) {
    throw new CheckIntegrityError(`invalid ${what} path: ${JSON.stringify(rel)}`);
  }
  const abs = path.resolve(root, ...norm.split("/"));
  if (!abs.startsWith(root + path.sep)) {
    throw new CheckIntegrityError(`${what} path escapes the workspace: ${JSON.stringify(rel)}`);
  }
  return abs;
}

// ---------------------------------------------------------------------------
// tsx resolution (from BootQuest's own node_modules, never the learner's)
// ---------------------------------------------------------------------------

let cachedTsxUrl: string | undefined;
export function resolveTsxLoaderUrl(): string {
  if (cachedTsxUrl === undefined) {
    const require = createRequire(import.meta.url);
    // tsx's "." export is ./dist/loader.mjs (the `--import tsx` entry point).
    cachedTsxUrl = pathToFileURL(require.resolve("tsx")).href;
  }
  return cachedTsxUrl;
}

// ---------------------------------------------------------------------------
// Process tree kill
// ---------------------------------------------------------------------------

function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const k = spawn("taskkill", ["/T", "/F", "/PID", String(pid)], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      k.on("error", () => resolve());
      k.on("close", () => resolve());
    } else {
      try {
        process.kill(-pid, "SIGKILL"); // detached ⇒ own process group
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// TAP parsing (node:test `--test-reporter=tap`, node 22)
// ---------------------------------------------------------------------------

export interface TapSummary {
  tests: number;
  pass: number;
  fail: number;
  cancelled: number;
  skipped: number;
  todo: number;
}

export interface ParsedTap {
  summary: TapSummary | null;
  failures: RunnerFailure[];
  /** Every test point (any depth), full " > "-joined name and whether it was ok. */
  points: { name: string; ok: boolean; depth: number }[];
}

function unescapeTapName(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

function parseYamlScalar(raw: string): string {
  const v = raw.trim();
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}

/** Parses the YAML diagnostic block node emits under a test point (top-level keys only). */
function parseYamlBlock(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (lines.length === 0) return out;
  const indentOf = (l: string) => l.length - l.trimStart().length;
  const base = Math.min(...lines.filter((l) => l.trim() !== "").map(indentOf));
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = indentOf(line) === base ? /^\s*([A-Za-z_][\w]*):(?: (.*))?$/.exec(line) : null;
    i++;
    if (!m) continue;
    const key = m[1]!;
    const rest = m[2] ?? "";
    // Collect any more-indented continuation lines (block scalars or nested maps).
    const cont: string[] = [];
    while (i < lines.length && (lines[i]!.trim() === "" || indentOf(lines[i]!) > base)) {
      cont.push(lines[i]!);
      i++;
    }
    while (cont.length > 0 && cont[cont.length - 1]!.trim() === "") cont.pop();
    if (/^[|>][-+]?$/.test(rest.trim()) || (rest.trim() === "" && cont.length > 0)) {
      const ci = Math.min(...cont.filter((l) => l.trim() !== "").map(indentOf));
      out[key] = cont.map((l) => l.slice(Math.min(ci, indentOf(l)))).join("\n").replace(/\s+$/, "");
    } else {
      out[key] = parseYamlScalar(rest);
    }
  }
  return out;
}

export function parseTap(stdout: string): ParsedTap {
  const lines = stdout.split(/\r?\n/);
  const failures: RunnerFailure[] = [];
  const points: ParsedTap["points"] = [];
  const subtestStack: string[] = [];
  const counts: Partial<Record<keyof TapSummary, number>> = {};
  let sawSummary = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const sub = /^(\s*)# Subtest: (.*)$/.exec(line);
    if (sub) {
      const depth = Math.floor(sub[1]!.length / 4);
      subtestStack.length = depth;
      subtestStack[depth] = unescapeTapName(sub[2]!);
      continue;
    }
    const point = /^(\s*)(not ok|ok) \d+ - (.*?)(?: # (?:SKIP|TODO)\b.*)?$/.exec(line);
    if (point) {
      const depth = Math.floor(point[1]!.length / 4);
      const name = [...subtestStack.slice(0, depth), unescapeTapName(point[3]!)].join(" > ");
      subtestStack.length = depth;
      points.push({ name, ok: point[2] === "ok", depth });
      // Gather the YAML block, if any.
      let yaml: Record<string, string> = {};
      if (i + 1 < lines.length && /^\s*---$/.test(lines[i + 1]!)) {
        const block: string[] = [];
        let j = i + 2;
        while (j < lines.length && !/^\s*\.\.\.$/.test(lines[j]!)) block.push(lines[j++]!);
        yaml = parseYamlBlock(block);
        i = j;
      }
      if (point[2] === "not ok" && yaml.failureType !== "subtestsFailed" && !/ # TODO\b/.test(line)) {
        const f: RunnerFailure = { name, message: yaml.error ?? yaml.failureType ?? "failed" };
        if (yaml.expected !== undefined) f.expected = yaml.expected;
        if (yaml.actual !== undefined) f.actual = yaml.actual;
        failures.push(f);
      }
      continue;
    }
    // Only top-level (unindented) summary lines count.
    const s = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (s) {
      counts[s[1] as keyof TapSummary] = Number(s[2]);
      if (s[1] === "tests") sawSummary = true;
    }
  }
  const summary: TapSummary | null = sawSummary
    ? {
        tests: counts.tests ?? 0,
        pass: counts.pass ?? 0,
        fail: counts.fail ?? 0,
        cancelled: counts.cancelled ?? 0,
        skipped: counts.skipped ?? 0,
        todo: counts.todo ?? 0,
      }
    : null;
  return { summary, failures, points };
}

// ---------------------------------------------------------------------------
// run()
// ---------------------------------------------------------------------------

function tail(s: string): string {
  return s.length > OUTPUT_LIMIT ? `…[truncated ${s.length - OUTPUT_LIMIT} chars]\n${s.slice(-OUTPUT_LIMIT)}` : s;
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Never inherit flags/loaders or a parent node:test context (would switch the child to the
  // internal serialized protocol instead of TAP), nor vitest worker markers.
  for (const k of Object.keys(env)) {
    if (k === "NODE_OPTIONS" || k === "NODE_TEST_CONTEXT" || k.startsWith("VITEST") || k === "TSX_TSCONFIG_PATH") {
      delete env[k];
    }
  }
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  return env;
}

export async function run(
  exercise: NodeTestFileExercise,
  submission: Submission,
  options: RunOptions = {},
): Promise<RunnerResult> {
  const { spec } = exercise;
  const started = performance.now();
  // 1. Integrity first — tamper ⇒ throw, nothing is executed.
  const checkBytes = await loadVerifiedCheck(exercise);
  if (spec.learner_path === spec.path) throw new CheckIntegrityError("learner_path must differ from the check path");

  const root = await mkdtemp(path.join(options.workRoot ?? tmpdir(), "bq-ntf-"));
  try {
    // 2. Mirror the source layout; check copied fresh every run and made read-only.
    const checkAbs = resolveInside(root, spec.path, "check");
    const learnerAbs = resolveInside(root, spec.learner_path, "learner");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: spec.module_type ?? "module", private: true }));
    await mkdir(path.dirname(checkAbs), { recursive: true });
    await mkdir(path.dirname(learnerAbs), { recursive: true });
    await writeFile(checkAbs, checkBytes);
    await chmod(checkAbs, 0o444);
    await writeFile(learnerAbs, submission.code, "utf8");

    // 3. Spawn node --test (no shell).
    const args: string[] = [];
    if (spec.needs_tsx) args.push("--import", options.tsxLoaderUrl ?? resolveTsxLoaderUrl());
    args.push("--test", "--test-reporter=tap", "--test-reporter-destination=stdout", spec.path);

    const timeoutMs = spec.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const { stdout, stderr, code, signal, timedOut } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
    }>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: root,
        env: childEnv(),
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (child.pid !== undefined) options.onSpawn?.(child.pid);
      let out = "";
      let err = "";
      let timedOut = false;
      child.stdout.setEncoding("utf8").on("data", (d: string) => {
        out += d;
        if (out.length > 4 * OUTPUT_LIMIT) out = out.slice(-2 * OUTPUT_LIMIT);
      });
      child.stderr.setEncoding("utf8").on("data", (d: string) => {
        err += d;
        if (err.length > 4 * OUTPUT_LIMIT) err = err.slice(-2 * OUTPUT_LIMIT);
      });
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) void killTree(child.pid);
      }, timeoutMs);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({ stdout: out, stderr: err, code, signal, timedOut });
      });
    });

    // 4. Post-run: the check copy must be byte-identical (defense in depth).
    const after = await readFile(checkAbs).catch(() => Buffer.alloc(0));
    const checkTampered = sha256Hex(after) !== spec.sha256.toLowerCase();

    const parsed = parseTap(stdout);
    const failures = [...parsed.failures];
    const s = parsed.summary;
    if (timedOut) failures.push({ name: "timeout", message: `check exceeded ${timeoutMs} ms; process tree killed` });
    if (checkTampered) failures.push({ name: "integrity", message: "check file was modified during the run" });
    if (!timedOut && s === null) {
      failures.push({
        name: "runner",
        message: `node --test produced no TAP summary (exit ${code ?? signal ?? "?"})`,
      });
    } else if (!timedOut && s !== null && s.tests === 0) {
      failures.push({ name: "runner", message: "no tests ran" });
    } else if (!timedOut && s !== null && s.fail > 0 && parsed.failures.length === 0) {
      failures.push({ name: "runner", message: `${s.fail} test(s) failed (unparsed)` });
    }
    if (!timedOut && s !== null) {
      // node reports a file whose process ran no tests (e.g. learner `process.exit(0)` at import)
      // as one synthetic test named after the file path. That is never a contract pass.
      const fileNames = new Set([spec.path, spec.path.replaceAll("/", "\\")]);
      if (parsed.points.some((p) => p.depth === 0 && fileNames.has(p.name))) {
        failures.push({
          name: "runner",
          message: "check file reported no individual test results (did the submission exit the process early?)",
        });
      }
      if (spec.expected_tests !== undefined) {
        const okTop = new Set(parsed.points.filter((p) => p.depth === 0 && p.ok).map((p) => p.name));
        const seenTop = new Set(parsed.points.filter((p) => p.depth === 0).map((p) => p.name));
        for (const t of spec.expected_tests) {
          if (!seenTop.has(t)) failures.push({ name: t, message: "expected test did not run" });
          else if (!okTop.has(t) && !failures.some((f) => f.name === t || f.name.startsWith(`${t} > `))) {
            failures.push({ name: t, message: "expected test did not pass" });
          }
        }
      }
    }
    const pass =
      !timedOut &&
      !checkTampered &&
      code === 0 &&
      s !== null &&
      s.tests > 0 &&
      s.fail === 0 &&
      s.cancelled === 0 &&
      s.pass + s.skipped + s.todo === s.tests &&
      s.pass > 0 &&
      failures.length === 0;

    let output = stdout + (stderr ? `\n--- stderr ---\n${stderr}` : "");
    for (const form of [pathToFileURL(root).href, root.replaceAll("\\", "\\\\"), root]) {
      output = output.split(form).join("<workspace>");
    }
    output = tail(output);
    return { pass, output, failures, durationMs: Math.round(performance.now() - started) };
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
