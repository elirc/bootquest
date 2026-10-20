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
  // the server sends this code for a retest with NO schedule at all (a scheduled-but-early one is NOT_DUE)
  RETEST_NOT_OPEN:
    'This retest is not scheduled yet. It is scheduled once its project artifact is passed solo and that artifact\'s explain-back meets its coverage gate, and opens at least 2 days after that.',
  // the server's local-only guards (README "The API answers local callers only"); nothing ran
  HOST_NOT_ALLOWED: 'The server only answers requests addressed to 127.0.0.1, localhost or [::1]. Open BootQuest from a local address.',
  ORIGIN_NOT_ALLOWED: 'The server refused a request coming from another site. Use BootQuest from its own local address.',
  UNSUPPORTED_MEDIA_TYPE: 'The server only accepts JSON requests. Reload the page; if it persists, the client and server versions differ.',
  // NOT "retry the sync": the sync COMMITTED; only the ladder re-link after it failed (and was rolled
  // back). Only the fallback for an empty server message: SERVER_TEXT_FIRST shows the server's own
  // (it names the cause, and the backup to restore from).
  SYNC_RELINK_FAILED:
    'The sync itself was saved, but re-linking the ladder units failed and was rolled back, so the server keeps serving the old ladder. Do not run the sync again, and fix the content the server log names before restarting: the next start may refuse until then.',
  NETWORK: 'Could not reach the BootQuest server.',
};

/**
 * Codes whose SERVER message is the more useful line, shown in place of the friendly text when
 * present: ALREADY_ANSWERED names the stored answer and, for a retired unit's stranded answer,
 * the unit to self-score it on; SYNC_RELINK_FAILED names the failing cause, that the next start
 * may refuse, and (when configured) the pre-sync backup to restore.
 */
const SERVER_TEXT_FIRST: ReadonlySet<ClientErrorCode> = new Set<ClientErrorCode>(['ALREADY_ANSWERED', 'SYNC_RELINK_FAILED']);

/** One line for an error banner: friendly text for known codes, the server message otherwise. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (SERVER_TEXT_FIRST.has(e.code) && e.message.trim() !== '') return `${e.message} (${e.code})`;
    const friendly = FRIENDLY[e.code];
    return friendly ? `${friendly} (${e.code})` : `${e.message} (${e.code})`;
  }
  return e instanceof Error ? e.message : String(e);
}
