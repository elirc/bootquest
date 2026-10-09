// check.js — the bootcamp's tiny test harness. Zero dependencies.
//
// Every exercise file imports from here and is run directly:
//
//     node exercises/03-debounce.js
//
// API:
//   test(name, fn)            register a test (fn may be async)
//   eq(actual, expected, m?)  deep strict equality
//   ok(value, m?)             truthiness
//   throws(fn, match?)        fn must throw; match: substring, RegExp,
//                             or an Error class (checked with instanceof)
//   rejects(fnOrPromise, m?)  async version of throws
//   approx(actual, exp, eps?) float comparison (default eps 1e-9)
//   spy(impl?)                call recorder: s.calls, s.callCount, s.returns
//   sleep(ms)                 await a real delay
//
// A test whose code throws `new Error('TODO')` is reported as "todo",
// not as a failure — that's the "you haven't written it yet" state.

import { isDeepStrictEqual, inspect } from 'node:util';

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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── runner ────────────────────────────────────────────────────────────────

let queue = Promise.resolve();
let passed = 0;
let failed = 0;
let todo = 0;
let reported = false;
const TIMEOUT_MS = 5000;

const isTodo = (e) =>
  e instanceof Error && /^TODO\b/.test(e.message);

export function test(name, fn) {
  queue = queue.then(async () => {
    try {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${TIMEOUT_MS / 1000}s`)),
          TIMEOUT_MS
        );
        timer.unref?.();
      });
      try {
        await Promise.race([Promise.resolve().then(fn), timeout]);
      } finally {
        clearTimeout(timer);
      }
      passed += 1;
      console.log(`  ${green('✔')} ${name}`);
    } catch (e) {
      if (isTodo(e)) {
        todo += 1;
        console.log(`  ${yellow('☐')} ${dim(name)} ${yellow('· todo')}`);
      } else {
        failed += 1;
        console.log(`  ${red('✘')} ${bold(name)}`);
        printFailure(e);
      }
    }
  });
  return queue;
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
      .find((l) => l.includes('file://') && !l.includes('_lib/check.js') && !l.includes('_lib\\check.js'));
    if (line) console.log(`      ${dim(line.trim())}`);
  } else {
    console.log(`      ${red(`threw a non-Error value: ${show(e)}`)}`);
  }
}

process.on('beforeExit', () => {
  if (reported) return;
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
  if (failed > 0) process.exitCode = 1;
});
