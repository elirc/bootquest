// The nonce-checked grading channel shared by the Java runner (javabootcamp BqMain/Check)
// and the C# console-check runner (BqLaunch.cs). The graded program's harness writes ONE line
//     #bq-result <nonce> <base64 json {passed,failed,todo,tests:[{name,status,detail?}]}>
// to a result file; the runner accepts it only with this attempt's nonce (which the
// launcher read and deleted before any learner code was loaded) and only when the counts
// agree with the test list. stdout and the exit code never decide a verdict.

export interface ChannelFailure {
  name: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface ResultTest {
  name: string;
  status: 'pass' | 'fail' | 'todo';
  detail?: string;
}

export interface ResultPayload {
  passed: number;
  failed: number;
  todo: number;
  tests: ResultTest[];
}

/** Parse + nonce-check the result file's text. Returns the payload or why it is refused. */
export function parseResultFile(text: string, nonce: string): { ok: true; payload: ResultPayload } | { ok: false; reason: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l !== '');
  if (lines.length !== 1) return { ok: false, reason: `result file has ${lines.length} lines (want exactly one)` };
  const m = /^#bq-result (\S+) ([A-Za-z0-9+/=]+)$/.exec(lines[0]!);
  if (!m) return { ok: false, reason: 'result line is malformed' };
  if (m[1] !== nonce) return { ok: false, reason: 'result nonce does not match this attempt (forged or stale result)' };
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(m[2]!, 'base64').toString('utf8'));
  } catch {
    return { ok: false, reason: 'result payload is not base64 JSON' };
  }
  const p = raw as Partial<ResultPayload>;
  const nat = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  if (!p || !nat(p.passed) || !nat(p.failed) || !nat(p.todo) || !Array.isArray(p.tests)) return { ok: false, reason: 'result payload has the wrong shape' };
  const tally = { pass: 0, fail: 0, todo: 0 };
  for (const t of p.tests) {
    if (!t || typeof t.name !== 'string' || !(t.status === 'pass' || t.status === 'fail' || t.status === 'todo')) {
      return { ok: false, reason: 'result payload has a malformed test entry' };
    }
    tally[t.status]++;
  }
  if (tally.pass !== p.passed || tally.fail !== p.failed || tally.todo !== p.todo) {
    return { ok: false, reason: 'result counts disagree with its test list' };
  }
  return { ok: true, payload: p as ResultPayload };
}

/** A failed test's detail (`message\n      expected: x\n      received: y\n      at ...`) → Failure. */
export function failureFrom(t: ResultTest): ChannelFailure {
  if (t.status === 'todo') return { name: t.name, message: 'not implemented yet (todo)' };
  const lines = (t.detail ?? '').split('\n').map((l) => l.trim());
  const f: ChannelFailure = { name: t.name, message: lines.filter((d) => d && !/^(expected|received):/.test(d)).join('\n') || 'failed' };
  for (const d of lines) {
    const e = /^expected: (.*)$/.exec(d);
    const a = /^received: (.*)$/.exec(d);
    if (e) f.expected = e[1];
    if (a) f.actual = a[1];
  }
  return f;
}

/** Required names (literal test names of the canonical tests) the payload never reported. */
export function missingTests(payload: ResultPayload, required: readonly string[]): string[] {
  const seen = new Set(payload.tests.map((t) => t.name));
  return [...new Set(required)].filter((n) => !seen.has(n));
}
