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
  ACT_LOCKED: 'This campaign act is not unlocked yet.',
  NOT_ANSWERED: 'Record your own answer first — the key is shown only after.',
  ALREADY_ANSWERED: 'Your answer is already recorded and cannot be edited.',
  ALREADY_SCORED: 'This answer is already self-scored.',
  CONTENT_PENDING: 'The seeded content for this unit is not loaded yet.',
  NOT_VERIFIED: 'This needs a verified, passing submit first.',
  UNTOUCHED_TEMPLATE: 'That is the unchanged starter template. Write your answer into it before storing it.',
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
