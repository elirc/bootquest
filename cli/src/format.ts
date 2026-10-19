import type { CanonicalRunResult, DashboardResponse, SubmitResponse, UnitDetailResponse } from '@bootquest/shared/api';
import type { SeedQueueResponse, SyncReport } from '@bootquest/shared/sync';
import { ApiError, BadResponseError, ServerTimeoutError, ServerUnreachableError, UsageError } from './client.ts';
import { ConfigError } from './config.ts';

/** Plain text (no ANSI): output is meant to be readable in any terminal and greppable by scripts. */

const MAX_VALUE_CHARS = 200;
const MAX_OUTPUT_LINES = 40;

/**
 * Failure values. Strings print raw: the drill runner already sends
 * util.inspect renderings ("[ 2, 1 ]", "'x'", "undefined"), so quoting them
 * again would show "\"[ 2, 1 ]\"". Anything else is JSON.
 */
export function describeValue(v: unknown): string {
  let s: string;
  if (v === undefined) s = 'undefined';
  else if (typeof v === 'string') s = v;
  else {
    try {
      s = JSON.stringify(v) ?? String(v);
    } catch {
      s = String(v);
    }
  }
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS - 3)}...` : s;
}

function indent(text: string, pad: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => pad + l)
    .join('\n');
}

export function unitLabel(unit: Pick<UnitDetailResponse['unit'], 'title' | 'key'>): string {
  return `${unit.title} (${unit.key})`;
}

/** Numbered failure list with expected/actual when the server provides them. */
export function formatFailures(failures: CanonicalRunResult['failures'], totalTests?: number, noun = 'test'): string {
  if (failures.length === 0) return '';
  const head =
    totalTests !== undefined && totalTests > 0
      ? `Failures (${failures.length} of ${totalTests} ${noun}${totalTests === 1 ? '' : 's'}):`
      : `Failures (${failures.length}):`;
  const lines = [head];
  failures.forEach((f, i) => {
    lines.push(`  ${i + 1}. ${f.name}`);
    const hasValues = f.expected !== undefined || f.actual !== undefined;
    // with expected/actual present, the assertion's multi-line diff only repeats them: keep its headline
    const message = hasValues ? (f.message.trim().split(/\r?\n/)[0] ?? '') : f.message.trim();
    if (message && message !== f.name) lines.push(indent(message, '       '));
    if (f.expected !== undefined) lines.push(`       expected: ${describeValue(f.expected)}`);
    if (f.actual !== undefined) lines.push(`       actual:   ${describeValue(f.actual)}`);
  });
  return lines.join('\n');
}

function formatOutput(output: string): string {
  const trimmed = output.replace(/\s+$/, '');
  if (!trimmed) return '';
  const lines = trimmed.split(/\r?\n/);
  const shown = lines.slice(0, MAX_OUTPUT_LINES);
  const more = lines.length - shown.length;
  return ['Output:', indent(shown.join('\n'), '  '), ...(more > 0 ? [`  ... (${more} more line${more === 1 ? '' : 's'})`] : [])].join('\n');
}

/** How many named tests the public spec declares, and what they are called (drill tests, http requests, repo predicates). */
export function testCount(detail: UnitDetailResponse): { n: number; noun: string } | undefined {
  const spec = detail.check?.spec;
  if (!spec) return undefined;
  if (spec.type === 'drill-js') return { n: spec.tests.length, noun: 'test' };
  if (spec.type === 'http') return { n: spec.requests.length, noun: 'request' };
  if (spec.type === 'repo') return { n: spec.predicates.length, noun: 'predicate' };
  return undefined;
}

const plural = (n: number, noun: string) => `${noun}${n === 1 ? '' : 's'}`;

function passLine(result: CanonicalRunResult, count: { n: number; noun: string } | undefined): string {
  if (!count) return result.pass ? 'PASS' : 'FAIL';
  const { n, noun } = count;
  return result.pass ? `PASS (${n}/${n} ${plural(n, noun)})` : `FAIL (${n - result.failures.length}/${n} ${plural(n, noun)} passing)`;
}

/**
 * `source` is what was checked: a file path (label "File"), the learner's
 * server (label "Target") or a repo directory (label "Repo").
 */
export function formatRun(detail: UnitDetailResponse, result: CanonicalRunResult, source: string, label = 'File'): string {
  const count = testCount(detail);
  return [
    `Run (free, not recorded): ${unitLabel(detail.unit)}`,
    `${label}: ${source}`,
    `Result: ${passLine(result, count)} in ${Math.round(result.durationMs)}ms`,
    formatFailures(result.failures, count?.n, count?.noun),
    formatOutput(result.output),
    result.pass ? 'Looks good. `bootquest submit` records it and awards XP.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const XP_ZERO_EXPLANATIONS: Readonly<Record<string, string>> = {
  'already-awarded': 'you already earned XP for this unit; the pass is recorded, no new XP',
  revealed: 'the solution was revealed for this unit, so passes earn no XP (attempt flagged guided)',
  'daily-cap': 'the daily XP cap for this kind is reached; the pass is recorded',
};

/** XP line. Zero reasons are printed verbatim (the server's code) plus a gloss. */
export function formatXp(resp: Pick<SubmitResponse, 'xp' | 'verdict'>): string {
  const { xp, verdict } = resp;
  if (xp === null) {
    return verdict === 'pass'
      ? 'XP: none (this check type does not award XP)'
      : 'XP: none (failed submits cost nothing and earn nothing; the attempt is recorded)';
  }
  if (xp.amount > 0) return `XP: +${xp.amount}`;
  if (xp.reason !== null) {
    const gloss = XP_ZERO_EXPLANATIONS[xp.reason];
    return `XP: +0 (reason: ${xp.reason})${gloss ? ` - ${gloss}` : ''}`;
  }
  return 'XP: +0';
}

export function formatSubmit(detail: UnitDetailResponse, resp: SubmitResponse, source: string, label = 'File'): string {
  const count = testCount(detail);
  const mode = resp.attempt.mode === 'assisted' ? 'assisted (you reported help)' : resp.attempt.mode;
  return [
    `Submit: ${unitLabel(detail.unit)}`,
    `${label}: ${source}`,
    `Verdict: ${resp.verdict.toUpperCase()}${count !== undefined ? ` (${count.n - resp.result.failures.length}/${count.n} ${plural(count.n, count.noun)} passing)` : ''}`,
    `Attempt #${resp.attempt.id} recorded (mode: ${mode}, outcome: ${resp.attempt.outcome}, ${Math.round(resp.result.durationMs)}ms)`,
    formatFailures(resp.result.failures, count?.n, count?.noun),
    formatOutput(resp.result.output),
    formatXp(resp),
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatDashboard(d: DashboardResponse, server: string): string {
  const s = d.streak;
  const lines = [
    `BootQuest @ ${server}  (today ${d.today})`,
    `Streak: ${s.current} day${s.current === 1 ? '' : 's'} (longest ${s.longest}, tokens ${s.tokens}, today ${s.todayComplete ? 'complete' : 'not complete yet'})`,
    `XP: ${d.xp.total} total - level ${d.xp.level} (${d.xp.intoLevel}/${d.xp.levelSpan} into level, next level at ${d.xp.nextAt})`,
    `Reviews due: ${d.reviewQueue.due}`,
    'Next up:',
  ];
  if (d.nextUp.length === 0) lines.push('  (nothing)');
  for (const n of d.nextUp) {
    lines.push(n.unit ? `  ${n.trackId.padEnd(8)} ${n.unit.title} [${n.unit.kind}] id ${n.unit.id} - ${n.unit.key}` : `  ${n.trackId.padEnd(8)} (nothing available)`);
  }
  return lines.join('\n');
}

