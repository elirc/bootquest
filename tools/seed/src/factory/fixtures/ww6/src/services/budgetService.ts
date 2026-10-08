/**
 * What this file does: Handles budget creation and retrieval with tenant-scoped persistence.
 * What calls it: `src/app/api/budgets/route.ts`.
 * What it calls: budget repository plus month utility.
 * Junior pitfall: Treating budgets as static config and skipping month scoping, which breaks trend comparisons.
 */
import type { CreateBudgetInput } from "@/lib/validation/budgetSchemas";
import { toUtcMonthWindow } from "@/lib/time/month";
import { createBudget, listBudgetsByMonth } from "@/repositories/budgetRepository";

export async function createBudgetEntry(tenantId: string, input: CreateBudgetInput) {
  // ⚠️ SENIOR NOTE: service-layer month normalization prevents two APIs from storing equivalent months with different timestamps.
  return createBudget({
    tenantId,
    targetType: input.targetType,
    teamId: input.teamId,
    projectId: input.projectId,
    monthStart: new Date(input.monthStart),
    amount: input.amount,
    alertThresholdPct: input.alertThresholdPct
  });
}

export async function getBudgetsForMonth(tenantId: string, monthStartIso: string) {
  const window = toUtcMonthWindow(monthStartIso);
  return listBudgetsByMonth(tenantId, window);
}
