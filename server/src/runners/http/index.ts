import { connect } from 'node:net';
import type { HttpCheck } from '@bootquest/shared';
import type { z } from 'zod';
import { matchShape } from './shape.ts';

/**
 * HTTP check runner (spec §4, W3c). The SERVER sends the check's request
 * script to the learner's local server and asserts status / headers / JSON
 * shape. Trust model:
 *   - the learner supplies ONLY a port; the host is fixed to the loopback
 *     interface by construction (127.0.0.1, or [::1] when nothing listens on
 *     the IPv4 loopback — e.g. a dev server bound to "localhost" on IPv6 only);
 *   - request paths come from the seeded spec and are origin-relative (Zod);
 *   - redirects are NOT followed (a 3xx is asserted as-is, never chased to
 *     another host); no retries; per-request timeout + a total cap;
 *   - response bodies are read up to MAX_BODY_BYTES.
 * Result: one named test per request; a failure carries expected/actual of
 * its first problem and lists every problem in its message. Network errors
 * are failures carrying the error text verbatim.
 */

export type HttpCheckSpec = z.infer<typeof HttpCheck>;

export interface HttpFailure {
  name: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface HttpRunResult {
  pass: boolean;
  output: string;
  failures: HttpFailure[];
  durationMs: number;
}

export const MAX_BODY_BYTES = 1_000_000;
export const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const;
export type LoopbackHost = (typeof LOOPBACK_HOSTS)[number];

/** Which loopback address accepts a TCP connection on `port` (127.0.0.1 first); null when neither. */
export async function pickLoopbackHost(port: number, timeoutMs: number): Promise<LoopbackHost | null> {
  for (const host of LOOPBACK_HOSTS) {
    const ok = await new Promise<boolean>((done) => {
      const sock = connect({ host, port });
      const finish = (v: boolean) => {
        sock.removeAllListeners();
        sock.destroy();
        done(v);
      };
      sock.setTimeout(timeoutMs, () => finish(false));
      sock.once('connect', () => finish(true));
      sock.once('error', () => finish(false));
    });
    if (ok) return host;
  }
  return null;
}

export function originFor(host: LoopbackHost, port: number): string {
  return host === '::1' ? `http://[::1]:${port}` : `http://127.0.0.1:${port}`;
}

/** Build the target URL and prove it still points at the loopback origin (defense in depth over the Zod path rule). */
export function targetUrl(host: LoopbackHost, port: number, path: string): URL {
  const origin = originFor(host, port);
  const url = new URL(origin + path);
  if (url.origin !== new URL(origin).origin) throw new Error(`refusing ${path}: it does not stay on ${origin}`);
  return url;
}

/** The underlying network error, verbatim (undici wraps it as `fetch failed` + cause). */
export function networkErrorText(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: unknown; message?: unknown } };
  const cause = e?.cause;
  if (cause && typeof cause.message === 'string' && cause.message) {
    return typeof cause.code === 'string' && !cause.message.includes(cause.code) ? `${cause.code}: ${cause.message}` : cause.message;
  }
  return e?.message ?? String(err);
}

async function readBody(res: Response): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { text: '', truncated: true };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated: false };
}

/** Header value match: exact, or the part before the first ';' (media-type parameters ignored). */
export function headerMatches(expected: string, actual: string): boolean {
  const a = actual.trim();
  const e = expected.trim();
  if (a === e) return true;
  const semi = a.indexOf(';');
  return semi >= 0 && a.slice(0, semi).trim().toLowerCase() === e.toLowerCase();
}

interface Problem {
  text: string;
  expected: unknown;
  actual: unknown;
}

function snippet(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 120 ? `${one.slice(0, 117)}...` : one;
}

export interface HttpRunOptions {
  /** injected for tests; defaults to the global fetch */
  fetch?: typeof fetch;
}