/** Slate slot wording (mirrors the web dashboard's labels; the server owns the slots). */
export function slateLabel(item: DashboardResponse['slate']['items'][number]): string {
  switch (item.kind) {
    case 'drill-set':
      return `${item.track ? `${item.track} ` : ''}drill set${item.size ? ` (${item.size} drill${item.size === 1 ? '' : 's'})` : ''}`;
    case 'campaign-step':
      return 'campaign step';
    case 'review-clear':
      return 'clear the review queue';
    default:
      return String((item as { kind: unknown }).kind);
  }
}

/**
 * `bootquest today` (B4): today's slate with done state, reviews due, streak + freeze tokens
 * and next-up per track. Every number is the server's (GET /api/dashboard); nothing is derived.
 */
export function formatToday(d: DashboardResponse, server: string): string {
  const s = d.streak;
  const items = d.slate.items;
  const done = items.filter((i) => i.done).length;
  const lines = [`BootQuest today: ${d.today}  (${server})`, `Slate: ${done}/${items.length} done (${d.slate.status})`];
  if (items.length === 0) lines.push('  (no slate slots today)');
  for (const i of items) lines.push(`  [${i.done ? 'x' : ' '}] ${slateLabel(i)}`);
  lines.push(
    `Reviews due: ${d.reviewQueue.due}`,
    `Streak: ${s.current} day${s.current === 1 ? '' : 's'} (longest ${s.longest}) - today ${s.todayComplete ? 'complete' : 'not complete yet'}`,
    `Freeze tokens: ${s.tokens}`,
    'Next up:',
  );
  if (d.nextUp.length === 0) lines.push('  (nothing)');
  for (const n of d.nextUp) {
    lines.push(n.unit ? `  ${n.trackId.padEnd(8)} ${n.unit.title} [${n.unit.kind}] id ${n.unit.id}` : `  ${n.trackId.padEnd(8)} (nothing available)`);
  }
  return lines.join('\n');
}

