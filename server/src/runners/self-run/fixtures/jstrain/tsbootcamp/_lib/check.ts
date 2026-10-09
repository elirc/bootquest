// check.ts — the TS track's runtime test harness. Typed port of
// bootcamp/_lib/check.js. Zero dependencies.
//
// Run a file:   node ../run.js exercises/01-whatever.ts   (types + tests)
// Tests only:   node --experimental-transform-types exercises/01-whatever.ts
//
// API: test, eq, ok, throws, rejects, approx, spy, sleep — identical
// semantics to the JS track. A test that hits `throw new Error('TODO')`
// reports as "todo", not as a failure.

import { isDeepStrictEqual, inspect } from 'node:util';

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const c = (code: string, s: string): string =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
const green = (s: string) => c('32', s);
const red = (s: string) => c('31', s);
const yellow = (s: string) => c('33', s);
const dim = (s: string) => c('2', s);
const bold = (s: string) => c('1', s);

const show = (v: unknown): string =>
  inspect(v, { depth: 6, colors: false, compact: true, breakLength: 60 });

class CheckFailure extends Error {
  actual: unknown;
  expected: unknown;
  hasDiff: boolean;

  constructor(message: string, actual?: unknown, expected?: unknown, hasDiff = false) {
    super(message);
    this.name = 'CheckFailure';
    this.actual = actual;
    this.expected = expected;
    this.hasDiff = hasDiff;
  }
}

export function eq<T>(actual: T, expected: T, message = 'values differ'): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new CheckFailure(message, actual, expected, true);
  }
}

export function ok(value: unknown, message = 'expected a truthy value'): void {
  if (!value) throw new CheckFailure(`${message} (got ${show(value)})`);
}

export function throws(
  fn: () => unknown,
  match?: string | RegExp,
  message = 'expected function to throw'
): void {
  let threw = false;
  let error: unknown;
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

export async function rejects(
  fnOrPromise: (() => Promise<unknown>) | Promise<unknown>,
  match?: string | RegExp,
  message = 'expected a rejection'
): Promise<void> {
  let rejected = false;
  let error: unknown;
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

function matchError(error: unknown, match?: string | RegExp): void {
  if (match === undefined) return;
  const text = error instanceof Error ? error.message : String(error);
  const hit =
    match instanceof RegExp ? match.test(text) : text.includes(String(match));
  if (!hit) {
    throw new CheckFailure(
      'threw, but the message was wrong',
      text,
      match instanceof RegExp ? String(match) : match,
      true
    );
  }
}

export function approx(
  actual: number,
  expected: number,
  eps = 1e-9,
  message = 'numbers differ'
): void {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > eps) {
    throw new CheckFailure(message, actual, expected, true);
  }
}

export interface Spy<A extends unknown[] = unknown[], R = unknown> {
  (...args: A): R;
  calls: A[];
  returns: R[];
  callCount: number;
}

export function spy<A extends unknown[] = unknown[], R = undefined>(
  impl?: (...args: A) => R
): Spy<A, R> {
  const s = ((...args: A): R => {
    s.calls.push(args);
    s.callCount += 1;
    const result = (impl ? impl(...args) : undefined) as R;
    s.returns.push(result);
    return result;
  }) as Spy<A, R>;
  s.calls = [];
  s.returns = [];
  s.callCount = 0;
  return s;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// ── runner ────────────────────────────────────────────────────────────────

let queue: Promise<void> = Promise.resolve();
let passed = 0;
let failed = 0;
let todo = 0;
let reported = false;
const TIMEOUT_MS = 5000;

const isTodo = (e: unknown): boolean =>
  e instanceof Error && /^TODO\b/.test(e.message);

export function test(name: string, fn: () => unknown | Promise<unknown>): Promise<void> {
  queue = queue.then(async () => {
    try {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
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

function printFailure(e: unknown): void {
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
      .find(
        (l) =>
          l.includes('file://') &&
          !l.includes('_lib/check.ts') &&
          !l.includes('_lib\\check.ts')
      );
    if (line) console.log(`      ${dim(line.trim())}`);
  } else {
    console.log(`      ${red(`threw a non-Error value: ${show(e)}`)}`);
  }
}

process.on('beforeExit', () => {
  if (reported) return;
  reported = true;
  const total = passed + failed + todo;
  const parts: string[] = [];
  if (passed) parts.push(green(`${passed} passed`));
  if (failed) parts.push(red(`${failed} failed`));
  if (todo) parts.push(yellow(`${todo} todo`));
  if (!total) parts.push(dim('no tests ran'));
  console.log(`\n  ${parts.join(dim(' · '))}`);
  if (total > 0 && failed === 0 && todo === 0) {
    console.log(`  ${green(bold('all tests green!'))}`);
  }
  console.log(dim(`  #done passed=${passed} failed=${failed} todo=${todo}`));
  if (failed > 0) process.exitCode = 1;
});
