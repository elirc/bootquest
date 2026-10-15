import { statSync } from 'node:fs';
import { CheckSpec } from '@bootquest/shared';
import { loadCheckSpecTable } from './config.ts';
import { recordedCheckSpec } from './program.ts';

/**
 * campaign 2 release (F7): the recorded check-table cache and the honest carve-outs on
 * program units, moved here from api/service.ts unchanged in behaviour (the table and its
 * semantics belong to sync; GET /units only surfaces the result).
 */

type CheckSpecTable = ReturnType<typeof loadCheckSpecTable>;

/**
 * campaign 2 (OPS review): GET /units/:id used to re-read + Zod-parse the recorded check table on
 * EVERY program-unit detail. Cached per path, invalidated when the file's mtime or size changes;
 * a malformed table is reported LOUDLY once per file version (console.error) instead of being
 * swallowed silently on every request.
 */
interface CheckTableCacheEntry {
  mtimeMs: number;
  size: number;
  table: CheckSpecTable | null;
}
const checkTableCache = new Map<string, CheckTableCacheEntry>();
/** Exported for tests only. */
export const checkTableCacheStats = { parses: 0, malformedReports: 0, carveOutErrorReports: 0 };

export type Reporter = (line: string) => void;
const consoleReporter: Reporter = (l) => console.error(l);

export function cachedCheckSpecTable(path: string, report: Reporter = consoleReporter): CheckSpecTable | null {
  let st: { mtimeMs: number; size: number };
  try {
    st = statSync(path);
  } catch {
    checkTableCache.delete(path);
    return null; // no table: nothing to surface (sync reports a missing table where it matters)
  }
  const hit = checkTableCache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.table;
  checkTableCacheStats.parses++;
  let table: CheckTableCacheEntry['table'] = null;
  try {
    table = loadCheckSpecTable(path);
  } catch (err) {
    checkTableCacheStats.malformedReports++;
    report(
      `[bootquest] the recorded check table ${path} is MALFORMED (${err instanceof Error ? err.message.split('\n')[0] : String(err)}): ` +
        `uncovered-leg carve-outs are NOT shown on program units until it is fixed (sync refuses it too)`,
    );
  }
  checkTableCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, table });
  return table;
}

/** Table versions whose carve-out computation already failed and was reported (F7: once per version, never per request). */
const reportedCarveOutFailures = new WeakSet<CheckSpecTable>();

/**
 * OPS: honest carve-outs on program units (gh:<repo>:UNN) — the recorded check
 * table's `uncovered_legs` say which acceptance legs the machine check deliberately
 * does NOT cover. Surfaced read-only on GET /units so the player sees what a green
 * check does not prove. Only non-empty lists are returned; a missing/malformed table
 * never breaks unit detail (sync is where table problems are reported).
 *
 * The carve-out is judged against the check that is actually REGISTERED, not just the
 * current table: sync keeps a registered check that attempts reference even when the
 * recorded spec changed (job.ts registerProgram). So when the table names a
 * tsc_project the registered check lacks, the typecheck leg is still reported as
 * uncovered; any other difference between the registered and the recorded spec is
 * reported as "this check predates the current recorded spec".
 *
 * An unexpected failure while judging still never breaks unit detail, but it is reported
 * LOUDLY (once per table version) instead of being swallowed.
 */
export function uncoveredLegsFor(
  checkSpecsPath: string | null,
  unitKey: string,
  check: { spec: CheckSpec } | undefined,
  report: Reporter = consoleReporter,
): string[] | undefined {
  if (checkSpecsPath === null) return undefined;
  const m = /^gh:(.+):(U\d{2})$/.exec(unitKey);
  if (!m) return undefined;
  const all = cachedCheckSpecTable(checkSpecsPath, report);
  if (!all) return undefined;
  try {
    const table = all.repos[m[1]!];
    const rec = table?.units[m[2]!];
    if (!table || !rec) return undefined;
    const legs = [...rec.uncovered_legs];
    const registered = check?.spec;
    if (registered && registered.type === 'node-test-file') {
      if (rec.tsc_project !== undefined && registered.tscProject !== rec.tsc_project) {
        legs.push(
          `${rec.ticket} acceptance 'practice typecheck pass' (tsc -p ${rec.tsc_project}) is NOT covered by this unit's registered check: ` +
            `it predates the tsc composite and stays pinned because attempts reference it (see the sync drift report)`,
        );
      } else {
        const recorded = JSON.stringify(CheckSpec.parse(recordedCheckSpec(m[1]!, table.sha, rec)));
        if (JSON.stringify(CheckSpec.parse(registered)) !== recorded) {
          legs.push(
            `${rec.ticket}: this unit's registered check predates the current recorded check spec and stays pinned because attempts reference it ` +
              `(see the sync drift report); a green result is graded by that older check`,
          );
        }
      }
    }
    return legs.length > 0 ? legs : undefined;
  } catch (err) {
    if (!reportedCarveOutFailures.has(all)) {
      reportedCarveOutFailures.add(all);
      checkTableCacheStats.carveOutErrorReports++;
      report(
        `[bootquest] could not judge the uncovered-leg carve-outs of ${unitKey} against ${checkSpecsPath} ` +
          `(${err instanceof Error ? err.message.split('\n')[0] : String(err)}): carve-outs are NOT shown for affected program units ` +
          `until the table or the registered check is fixed (reported once per table version)`,
      );
    }
    return undefined;
  }
}
