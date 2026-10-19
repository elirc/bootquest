import type {
  ApiErrorCode,
  CanonicalRunResult,
  DashboardResponse,
  MutationMarkerBody,
  MutationMarkerResponse,
  SubmissionBodyInput,
  SubmitResponse,
  UnitDetailResponse,
  UnitSummary,
} from '@bootquest/shared/api';
import type { SeedQueueResponse, SyncReport } from '@bootquest/shared/sync';

/**
 * Thin HTTP client for the BootQuest API (contract: shared/src/api.ts; the
 * imports above are TYPE-ONLY, so zod never loads in the CLI). Every write the
 * CLI does goes through POST /units/:id/run|submit — the server derives XP,
 * evidence and verification; the CLI never computes them.
 *
 * Deliberately absent: /reveal, /solution, /model-answer. The CLI never
 * fetches or prints solutions (cli/test/no-solutions.test.ts guards this).
 */

export const DEFAULT_SERVER = 'http://127.0.0.1:4178';
export const DEFAULT_TIMEOUT_MS = 120_000;
/**
 * POST /run and /submit grade on the server, and some checks are legitimately slow
 * (a repo check: up to 50 predicates x a 15s-default git/gh timeout each, plus gh
 * calls). Giving up early does NOT stop the server: a submit would still be recorded
 * and a retry would duplicate it — so wait far longer than any normal grade.
 */
export const GRADE_TIMEOUT_MS = 15 * 60_000;

export interface HealthResponse {
  ok: true;
  version: string;
  counts: { units: number; checks: number };
}
export interface TrackSummary {
  id: string;
  name: string;
  locked: boolean;
  unitCount: number;
  doneCount: number;
}
export interface TracksResponse {
  tracks: TrackSummary[];
}
export interface TrackUnitsResponse {
  track: TrackSummary;
  units: UnitSummary[];
}
export interface RunResponse {
  result: CanonicalRunResult;
}

/** The server answered with its JSON error envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly issues: { path: string; message: string }[];
  constructor(status: number, code: string, message: string, issues: { path: string; message: string }[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/**
 * The request reached the server (or may have) but no answer came in time. NOT
 * "unreachable": the server may still be working on it — for a recorded write
 * (submit) it may still record the attempt.
 */
export class ServerTimeoutError extends Error {
  readonly server: string;
  readonly method: string;
  readonly path: string;
  readonly seconds: number;
  /** the request records something server-side (submit, mutation, sync) */
  readonly recorded: boolean;
  constructor(server: string, method: string, path: string, seconds: number, recorded: boolean) {
    super(`no answer from the BootQuest server at ${server} within ${seconds}s for ${method} ${path}`);
    this.name = 'ServerTimeoutError';
    this.server = server;
    this.method = method;
    this.path = path;
    this.seconds = seconds;
    this.recorded = recorded;
  }
}

/** Nothing answered at the server URL (refused, DNS, reset). Timeouts are ServerTimeoutError. */
export class ServerUnreachableError extends Error {
  readonly server: string;
  readonly reason: string;
  constructor(server: string, reason: string) {
    super(`cannot reach the BootQuest server at ${server} (${reason})`);
    this.name = 'ServerUnreachableError';
    this.server = server;
    this.reason = reason;
  }
}

/** Something answered, but not with the API's JSON (wrong port / not BootQuest). */
export class BadResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadResponseError';
  }
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

/** Accepts http(s) URLs only; strips trailing slashes. */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UsageError(`--server / BOOTQUEST_SERVER must be a URL like ${DEFAULT_SERVER} (got "${raw}")`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`--server / BOOTQUEST_SERVER must be http(s) (got "${raw}")`);
  }
  return trimmed.replace(/\/+$/, '');
}

