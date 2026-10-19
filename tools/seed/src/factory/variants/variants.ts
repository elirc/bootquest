/**
 * seed:variants — changed-example retest tasks {task, test, referenceSolution,
 * deliberatelyWrongSolution} for a unit (spec §6.2 (c) / §7).
 *
 * The wrong-solution filter (MANDATORY, spec-verbatim): the test must PASS the
 * reference and FAIL the wrong solution, executed by the REAL runner
 * (harness/harness.ts → the server's drill-js grade adapter; drill-cs and
 * drill-java plug in through the same registry). Otherwise the item is discarded with its reason.
 * No execution = no emission: a check type without a registered runner, a
 * runner crash, or a timeout is a discard, never a pass.
 * Also rejected: a wrong solution that only "fails" by not loading / crashing /
 * timing out (that proves nothing about the test), and wrong === reference.
 */
import { SeedItem, type SeedVariantItem } from '@bootquest/shared';
import { describeFailures, execute, failsAsVerdict, type Harness } from '../harness/harness.ts';
import type { ItemVerdict } from '../quests/validate.ts';
import { normWs } from '../util.ts';

export async function validateVariant(h: Harness, candidate: unknown): Promise<ItemVerdict> {
  const parsed = SeedItem.safeParse(candidate);
  if (!parsed.success) return { verdict: 'reject', reason: `schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  const item = parsed.data;
  if (item.kind !== 'variant') return { verdict: 'reject', reason: `seed:variants cannot emit ${item.kind}` };
  return validateVariantItem(h, item);
}

export async function validateVariantItem(h: Harness, item: SeedVariantItem): Promise<ItemVerdict> {
  if (normWs(item.referenceSolution) === normWs(item.deliberatelyWrongSolution)) {
    return { verdict: 'reject', reason: 'deliberately wrong solution is identical to the reference' };
  }
  const ref = await execute(h, item.check, item.referenceSolution);
  if (!ref.ok) return { verdict: 'reject', reason: `reference not executed: ${ref.reason}` };
  if (!ref.result.pass) return { verdict: 'reject', reason: `the test does not PASS the reference solution under the real runner: ${describeFailures(ref.result)}` };
  const wrong = await execute(h, item.check, item.deliberatelyWrongSolution);
  if (!wrong.ok) return { verdict: 'reject', reason: `wrong solution not executed: ${wrong.reason}` };
  if (wrong.result.pass) return { verdict: 'reject', reason: 'wrong-solution filter: the deliberately wrong solution PASSES the test (the test cannot tell them apart)' };
  const v = failsAsVerdict(wrong.result);
  if (!v.ok) return { verdict: 'reject', reason: `wrong-solution filter: the wrong solution ${v.why} — it must load and fail a named test` };
  return { verdict: 'accept', item };
}
