import type { UnitDetailResponse } from '@bootquest/shared/api';
import { ApiError, type ApiClient } from './client.ts';
import type { ProjectConfig } from './config.ts';

/**
 * Which units the CLI delivers (DECISION, W3b):
 *
 *  - CODE checks the API grades from a learner file (`{code}` body): drill-js,
 *    drill-cs. The CLI reads the file and sends it to /run or /submit.
 *  - BROWSER checks (quiz, predict-output, study-quiz, explain-back,
 *    patch-kata, review) and check-less units (reading, written): refused with
 *    a pointer to the web app. A quiz/predict answer is a one-token choice made
 *    while looking at the choices/snippet — the browser is the material; a CLI
 *    `--answer` flag would only be a worse UI for the same POST.
 *  - CLI-DELIVERED-LATER checks (guided-step, http, repo, node-test-file,
 *    self-run, vitest-project): spec §4 makes the CLI their delivery vehicle,
 *    but the API contract at 451b3b0 has no request shape for them
 *    (SubmissionBody is {code}|{answer}) and the server has no runner for them
 *    (it would answer 501 RUNNER_UNAVAILABLE). Refused with an explicit
 *    "not wired yet" message rather than guessing a body shape.
 */
export const CODE_CHECKS: ReadonlySet<string> = new Set(['drill-js', 'drill-cs']);
export const BROWSER_CHECKS: ReadonlySet<string> = new Set(['quiz', 'predict-output', 'study-quiz', 'explain-back', 'patch-kata', 'review']);
export const PENDING_CLI_CHECKS: ReadonlySet<string> = new Set(['guided-step', 'http', 'repo', 'node-test-file', 'self-run', 'vitest-project']);

export type Delivery =
  | { mode: 'code'; checkType: string }
  | { mode: 'refuse'; reason: string };

export function classifyUnit(detail: UnitDetailResponse, command: 'run' | 'submit'): Delivery {
  const { unit } = detail;
  const label = `"${unit.title}" (${unit.key})`;
  const type = detail.check?.spec.type;
  if (type === undefined) {
    return {
      mode: 'refuse',
      reason:
        `${label} is a ${unit.kind} unit with no machine check — it is done in the BootQuest web app ` +
        `(${unit.kind === 'written' ? 'write your answer there, then compare with the model answer' : 'read it there and mark it done'}).`,
    };
  }
  if (CODE_CHECKS.has(type)) return { mode: 'code', checkType: type };
  if (BROWSER_CHECKS.has(type)) {
    const runNote =
      command === 'run' && (type === 'quiz' || type === 'predict-output')
        ? ' There is no free run for it either: a free run would reveal the answer (the server answers RUN_NOT_AVAILABLE).'
        : '';
    return {
      mode: 'refuse',
      reason: `${label} is a ${type} unit — browser material: answer it in the BootQuest web app. The CLI submits code files only.${runNote}`,
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
 * Resolve the configured unit to its detail. unitId: one GET. unitKey: the API
 * has no lookup-by-key route, so this lists every track's units and matches
 * the key client-side (API gap reported in W3b).
 */
export async function resolveUnit(client: ApiClient, config: Pick<ProjectConfig, 'unitId' | 'unitKey' | 'path'>): Promise<UnitDetailResponse> {
  if (config.unitId !== undefined) {
    try {
      return await client.unit(config.unitId);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_FOUND') {
        throw new ApiError(404, 'NOT_FOUND', `no unit with id ${config.unitId} on ${client.server} (from ${config.path})`);
      }
      throw err;
    }
  }
  const key = config.unitKey ?? '';
  const { tracks } = await client.tracks();
  for (const t of tracks) {
    const { units } = await client.trackUnits(t.id);
    const hit = units.find((u) => u.key === key);
    if (hit) return client.unit(hit.id);
  }
  throw new ApiError(
    404,
    'NOT_FOUND',
    `no unit with key "${key}" on ${client.server} (searched ${tracks.length} track(s); from ${config.path}). ` +
      'Is the pack that provides it loaded?',
  );
}