function errnoOf(err: unknown): string {
  const cause = (err as { cause?: { code?: unknown; message?: unknown; errors?: { code?: unknown }[] } })?.cause;
  if (cause && typeof cause.code === 'string') return cause.code;
  const nested = cause?.errors?.find((e) => typeof e.code === 'string');
  if (nested) return String(nested.code);
  if (cause && typeof cause.message === 'string' && cause.message) return cause.message;
  return err instanceof Error ? err.message : String(err);
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

export class ApiClient {
  readonly server: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(server: string, fetchImpl: FetchLike, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.server = normalizeServerUrl(server);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /**
   * `opts.timeoutMs` overrides the client's timeout (never shortens it below it);
   * `opts.recorded` marks a write the server records, for the timeout message.
   */
  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, opts: { timeoutMs?: number; recorded?: boolean } = {}): Promise<T> {
    const url = `${this.server}/api${path}`;
    const timeoutMs = Math.max(this.timeoutMs, opts.timeoutMs ?? 0);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) throw new ServerTimeoutError(this.server, method, `/api${path}`, Math.round(timeoutMs / 1000), opts.recorded ?? false);
      throw new ServerUnreachableError(this.server, errnoOf(err));
    }
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      // the deadline can also fire while the body streams in
      if (isTimeout(err)) throw new ServerTimeoutError(this.server, method, `/api${path}`, Math.round(timeoutMs / 1000), opts.recorded ?? false);
      throw new ServerUnreachableError(this.server, errnoOf(err));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new BadResponseError(
        `${method} ${url} answered HTTP ${res.status} with non-JSON — is ${this.server} really a BootQuest server?`,
      );
    }
    if (!res.ok) {
      const env = (parsed as { error?: { code?: unknown; message?: unknown; issues?: unknown } })?.error;
      if (env && typeof env.code === 'string' && typeof env.message === 'string') {
        const issues = Array.isArray(env.issues) ? (env.issues as { path: string; message: string }[]) : [];
        throw new ApiError(res.status, env.code, env.message, issues);
      }
      throw new BadResponseError(`${method} ${url} answered HTTP ${res.status} without the API error envelope`);
    }
    return parsed as T;
  }

  health(): Promise<HealthResponse> {
    return this.request('GET', '/health');
  }
  dashboard(): Promise<DashboardResponse> {
    return this.request('GET', '/dashboard');
  }
  tracks(): Promise<TracksResponse> {
    return this.request('GET', '/tracks');
  }
  trackUnits(trackId: string): Promise<TrackUnitsResponse> {
    return this.request('GET', `/tracks/${encodeURIComponent(trackId)}/units`);
  }
  unit(id: number): Promise<UnitDetailResponse> {
    return this.request('GET', `/units/${id}`);
  }
  /** Unit keys contain '/': sent URL-encoded as one path segment. */
  unitByKey(key: string): Promise<UnitDetailResponse> {
    return this.request('GET', `/units/by-key/${encodeURIComponent(key)}`);
  }
  run(id: number, body: SubmissionBodyInput): Promise<RunResponse> {
    return this.request('POST', `/units/${id}/run`, body, { timeoutMs: GRADE_TIMEOUT_MS });
  }
  submit(id: number, body: SubmissionBodyInput): Promise<SubmitResponse> {
    return this.request('POST', `/units/${id}/submit`, body, { timeoutMs: GRADE_TIMEOUT_MS, recorded: true });
  }
  /** W6: the mutation-gate marker (counts only; the server re-evaluates and records the evidence) */
  mutation(id: number, body: MutationMarkerBody): Promise<MutationMarkerResponse> {
    return this.request('POST', `/units/${id}/mutation`, body, { recorded: true });
  }
  /** W4: the server runs the GitHub sync job (it owns the DB: single writer) */
  sync(repos?: string[]): Promise<SyncReport> {
    return this.request('POST', '/sync', repos && repos.length ? { repos } : {}, { recorded: true });
  }
  seedQueue(limit = 20): Promise<SeedQueueResponse> {
    return this.request('GET', `/sync/queue?limit=${limit}`);
  }
}
