// Core code-grading harness, shared by the live server and the content validator.
// Runs learner code in a separate `node` process with a hard timeout.
//
// Verdict channel (Java parity, see server/src/runners/result-channel.ts): the grader
// writes a fresh random nonce to `nonce` in the attempt dir; the runner reads it and
// DELETES the file before the learner module is imported, then, after the last test,
// writes ONE line
//     #bq-result <nonce> <json [{name, pass, message?, input?, expected?, actual?, operator?}]>
// to file descriptor 3, a pipe only the grader reads. The verdict comes only from
// that line: exactly one line, this attempt's nonce, one result per test in order
// (or the single load failure). There is no result file a learner `process.on('exit')`
// handler could rewrite, and stdout is display only. The runner captures every
// primitive it relies on (fs.writeSync, JSON.stringify, String, util.inspect,
// Reflect.apply, AsyncFunction) before learner code loads, builds the result line from
// primitives only, and freezes the `assert` it hands to the tests, so learner code
// cannot patch the grading path either.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import esbuild from 'esbuild';

const TIMEOUT_MS = 8000;
const MAX_BUFFER = 1024 * 1024;
// Silences node:sqlite's ExperimentalWarning (Node 22) so it never reaches learners or AUTO capture.
const CHILD_FLAGS = ['--disable-warning=ExperimentalWarning'];

const RUNNER = `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspect } from 'node:util';
// ── captured before any learner code exists ──
const { readFileSync, unlinkSync, writeSync } = fs;
const stringify = JSON.stringify;
const Str = String;
const apply = Reflect.apply;
const slice = String.prototype.slice;
const hasOwn = Object.prototype.hasOwnProperty;
const AsyncFunction = (async () => {}).constructor;
const nonceUrl = new URL('./nonce', import.meta.url);
const NONCE = readFileSync(nonceUrl, 'utf8').trim();
unlinkSync(nonceUrl);
const tests = JSON.parse(readFileSync(new URL('./tests.json', import.meta.url), 'utf8'));
const count = tests.length;
// the tests' assert and the promises the runner awaits cannot be patched by learner code
Object.freeze(assert);
Object.freeze(Promise.prototype);
Object.freeze(Promise);
const cut = (s, n) => apply(slice, Str(s), [0, n]);
const describe = (value) => cut(inspect(value, { depth: 5, maxArrayLength: 30, maxStringLength: 1500, customInspect: false, breakLength: 80 }), 4000);
// results as one JSON string, built from primitives only (no learner-patchable prototype is consulted)
let out = '';
const record = (fields) => {
  let entry = '';
  for (let i = 0; i < fields.length; i += 2) {
    if (fields[i + 1] === undefined) continue;
    entry += (entry === '' ? '' : ',') + stringify(fields[i]) + ':' + (typeof fields[i + 1] === 'boolean' ? (fields[i + 1] ? 'true' : 'false') : stringify(Str(fields[i + 1])));
  }
  out += (out === '' ? '' : ',') + '{' + entry + '}';
};
const finish = () => writeSync(3, '#bq-result ' + NONCE + ' [' + out + ']\\n');
const main = async () => {
  let mod;
  try {
    // Keep the actual namespace: wrapping exports changes function/object identity.
    // Input diagnostics come from author-supplied case metadata instead.
    mod = await import('./solution.mjs');
  } catch (err) {
    record(['name', 'code loads without errors', 'pass', false, 'message', Str(err?.message ?? err)]);
    finish();
    return;
  }
  // an index loop over own data properties: no learner-patchable iterator is consulted
  for (let i = 0; i < count; i++) {
    const t = tests[i];
    try {
      const fn = new AsyncFunction('mod', 'assert', t.code);
      await fn(mod, assert);
      record(['name', t.name, 'pass', true]);
    } catch (err) {
      const diff = err !== null && typeof err === 'object' && apply(hasOwn, err, ['expected']);
      record([
        'name', t.name, 'pass', false, 'message', cut(err?.message ?? err, 2000),
        'input', t.input !== undefined ? describe(t.input) : undefined,
        'expected', diff ? describe(err.expected) : undefined,
        'actual', diff ? describe(err.actual) : undefined,
        'operator', diff && err.operator !== undefined ? Str(err.operator) : undefined,
      ]);
    }
  }
  finish();
};
await main();
`;

/**
 * Check the runner's fd-3 channel text: exactly one `#bq-result <nonce> <json>` line with
 * this attempt's nonce, and one well-formed result per test in order (or the single load
 * failure). Returns the results, or null when the channel is not a valid verdict.
 */
export function parseChannel(text, nonce, tests) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l !== '');
  if (lines.length !== 1) return null;
  const m = /^#bq-result (\S+) (\[.*\])$/.exec(lines[0]);
  if (!m || m[1] !== nonce) return null;
  let results;
  try {
    results = JSON.parse(m[2]);
  } catch {
    return null;
  }
  const loadFailure = results?.length === 1 && results[0].name === 'code loads without errors' && results[0].pass === false;
  const valid = Array.isArray(results) && results.length > 0 && results.every((r) => typeof r?.name === 'string' && typeof r.pass === 'boolean') &&
    (loadFailure || (results.length === tests.length && results.every((r, i) => r.name === tests[i].name)));
  return valid ? results : null;
}

