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
  ARTIFACT_REQUIRED: 'Pass the linked artifact unit solo first — the explain-back opens after.',
  RETEST_NOT_OPEN: 'This retest is not open yet: it opens when its schedule is due (at least 2 days after the explain-back).',
  // the server's local-only guards (README "The API answers local callers only"); nothing ran
  HOST_NOT_ALLOWED: 'The server only answers requests addressed to 127.0.0.1, localhost or [::1]. Open BootQuest from a local address.',
  ORIGIN_NOT_ALLOWED: 'The server refused a request coming from another site. Use BootQuest from its own local address.',
  UNSUPPORTED_MEDIA_TYPE: 'The server only accepts JSON requests. Reload the page; if it persists, the client and server versions differ.',
  // NOT "retry the sync": the sync COMMITTED; only the ladder re-link after it failed (and was rolled back)
  SYNC_RELINK_FAILED:
    'The sync itself was saved, but re-linking the ladder units failed, so the server is still serving the old ladder. Restart the server to load the synced content — do not run the sync again.',
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
