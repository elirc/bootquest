// Core code-grading harness, shared by the live server and the content validator.
// Runs learner code in a separate `node` process with a hard timeout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import esbuild from 'esbuild';

const TIMEOUT_MS = 8000;
// Silences node:sqlite's ExperimentalWarning (Node 22) so it never reaches learners or AUTO capture.
const CHILD_FLAGS = ['--disable-warning=ExperimentalWarning'];

const RUNNER = `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inspect } from 'node:util';
const tests = JSON.parse(fs.readFileSync(new URL('./tests.json', import.meta.url), 'utf8'));
let mod;
const results = [];
const describe = (value) => inspect(value, { depth: 5, maxArrayLength: 30, maxStringLength: 1500, customInspect: false, breakLength: 80 }).slice(0, 4000);
const finish = () => fs.writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results));
try {
  // Keep the actual namespace: wrapping exports changes function/object identity.
  // Input diagnostics come from author-supplied case metadata instead.
  mod = await import('./solution.mjs');
} catch (err) {
  results.push({ name: 'code loads without errors', pass: false, message: String(err?.message ?? err) });
  finish();
  process.exit(0);
}
const AsyncFunction = (async () => {}).constructor;
for (const t of tests) {
  try {
    const fn = new AsyncFunction('mod', 'assert', t.code);
    await fn(mod, assert);
    results.push({ name: t.name, pass: true });
  } catch (err) {
    results.push({
      name: t.name, pass: false, message: String(err?.message ?? err).slice(0, 2000),
      input: t.input !== undefined ? describe(t.input) : undefined,
      ...((err && typeof err === 'object' && 'expected' in err) ? { expected: describe(err.expected), actual: describe(err.actual), operator: err.operator } : {}),
    });
  }
}
finish();
`;

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

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootforge-'));
  try {
    fs.writeFileSync(path.join(dir, 'solution.mjs'), jsCode);
    fs.writeFileSync(path.join(dir, 'tests.json'), JSON.stringify(tests));
    fs.writeFileSync(path.join(dir, 'runner.mjs'), RUNNER);
    const { stdout, stderr, timedOut, exitCode, error } = await run(process.execPath, [...CHILD_FLAGS, 'runner.mjs'], dir);
    if (timedOut) {
      return {
        pass: false,
        stdout, stderr,
        results: [
          { name: 'finishes in time', pass: false, message: `Timed out after ${TIMEOUT_MS / 1000}s — infinite loop?` },
        ],
      };
    }
    const resultPath = path.join(dir, 'results.json');
    if (!fs.existsSync(resultPath) || exitCode !== 0) {
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
    try {
      const results = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      const loadFailure = results?.length === 1 && results[0].name === 'code loads without errors' && results[0].pass === false;
      const valid = Array.isArray(results) && results.length > 0 && results.every(r => typeof r?.name === 'string' && typeof r.pass === 'boolean') &&
        (loadFailure || (results.length === tests.length && results.every((r, i) => r.name === tests[i].name)));
      if (!valid) throw new Error('Incomplete or invalid test results');
      return { pass: results.every((r) => r.pass), results, stdout, stderr };
    } catch {
      return { pass: false, results: [{ name: 'grader results', pass: false, message: 'The runner did not produce valid results. Please run your code and retry.' }], stdout, stderr };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
