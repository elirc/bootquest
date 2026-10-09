// bq-check.mjs — BootQuest's runner-owned copy of jstrain2.2's test harness
// (fixtures/jstrain/bootcamp/_lib/check.js, kept byte-for-byte as the
// reference). Test SEMANTICS are identical to upstream: test / eq / ok /
// throws / rejects / approx / spy / sleep, `new Error('TODO')` = todo,
// 5s per-test timeout, tests run sequentially, the same human-readable lines
// and the same `#done passed= failed= todo=` summary.
//
// What BootQuest adds (W3c forgery defense) — an AUTHENTICATED result channel:
//   * The self-run runner preloads this module with `node --import <this>`,
//     so it evaluates BEFORE any learner code. At that moment it
//       - reads a one-time nonce from the file named by BQ_SELFRUN_NONCE_FILE,
//         deletes the file and the env var (learner code can't read either),
//       - captures fs.writeSync, util.isDeepStrictEqual / inspect, Promise.race
//         and the timer functions into private consts (later monkeypatching of
//         node:fs / node:util / Promise does not reach them).
//   * At beforeExit — and ONLY once every registered test has settled — it
//     writes ONE line `#bq-result <nonce> <base64 json>` to fd 3 (a pipe only
//     the runner reads) with the counts and per-test records.
//   The upstream `#done` line on stdout is kept for humans and is IGNORED by
//   the runner: printing a fake `#done passed=9 failed=0 todo=0` gains nothing.
// Run directly (no nonce file), this module behaves exactly like upstream.

import fs from 'node:fs';
import util from 'node:util';

const writeSync = fs.writeSync;
const readFileSync = fs.readFileSync;
const unlinkSync = fs.unlinkSync;
const isDeepStrictEqual = util.isDeepStrictEqual;
const inspect = util.inspect;
const race = Promise.race.bind(Promise);
const resolved = Promise.resolve.bind(Promise);
const setTimer = setTimeout;
const clearTimer = clearTimeout;
const stringify = JSON.stringify;
const toBase64 = (s) => Buffer.from(s, 'utf8').toString('base64');

let nonce = null;
{
  const nonceFile = process.env.BQ_SELFRUN_NONCE_FILE;
  delete process.env.BQ_SELFRUN_NONCE_FILE;
  if (nonceFile) {
    try {
      nonce = readFileSync(nonceFile, 'utf8').trim();
    } catch {
      nonce = null;
    }
    try {
      unlinkSync(nonceFile);
    } catch {
      /* already gone */
    }
    if (nonce !== null && !/^[0-9a-f]{32}$/.test(nonce)) nonce = null;
  }
}

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => c('32', s);
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);
const dim = (s) => c('2', s);
const bold = (s) => c('1', s);

const show = (v) =>
  inspect(v, { depth: 6, colors: false, compact: true, breakLength: 60 });

class CheckFailure extends Error {
  constructor(message, actual, expected, hasDiff) {
    super(message);
    this.name = 'CheckFailure';
    this.actual = actual;
    this.expected = expected;
    this.hasDiff = hasDiff;
  }
}

export function eq(actual, expected, message = 'values differ') {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new CheckFailure(message, actual, expected, true);
  }
}

export function ok(value, message = 'expected a truthy value') {
  if (!value) throw new CheckFailure(`${message} (got ${show(value)})`);
}

export function throws(fn, match, message = 'expected function to throw') {
  let threw = false;
  let error;
  try {
    fn();
  } catch (e) {
    if (isTodo(e)) throw e; // unimplemented code isn't a real throw
    threw = true;
    error = e;
  }
  if (!threw) throw new CheckFailure(message);
  matchError(error, match);
}

export async function rejects(fnOrPromise, match, message = 'expected a rejection') {
  let rejected = false;
  let error;
  try {
    await (typeof fnOrPromise === 'function' ? fnOrPromise() : fnOrPromise);
  } catch (e) {
    if (isTodo(e)) throw e; // unimplemented code isn't a real rejection
    rejected = true;
    error = e;
  }
  if (!rejected) throw new CheckFailure(message);
  matchError(error, match);
}

function matchError(error, match) {
  if (match === undefined) return;
  if (typeof match === 'function') {
    // an Error class: the thrown value must be an instance of it
    if (!(error instanceof match)) {
      throw new CheckFailure(
        'threw, but the wrong error class',
        error?.constructor?.name ?? typeof error,
        match.name,
        true
      );
    }
    return;
  }
  const text = error instanceof Error ? error.message : String(error);
  const hit =
    match instanceof RegExp ? match.test(text) : text.includes(String(match));
  if (!hit) {
    throw new CheckFailure(
      `threw, but the message was wrong`,
      text,
      match instanceof RegExp ? String(match) : match,
      true
    );
  }
}

