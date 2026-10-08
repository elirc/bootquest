import { ApiError, type ClientErrorCode } from './types';

/** Learner-facing text for the error codes the UI surfaces explicitly. */
const FRIENDLY: Partial<Record<ClientErrorCode, string>> = {
  RUN_NOT_AVAILABLE: 'Free runs are not available for this unit type (a run would give the answer away). Submit instead.',
  TRACK_LOCKED: 'This track is locked.',
  NOT_DUE: 'This card is not due yet.',
  ALREADY_ATTESTED: 'Already marked as read.',
  NOT_REVEALED: 'The solution has not been revealed for this unit.',
  NO_SOLUTION: 'No reference solution is available for this unit.',
  NO_CHECK: 'This unit has no automated check.',
  RUNNER_UNAVAILABLE: 'The runner for this unit type is not available yet.',
  WRONG_UNIT_KIND: 'That action is not available for this kind of unit.',
  NOT_FOUND: 'Not found.',
  NETWORK: 'Could not reach the BootQuest server.',
};

/** One line for an error banner: friendly text for known codes, the server message otherwise. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const friendly = FRIENDLY[e.code];
    return friendly ? `${friendly} (${e.code})` : `${e.message} (${e.code})`;
  }
  return e instanceof Error ? e.message : String(e);
}