export function formatProject(detail: UnitDetailResponse, configPath: string, file: { path: string; exists: boolean } | null, delivery: string): string {
  const u = detail.unit;
  const check = detail.check;
  const count = testCount(detail);
  const checkLine = check
    ? `${check.spec.type}${count ? ` (${count.n} ${plural(count.n, count.noun)})` : ''}${check.spec.type === 'http' && check.spec.port !== undefined ? `, port hint ${check.spec.port}` : ''}`
    : 'none (browser-only unit)';
  return [
    `Project: ${configPath}`,
    `  Unit:   ${unitLabel(u)} - id ${u.id}, ${u.kind}, track ${u.trackId}`,
    `  State:  ${u.state}${u.revealed ? ' (solution revealed: no XP)' : ''}`,
    `  Check:  ${checkLine}`,
    `  CLI:    ${delivery}`,
    file ? `  File:   ${file.path}${file.exists ? '' : ' (MISSING)'}` : '  File:   (none configured; pass a path to run/submit)',
  ].join('\n');
}

/** `bootquest sync`: one line per registered repo + the seed-queue size. */
export function formatSync(r: SyncReport, queue: SeedQueueResponse, server: string): string {
  const lines = [`GitHub sync #${r.syncId} on ${server}${r.offline ? ' (OFFLINE: cache only)' : ''}:`];
  for (const x of r.repos) {
    if (x.error !== null) {
      lines.push(`  FAIL ${x.repo}: ${x.error}`);
      continue;
    }
    const prog = x.program
      ? `; program: ${x.program.units} units (${x.program.checked} checked, ${x.program.study} study)${x.program.checkDrift.length ? `, ${x.program.checkDrift.length} drift note(s)` : ''}`
      : '';
    lines.push(
      `  ok   ${x.repo} @ ${(x.sha ?? '').slice(0, 7)} (${x.shaFrom}, tarball ${x.tarball}): ${x.markdownFiles} md, ` +
        `refs +${x.refs.inserted} ~${x.refs.updated} =${x.refs.unchanged} -${x.refs.missing}, new keys ${x.newKeys}${prog}`,
    );
    for (const d of x.program?.checkDrift ?? []) lines.push(`         drift: ${d}`);
  }
  lines.push(`Seed queue: ${queue.count} pending stable_key(s) for the next seed session (GET /api/sync/queue).`);
  for (const q of queue.items) lines.push(`  ${q.reason.padEnd(7)} ${q.repo} ${q.path}${q.anchor ? `#${q.anchor}` : ''}  "${q.title}"`);
  if (queue.count > queue.items.length) lines.push(`  ... and ${queue.count - queue.items.length} more`);
  return lines.join('\n');
}

/** Friendly rendering of every error the CLI can hit. Never a stack trace. */
export function formatError(err: unknown): string {
  if (err instanceof ServerUnreachableError) {
    return [
      `Cannot reach the BootQuest server at ${err.server} (${err.reason}).`,
      'Start it from the BootQuest repo with `npm run serve`, or point the CLI elsewhere with --server <url> / BOOTQUEST_SERVER.',
    ].join('\n');
  }
  if (err instanceof ServerTimeoutError) {
    // the request was sent: the server is up but has not answered — it may still be working on it
    const what = err.path.endsWith('/submit') ? 'grading' : 'working on it';
    return [
      `No answer from the BootQuest server at ${err.server} within ${err.seconds}s (${err.method} ${err.path}).`,
      err.recorded
        ? `The server may still be ${what} and may still record it: run \`bootquest status\` before retrying, so a retry does not record it twice.`
        : `The server may still be ${what}; nothing is recorded by this request, so it is safe to retry.`,
    ].join('\n');
  }
  if (err instanceof ApiError) {
    const hint = API_ERROR_HINTS[err.code];
    const issues = err.issues.map((i) => `  - ${i.path}: ${i.message}`);
    return [`Server refused (${err.code}, HTTP ${err.status}): ${err.message}`, ...issues, ...(hint ? [hint] : [])].join('\n');
  }
  if (err instanceof ConfigError) return `Config problem: ${err.message}`;
  if (err instanceof UsageError || err instanceof BadResponseError) return err.message;
  return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
}

const API_ERROR_HINTS: Readonly<Record<string, string>> = {
  NOT_FOUND: 'Check "unitKey"/"unitId" in your .bootquest.json and that the server loaded the right packs.',
  RUN_NOT_AVAILABLE: 'This unit is submit-only: a free run would reveal the answer. Answer it in the web app.',
  RUNNER_UNAVAILABLE: 'The server has no runner for this check type in this build.',
  TRACK_LOCKED: 'This track is locked on the server; finish the unlock requirement first.',
  PAYLOAD_TOO_LARGE: 'The file is too large to submit.',
  NO_CHECK: 'This unit has no machine check; it is completed in the web app.',
  WRONG_UNIT_KIND: 'That action does not apply to this kind of unit.',
  CHECK_INTEGRITY: 'The pinned check file is not in the cache or fails its hash pin; run `bootquest sync` (online) and retry. Nothing was recorded.',
  SYNC_UNAVAILABLE: 'This server has no GitHub sync configured (curriculum.yaml / cache dir).',
  SYNC_IN_PROGRESS: 'A sync is already running on the server; wait for it to finish.',
  INTERNAL: 'The server hit an internal error; see the server log.',
  NOT_VERIFIED: 'Submit the project until it passes (bootquest submit), then run bootquest mutate on that same code.',
  MUTATION_BELOW_THRESHOLD: 'The server re-checked the report and the gate does not hold; nothing was recorded.',
  NOT_DUE: 'This changed-example retest opens >= 2 days after the artifact and its explain-back; bootquest run still works meanwhile.',
  ACT_LOCKED: 'This unit belongs to a campaign act that is not unlocked yet.',
};
