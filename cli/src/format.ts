import type { CanonicalRunResult, DashboardResponse, SubmitResponse, UnitDetailResponse } from '@bootquest/shared/api';
import { ApiError, BadResponseError, ServerUnreachableError, UsageError, type HealthResponse, type TracksResponse } from './client.ts';
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
export function formatFailures(failures: CanonicalRunResult['failures'], totalTests?: number): string {
  if (failures.length === 0) return '';
  const head =
    totalTests !== undefined && totalTests > 0
      ? `Failures (${failures.length} of ${totalTests} test${totalTests === 1 ? '' : 's'}):`
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

function testCount(detail: UnitDetailResponse): number | undefined {
  const spec = detail.check?.spec;
  return spec && spec.type === 'drill-js' ? spec.tests.length : undefined;
}

function passLine(result: CanonicalRunResult, total: number | undefined): string {
  if (result.pass) return total !== undefined ? `PASS (${total}/${total} tests)` : 'PASS';
  return total !== undefined ? `FAIL (${total - result.failures.length}/${total} tests passing)` : 'FAIL';
}

export function formatRun(detail: UnitDetailResponse, result: CanonicalRunResult, file: string): string {
  const total = testCount(detail);
  return [
    `Run (free, not recorded): ${unitLabel(detail.unit)}`,
    `File: ${file}`,
    `Result: ${passLine(result, total)} in ${Math.round(result.durationMs)}ms`,
    formatFailures(result.failures, total),
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

export function formatSubmit(detail: UnitDetailResponse, resp: SubmitResponse, file: string): string {
  const total = testCount(detail);
  const mode = resp.attempt.mode === 'assisted' ? 'assisted (you reported help)' : resp.attempt.mode;
  return [
    `Submit: ${unitLabel(detail.unit)}`,
    `File: ${file}`,
    `Verdict: ${resp.verdict.toUpperCase()}${total !== undefined ? ` (${total - resp.result.failures.length}/${total} tests passing)` : ''}`,
    `Attempt #${resp.attempt.id} recorded (mode: ${mode}, outcome: ${resp.attempt.outcome}, ${Math.round(resp.result.durationMs)}ms)`,
    formatFailures(resp.result.failures, total),
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

export function formatProject(detail: UnitDetailResponse, configPath: string, file: { path: string; exists: boolean } | null, delivery: string): string {
  const u = detail.unit;
  const check = detail.check;
  const checkLine = check
    ? `${check.spec.type}${check.spec.type === 'drill-js' ? ` (${check.spec.tests.length} tests)` : ''}`
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

export function formatSync(h: HealthResponse, tracks: TracksResponse, server: string): string {
  return [
    `Server ${server} is up (BootQuest server v${h.version}).`,
    `Content: ${h.counts.units} units, ${h.counts.checks} checks loaded.`,
    ...tracks.tracks.map((t) => `  ${t.id.padEnd(8)} ${t.name}: ${t.doneCount}/${t.unitCount} done${t.locked ? ' (locked)' : ''}`),
    'GitHub curriculum sync is not implemented yet (milestone W4); this command only checks the server and its loaded content.',
  ].join('\n');
}

/** Friendly rendering of every error the CLI can hit. Never a stack trace. */
export function formatError(err: unknown): string {
  if (err instanceof ServerUnreachableError) {
    return [
      `Cannot reach the BootQuest server at ${err.server} (${err.reason}).`,
      'Start it from the BootQuest repo with `npm run serve`, or point the CLI elsewhere with --server <url> / BOOTQUEST_SERVER.',
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
  INTERNAL: 'The server hit an internal error; see the server log.',
};
