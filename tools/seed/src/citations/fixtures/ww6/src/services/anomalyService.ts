/**
 * What this file does: Detects spend anomalies by comparing service costs against rolling monthly averages.
 * What calls it: `src/app/api/anomalies/route.ts`.
 * What it calls: anomaly/cost repositories and month utilities.
 * Junior pitfall: Computing anomaly thresholds in UI components, making results inconsistent and untestable.
 */
import { createAnomalies, listAnomaliesByMonth } from "@/repositories/anomalyRepository";
import { listAllCostLineItemsByMonth } from "@/repositories/costLineItemRepository";
import { toUtcMonthWindow } from "@/lib/time/month";

export async function detectAnomaliesForMonth(tenantId: string, monthStartIso: string) {
  const window = toUtcMonthWindow(monthStartIso);
  const costItems = await listAllCostLineItemsByMonth(tenantId, window);

  const byService = new Map<string, number[]>();
  for (const item of costItems) {
    const amount = Number(item.amount);
    byService.set(item.service, [...(byService.get(item.service) ?? []), amount]);
  }

  const anomalies = [] as Array<{
    tenantId: string;
    costLineItemId: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    expectedAmount: number;
    actualAmount: number;
    message: string;
  }>;

  for (const item of costItems) {
    const values = byService.get(item.service) ?? [];
    const average = values.reduce((sum, n) => sum + n, 0) / Math.max(values.length, 1);
    const actual = Number(item.amount);

    // ⚠️ SENIOR NOTE: threshold tuning should be externalized over time to avoid hard-coded alert fatigue.
    if (actual <= average * 1.5) {
      continue;
    }

    const ratio = actual / Math.max(average, 0.01);
    const severity: "LOW" | "MEDIUM" | "HIGH" = ratio > 2.5 ? "HIGH" : ratio > 2 ? "MEDIUM" : "LOW";

    anomalies.push({
      tenantId,
      costLineItemId: item.id,
      severity,
      expectedAmount: Number(average.toFixed(2)),
      actualAmount: actual,
      message: `${item.service} cost exceeded historical average by ${ratio.toFixed(2)}x`
    });
  }

  await createAnomalies(anomalies);

  return listAnomaliesByMonth(tenantId, window);
}

export async function getAnomaliesForMonth(tenantId: string, monthStartIso: string) {
  const window = toUtcMonthWindow(monthStartIso);
  return listAnomaliesByMonth(tenantId, window);
}
