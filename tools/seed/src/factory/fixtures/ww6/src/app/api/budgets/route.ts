/**
 * What this file does: Creates and lists budget targets by month.
 * What calls it: Budget management UI views.
 * What it calls: `withRole`, budget schema validation, and budget service.
 * Junior pitfall: Using same role gate for read and write paths; writes should be stricter.
 */
import { NextResponse } from "next/server";
import { withRole } from "@/lib/middleware/withRole";
import { createBudgetSchema } from "@/lib/validation/budgetSchemas";
import { createBudgetEntry, getBudgetsForMonth } from "@/services/budgetService";

function currentMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export const GET = withRole("readReports", async (request, auth) => {
  const monthStart = request.nextUrl.searchParams.get("monthStart") ?? currentMonthStartIso();
  const budgets = await getBudgetsForMonth(auth.tenantId, monthStart);
  return NextResponse.json({ items: budgets });
});

export const POST = withRole("manageBudgets", async (request, auth) => {
  // ⚠️ SENIOR NOTE: TEAM_MANAGER can write budgets, but this should eventually enforce team ownership checks too.
  const payload = createBudgetSchema.parse(await request.json());
  const budget = await createBudgetEntry(auth.tenantId, payload);
  return NextResponse.json({ item: budget }, { status: 201 });
});