/**
 * @param {string} code learner code (js or ts)
 * @param {'js'|'ts'} language
 * @param {{name: string, code: string, input?: unknown}[]} tests
 * @returns {Promise<{pass: boolean, results: {name: string, pass: boolean, message?: string, input?: string, expected?: string, actual?: string, operator?: string}[], stdout?:string, stderr?:string}>}
 */
export async function gradeCode(code, language, tests) {
  let jsCode = code;
  if (language === 'ts') {
    try {
      const out = await esbuild.transform(code, { loader: 'ts', format: 'esm' });
      jsCode = out.code;
    } catch (err) {
      return {
        pass: false,
        results: [
          {
            name: 'TypeScript compiles',
            pass: false,
            message: String(err?.message ?? err).slice(0, 500),
          },
        ],
      };
    }
  }

  // a fresh dir per grade: nothing a previous attempt wrote can reach this one
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootforge-'));
  try {
    const nonce = randomBytes(24).toString('base64url');
    fs.writeFileSync(path.join(dir, 'solution.mjs'), jsCode);
    fs.writeFileSync(path.join(dir, 'tests.json'), JSON.stringify(tests));
    fs.writeFileSync(path.join(dir, 'runner.mjs'), RUNNER);
    fs.writeFileSync(path.join(dir, 'nonce'), nonce);
    const { stdout, stderr, channel, timedOut, exitCode, error } = await runGraded(process.execPath, [...CHILD_FLAGS, 'runner.mjs'], dir);
    if (timedOut) {
      return {
        pass: false,
        stdout, stderr,
        results: [
          { name: 'finishes in time', pass: false, message: `Timed out after ${TIMEOUT_MS / 1000}s — infinite loop?` },
        ],
      };
    }
    // the exit code never makes a pass; a non-zero one (or no channel line at all) is a crash
    if (channel === '' || exitCode !== 0) {
      return {
        pass: false,
        stdout, stderr,
        results: [
          {
            name: 'code runs',
            pass: false,
            message: (stderr || error || `Process exited with code ${exitCode} before grading finished.`).slice(0, 2000),
          },
        ],
      };
    }
    const results = parseChannel(channel, nonce, tests);
    if (!results) {
      return { pass: false, results: [{ name: 'grader results', pass: false, message: 'The runner did not produce valid results. Please run your code and retry.' }], stdout, stderr };
    }
    return { pass: results.every((r) => r.pass), results, stdout, stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Spawn the graded runner with a 4th stdio pipe (fd 3: the result channel) and the same
 * limits as `run`: TIMEOUT_MS (then killed) and MAX_BUFFER per stream (then killed).
 * @returns {Promise<{stdout: string, stderr: string, channel: string, timedOut: boolean, exitCode: number|null, error?: string}>}
 */
function runGraded(cmd, args, cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    } catch {
      resolve({ stdout: '', stderr: 'failed to spawn node', channel: '', timedOut: false, exitCode: null });
      return;
    }
    const chunks = { stdout: [], stderr: [], channel: [] };
    const sizes = { stdout: 0, stderr: 0, channel: 0 };
    let timedOut = false;
    let error;
    let settled = false;
    const kill = () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    };
    const collect = (key, stream) =>
      stream?.on('data', (buf) => {
        sizes[key] += buf.length;
        if (sizes[key] > MAX_BUFFER) {
          error ??= `${key} maxBuffer length exceeded`;
          kill();
          return;
        }
        chunks[key].push(buf);
      });
    collect('stdout', child.stdout);
    collect('stderr', child.stderr);
    collect('channel', child.stdio[3]);
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, TIMEOUT_MS);
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: '', stderr: 'failed to spawn node', channel: '', timedOut: false, exitCode: null });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = (key) => Buffer.concat(chunks[key]).toString('utf8');
      resolve({
        stdout: text('stdout'),
        stderr: text('stderr'),
        channel: error ? '' : text('channel'),
        timedOut: timedOut && !error,
        exitCode: error || timedOut ? null : code,
        error: error ?? (code !== 0 && !timedOut ? `Command failed: ${[cmd, ...args].join(' ')}` : undefined),
      });
    });
  });
}

/**
 * Run a code snippet and capture stdout (for output-prediction authoring/validation).
 * @returns {Promise<{stdout: string, stderr: string, timedOut: boolean, exitCode: number|null, error?: string}>}
 */
export async function runSnippet(code, language = 'js') {
  let jsCode = code;
  if (language === 'ts') {
    const out = await esbuild.transform(code, { loader: 'ts', format: 'esm' });
    jsCode = out.code;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootforge-'));
  try {
    fs.writeFileSync(path.join(dir, 'snippet.mjs'), jsCode);
    return await run(process.execPath, [...CHILD_FLAGS, 'snippet.mjs'], dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { cwd, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          timedOut: Boolean(err && err.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && (err.killed || err.signal === 'SIGTERM')),
          exitCode: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          error: err ? String(err.message).slice(0, 2000) : undefined,
        });
      }
    );
    child.on('error', () => resolve({ stdout: '', stderr: 'failed to spawn node', timedOut: false, exitCode: null }));
  });
}

/** Normalize output for comparison: CRLF -> LF, trim trailing whitespace per line and at ends. */
export function normalizeOutput(s) {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

export const _internal = { TIMEOUT_MS, CHILD_FLAGS };
