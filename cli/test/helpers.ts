import type { DashboardResponse, SubmitResponse, UnitDetailResponse } from '@bootquest/shared/api';
import type { FetchLike } from '../src/client.ts';
import type { CliIo } from '../src/program.ts';

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

export type Route = { status: number; body: unknown } | ((call: Call) => { status: number; body: unknown });

/** In-memory fetch: routes keyed "METHOD /api/path"; unknown routes 404 with the API envelope. */
export function fakeFetch(routes: Record<string, Route>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { method: init.method, url, body: init.body !== undefined ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const path = new URL(url).pathname;
    const route = routes[`${init.method} ${path}`];
    const r = route === undefined
      ? { status: 404, body: { error: { code: 'NOT_FOUND', message: `no route for ${init.method} ${path}` } } }
      : typeof route === 'function'
        ? route(call)
        : route;
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => text };
  };
  return { fetch, calls };
}

export function captureIo(cwd: string, fetch: FetchLike, env: Record<string, string | undefined> = {}): CliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { cwd, env, fetch, out: (t) => stdout.push(t), err: (t) => stderr.push(t), version: '0.1.0', stdout, stderr };
}

export function drillDetail(over: Partial<UnitDetailResponse['unit']> = {}): UnitDetailResponse {
  return {
    unit: {
      id: 12,
      key: 'bootforge/js-fundamentals/values/variables/swap',
      trackId: 'js',
      kind: 'drill',
      title: 'Swap two values',
      difficulty: 1,
      state: 'available',
      revealed: false,
      prerequisites: [],
      code: null,
      competencies: ['language-fluency'],
      variationOfUnitId: null,
      ...over,
    },
    check: { id: 7, threshold: null, spec: { type: 'drill-js', language: 'js', tests: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], timeoutMs: 5000 } },
    instructions: 'Export swap',
    starter: 'export function swap() {}',
    snippet: null,
    rubric: null,
  };
}

export function httpDetail(over: { port?: number } = { port: 3000 }): UnitDetailResponse {
  return {
    ...drillDetail({ id: 21, kind: 'http-lab', key: 'fixture:http-tasks-api', title: 'Tasks API' }),
    check: {
      id: 21,
      threshold: null,
      spec: {
        type: 'http',
        ...(over.port !== undefined ? { port: over.port } : {}),
        timeoutMs: 5000,
        requests: [
          { name: 'health', method: 'GET', path: '/health' },
          { name: 'create', method: 'POST', path: '/api/tasks' },
        ],
      },
    },
  };
}

export function repoDetail(): UnitDetailResponse {
  return {
    ...drillDetail({ id: 22, kind: 'repo-task', key: 'fixture:repo-feature-branch', title: 'Feature branch' }),
    check: {
      id: 22,
      threshold: null,
      spec: {
        type: 'repo',
        timeoutMs: 15000,
        predicates: [
          { kind: 'branch-exists', name: 'feature branch exists' },
          { kind: 'clean-worktree', name: 'nothing left uncommitted' },
          { kind: 'min-commits', name: 'small commits (3+)' },
        ],
      },
    },
  };
}

export function quizDetail(): UnitDetailResponse {
  return {
    ...drillDetail({ id: 3, kind: 'quiz', key: 'bootforge/q', title: 'Quick check' }),
    check: { id: 2, threshold: null, spec: { type: 'quiz', itemKey: 'bootforge/q', grading: 'choice', choices: ['a', 'b'] } },
  };
}

export function submitResp(over: Partial<SubmitResponse> = {}): SubmitResponse {
  return {
    result: { pass: true, output: '', failures: [], durationMs: 12 },
    verdict: 'pass',
    attempt: { id: 5, mode: 'solo', outcome: 'pass' },
    runId: 9,
    xp: { id: 1, amount: 10, reason: null },
    evidenceIds: [1],
    ...over,
  };
}

export function dashboard(): DashboardResponse {
  return {
    today: '2026-10-07',
    streak: { current: 3, longest: 5, tokens: 1, slateDaysBanked: 0, todayComplete: false },
    heatmap: [],
    xp: { total: 120, level: 2, intoLevel: 20, levelSpan: 150, nextAt: 250 },
    competencies: [],
    slate: { day: '2026-10-07', status: 'open', items: [] },
    reviewQueue: { due: 4 },
    nextUp: [
      { trackId: 'js', unit: { id: 12, key: 'bootforge/js-fundamentals/values/variables/swap', title: 'Swap two values', kind: 'drill' } },
      { trackId: 'csharp', unit: null },
    ],
  };
}