export function approx(actual, expected, eps = 1e-9, message = 'numbers differ') {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > eps) {
    throw new CheckFailure(message, actual, expected, true);
  }
}

export function spy(impl) {
  const s = (...args) => {
    s.calls.push(args);
    s.callCount += 1;
    const result = impl ? impl(...args) : undefined;
    s.returns.push(result);
    return result;
  };
  s.calls = [];
  s.returns = [];
  s.callCount = 0;
  return s;
}

// upstream semantics: the GLOBAL setTimeout at call time (fake-timer exercises may swap it)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── runner ────────────────────────────────────────────────────────────────

let queue = resolved();
let passed = 0;
let failed = 0;
let todo = 0;
let registered = 0;
let settled = 0;
let reported = false;
const records = [];
const TIMEOUT_MS = 5000;

const isTodo = (e) =>
  e instanceof Error && /^TODO\b/.test(e.message);

const clip = (s, n = 2000) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function test(name, fn) {
  registered += 1;
  const label = String(name);
  queue = queue.then(async () => {
    try {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimer(
          () => reject(new Error(`timed out after ${TIMEOUT_MS / 1000}s`)),
          TIMEOUT_MS
        );
        timer.unref?.();
      });
      try {
        await race([resolved().then(fn), timeout]);
      } finally {
        clearTimer(timer);
      }
      passed += 1;
      records.push({ name: label, status: 'pass' });
      console.log(`  ${green('✔')} ${label}`);
    } catch (e) {
      if (isTodo(e)) {
        todo += 1;
        records.push({ name: label, status: 'todo' });
        console.log(`  ${yellow('☐')} ${dim(label)} ${yellow('· todo')}`);
      } else {
        failed += 1;
        records.push(failureRecord(label, e));
        console.log(`  ${red('✘')} ${bold(label)}`);
        printFailure(e);
      }
    } finally {
      settled += 1;
    }
  });
  return queue;
}

function failureRecord(name, e) {
  const r = { name, status: 'fail', message: '' };
  try {
    if (e instanceof CheckFailure) {
      r.message = clip(e.message);
      if (e.hasDiff) {
        r.expected = clip(show(e.expected));
        r.actual = clip(show(e.actual));
      }
    } else if (e instanceof Error) {
      r.message = clip(`${e.name}: ${e.message}`);
    } else {
      r.message = clip(`threw a non-Error value: ${show(e)}`);
    }
  } catch {
    r.message = 'failed (the thrown value could not be described)';
  }
  return r;
}

function printFailure(e) {
  if (e instanceof CheckFailure) {
    console.log(`      ${red(e.message)}`);
    if (e.hasDiff) {
      console.log(`      expected: ${green(show(e.expected))}`);
      console.log(`      received: ${red(show(e.actual))}`);
    }
  } else if (e instanceof Error) {
    console.log(`      ${red(`${e.name}: ${e.message}`)}`);
    const line = (e.stack || '')
      .split('\n')
      .find((l) => l.includes('file://') && !l.includes('_lib/check.js') && !l.includes('_lib\\check.js') && !l.includes('bq-check.mjs'));
    if (line) console.log(`      ${dim(line.trim())}`);
  } else {
    console.log(`      ${red(`threw a non-Error value: ${show(e)}`)}`);
  }
}

process.on('beforeExit', () => {
  if (reported) return;
  // an early (or emitted-by-hand) beforeExit while tests are still pending is
  // ignored: the result is reported only once every registered test settled
  if (settled !== registered) return;
  reported = true;
  const total = passed + failed + todo;
  const parts = [];
  if (passed) parts.push(green(`${passed} passed`));
  if (failed) parts.push(red(`${failed} failed`));
  if (todo) parts.push(yellow(`${todo} todo`));
  if (!total) parts.push(dim('no tests ran'));
  console.log(`\n  ${parts.join(dim(' · '))}`);
  if (total > 0 && failed === 0 && todo === 0) {
    console.log(`  ${green(bold('all green — next file!'))}`);
  }
  console.log(dim(`  #done passed=${passed} failed=${failed} todo=${todo}`));
  if (nonce !== null) {
    const body = stringify({ passed, failed, todo, registered, tests: records });
    try {
      writeSync(3, `#bq-result ${nonce} ${toBase64(body)}\n`);
    } catch {
      /* no result channel: the runner reports "no result" */
    }
  }
  if (failed > 0) process.exitCode = 1;
});
