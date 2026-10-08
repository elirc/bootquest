import type { UnitDetailResponse } from '@bootquest/shared/api';
import { ApiError, type ApiClient } from './client.ts';
import type { ProjectConfig } from './config.ts';

/**
 * Which units the CLI delivers (DECISION, W3b; http/repo added W3c):
 *
 *  - CODE checks the API grades from a learner file (`{code}` body): drill-js,
 *    drill-cs, and (W4) node-test-file (signalpost program units: the learner
 *    module is graded by the repo's own read-only node:test file, pinned by
 *    sha256 in the server's per-SHA cache). The CLI reads the file and sends it
 *    to /run or /submit.
 *  - PROJECT checks the API grades against the learner's running project:
 *      http  `{port}`     — the SERVER sends the request script to its loopback
 *                            interface on that port (`--port`, default: the
 *                            check's public port hint);
 *      repo  `{repoPath}` — the SERVER evaluates git predicates on that local
 *                            working tree (`--repo`, default: the directory
 *                            holding .bootquest.json).
 *  - BROWSER checks (quiz, predict-output, study-quiz, explain-back,
 *    patch-kata, review) and check-less units (reading, written): refused with
 *    a pointer to the web app. A quiz/predict answer is a one-token choice made
 *    while looking at the choices/snippet — the browser is the material; a CLI
 *    `--answer` flag would only be a worse UI for the same POST.
 *  - CLI-DELIVERED-LATER checks (guided-step, self-run, vitest-project):
 *    spec §4 makes the CLI their delivery vehicle, but the API has no request
 *    shape / runner for them yet (it would answer 501 RUNNER_UNAVAILABLE).
 *    Refused with an explicit "not wired yet" message rather than guessing a
 *    body shape.
 */
export const CODE_CHECKS: ReadonlySet<string> = new Set(['drill-js', 'drill-cs', 'node-test-file']);
export const PROJECT_CHECKS: ReadonlySet<string> = new Set(['http', 'repo']);
export const BROWSER_CHECKS: ReadonlySet<string> = new Set(['quiz', 'predict-output', 'study-quiz', 'explain-back', 'patch-kata', 'review']);
export const PENDING_CLI_CHECKS: ReadonlySet<string> = new Set(['guided-step', 'self-run', 'vitest-project']);

export type Delivery =
  | { mode: 'code'; checkType: string }
  | { mode: 'http'; checkType: 'http'; portHint: number | null }
  | { mode: 'repo'; checkType: 'repo' }
  | { mode: 'refuse'; reason: string };

export function classifyUnit(detail: UnitDetailResponse, command: 'run' | 'submit'): Delivery {
  const { unit } = detail;
  const label = `"${unit.title}" (${unit.key})`;
  const spec = detail.check?.spec;
  const type = spec?.type;
  if (type === undefined) {
    return {
      mode: 'refuse',
      reason:
        `${label} is a ${unit.kind} unit with no machine check — it is done in the BootQuest web app ` +
        `(${unit.kind === 'written' ? 'write your answer there, then compare with the model answer' : 'read it there and mark it done'}).`,
    };
  }
  if (CODE_CHECKS.has(type)) return { mode: 'code', checkType: type };
  if (spec?.type === 'http') return { mode: 'http', checkType: 'http', portHint: spec.port ?? null };
  if (spec?.type === 'repo') return { mode: 'repo', checkType: 'repo' };
  if (BROWSER_CHECKS.has(type)) {
    const runNote =
      command === 'run' && (type === 'quiz' || type === 'predict-output')
        ? ' There is no free run for it either: a free run would reveal the answer (the server answers RUN_NOT_AVAILABLE).'
        : '';
    return {
      mode: 'refuse',
      reason: `${label} is a ${type} unit — browser material: answer it in the BootQuest web app. The CLI submits code files, ports and repos only.${runNote}`,
    };
  }
  if (PENDING_CLI_CHECKS.has(type)) {
    return {
      mode: 'refuse',
      reason:
        `${label} uses a ${type} check. The CLI is its delivery vehicle, but the server API does not accept ${type} ` +
        'submissions yet (no request shape / runner in this build), so the CLI will not guess one. Nothing was sent.',
    };
  }
  return { mode: 'refuse', reason: `${label} uses check type "${type}", which this CLI version does not know. Nothing was sent.` };
}

/**
 * Resolve the configured unit to its detail in ONE request: unitId ->
 * GET /units/:id, unitKey -> GET /units/by-key/:key (W3c; it replaced the
 * W3b client-side scan over every track's units).
 */
export async function resolveUnit(client: ApiClient, config: Pick<ProjectConfig, 'unitId' | 'unitKey' | 'path'>): Promise<UnitDetailResponse> {
  try {
    return config.unitId !== undefined ? await client.unit(config.unitId) : await client.unitByKey(config.unitKey ?? '');
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') {
      const what = config.unitId !== undefined ? `id ${config.unitId}` : `key "${config.unitKey ?? ''}"`;
      throw new ApiError(404, 'NOT_FOUND', `no unit with ${what} on ${client.server} (from ${config.path}). Is the pack that provides it loaded?`);
    }
    throw err;
  }
}