export async function runHttpCheck(spec: HttpCheckSpec, port: number, opts: HttpRunOptions = {}): Promise<HttpRunResult> {
  const doFetch = opts.fetch ?? fetch;
  const started = performance.now();
  const deadline = started + spec.totalTimeoutMs;
  const failures: HttpFailure[] = [];
  const lines: string[] = [];

  const host = (await pickLoopbackHost(port, Math.min(spec.timeoutMs, 2000))) ?? '127.0.0.1';
  lines.push(`target ${originFor(host, port)} (${spec.requests.length} request${spec.requests.length === 1 ? '' : 's'})`);

  for (const req of spec.requests) {
    const label = `${req.method} ${req.path}`;
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      const message = `not sent: the check's total time cap (${spec.totalTimeoutMs}ms) was reached`;
      failures.push({ name: req.name, message });
      lines.push(`FAIL ${req.name} - ${label} - ${message}`);
      continue;
    }
    const timeout = Math.max(1, Math.min(spec.timeoutMs, Math.floor(remaining)));
    const headers: Record<string, string> = { accept: 'application/json, */*;q=0.5', ...(req.headers ?? {}) };
    let body: string | undefined;
    if (req.body !== undefined) {
      body = JSON.stringify(req.body);
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
    }
    const t0 = performance.now();
    let res: Response;
    let text: string;
    let truncated: boolean;
    try {
      const url = targetUrl(host, port, req.path);
      res = await doFetch(url, { method: req.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
      ({ text, truncated } = await readBody(res));
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const message =
        name === 'TimeoutError' || name === 'AbortError'
          ? `no response within ${timeout}ms (timed out)`
          : `request failed: ${networkErrorText(err)}`;
      failures.push({ name: req.name, message });
      lines.push(`FAIL ${req.name} - ${label} - ${message}`);
      continue;
    }
    const ms = Math.round(performance.now() - t0);

    const problems: Problem[] = [];
    const ex = req.expect;
    if (res.status !== ex.status) problems.push({ text: `status: expected ${ex.status}, got ${res.status}`, expected: ex.status, actual: res.status });
    for (const [hname, hval] of Object.entries(ex.headers ?? {})) {
      const actual = res.headers.get(hname);
      if (actual === null) {
        problems.push({ text: `header ${hname.toLowerCase()}: missing (expected "${hval}")`, expected: `${hname.toLowerCase()}: ${hval}`, actual: '(missing)' });
      } else if (!headerMatches(hval, actual)) {
        problems.push({ text: `header ${hname.toLowerCase()}: expected "${hval}", got "${actual}"`, expected: `${hname.toLowerCase()}: ${hval}`, actual: `${hname.toLowerCase()}: ${actual}` });
      }
    }
    if (ex.jsonShape !== undefined) {
      if (truncated) {
        problems.push({ text: `body: larger than ${MAX_BODY_BYTES} bytes, not checked`, expected: 'a JSON body', actual: `> ${MAX_BODY_BYTES} bytes` });
      } else {
        let parsed: unknown;
        let ok = true;
        try {
          parsed = JSON.parse(text);
        } catch {
          ok = false;
        }
        if (!ok) {
          problems.push({ text: `body: not JSON (${text.length ? `"${snippet(text)}"` : 'empty'})`, expected: 'a JSON body', actual: text.length ? snippet(text) : '(empty body)' });
        } else {
          const m = matchShape(ex.jsonShape, parsed);
          if (m) problems.push({ text: `body ${m.path}: expected ${m.expected}, got ${m.actual}`, expected: `${m.path}: ${m.expected}`, actual: `${m.path}: ${m.actual}` });
        }
      }
    }

    if (problems.length === 0) {
      lines.push(`PASS ${req.name} - ${label} -> ${res.status} (${ms}ms)`);
    } else {
      const first = problems[0]!;
      failures.push({ name: req.name, message: problems.map((p) => p.text).join('\n'), expected: first.expected, actual: first.actual });
      lines.push(`FAIL ${req.name} - ${label} -> ${res.status} (${ms}ms): ${problems.map((p) => p.text).join('; ')}`);
    }
  }

  return { pass: failures.length === 0, output: lines.join('\n'), failures, durationMs: Math.round(performance.now() - started) };
}
