/**
 * What this file does: Applies allocation rules to cost line items and computes allocation result rows.
 * What calls it: `src/services/allocationRunService.ts`.
 * What it calls: cost/rule repositories plus month-window utility.
 * Junior pitfall: Ignoring unmatched costs, which makes totals look low and undermines trust in chargeback reports.
 */
import { ConflictError } from "@/lib/http/errors";
import { toUtcMonthWindow } from "@/lib/time/month";
import { listActiveAllocationRules } from "@/repositories/allocationRuleRepository";
import { listAllCostLineItemsByMonth } from "@/repositories/costLineItemRepository";

type ComputedAllocationRow = {
  tenantId: string;
  runId: string;
  costLineItemId: string;
  allocatedTeamId?: string;
  allocatedProjectId?: string;
  allocationPercent: number;
  allocatedAmount: number;
};

function tagsMatch(ruleKey: string, ruleValue: string, tags: Record<string, unknown>) {
  const tagValue = tags[ruleKey];
  return typeof tagValue === "string" && tagValue === ruleValue;
}

export async function computeAllocationResults(
  tenantId: string,
  runId: string,
  monthStartIso: string
): Promise<{ results: ComputedAllocationRow[]; summary: Record<string, unknown> }> {
  const window = toUtcMonthWindow(monthStartIso);
  const [costItems, rules] = await Promise.all([
    listAllCostLineItemsByMonth(tenantId, window),
    listActiveAllocationRules(tenantId)
  ]);

  const results: ComputedAllocationRow[] = [];
  let totalInputAmount = 0;
  let totalAllocatedAmount = 0;
  let unmatchedCount = 0;

  for (const costItem of costItems) {
    const tags = (costItem.tags ?? {}) as Record<string, unknown>;
    const matchingRules = rules.filter((rule) => tagsMatch(rule.matchTagKey, rule.matchTagValue, tags));

    const weightSum = matchingRules.reduce((sum, rule) => sum + Number(rule.weightPercent), 0);

    if (weightSum > 100.0001) {
      // Guard at runtime because invalid rule combinations can still happen after independent rule edits.
      throw new ConflictError(
        `Allocation rule configuration exceeds 100% for cost item ${costItem.id}`
      );
    }

    totalInputAmount += Number(costItem.amount);

    if (matchingRules.length === 0) {
      unmatchedCount += 1;

      if (costItem.projectId) {
        // ⚠️ SENIOR NOTE: explicit fallback allocation avoids unallocated spend that would break budget accountability.
        results.push({
          tenantId,
          runId,
          costLineItemId: costItem.id,
          allocatedProjectId: costItem.projectId,
          allocationPercent: 100,
          allocatedAmount: Number(costItem.amount)
        });
        totalAllocatedAmount += Number(costItem.amount);
      }

      continue;
    }

    for (const rule of matchingRules) {
      const percent = Number(rule.weightPercent);
      const allocatedAmount = (Number(costItem.amount) * percent) / 100;

      results.push({
        tenantId,
        runId,
        costLineItemId: costItem.id,
        allocatedTeamId: rule.targetTeamId ?? undefined,
        allocatedProjectId: rule.targetProjectId ?? undefined,
        allocationPercent: percent,
        allocatedAmount
      });

      totalAllocatedAmount += allocatedAmount;
    }
  }

  return {
    results,
    summary: {
      evaluatedLineItems: costItems.length,
      matchedRules: rules.length,
      unmatchedLineItems: unmatchedCount,
      totalInputAmount,
      totalAllocatedAmount
    }
  };
}
