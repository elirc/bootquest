/**
 * What this file does: Produces budget forecasts from recent spend trend and stores monthly snapshots.
 * What calls it: `src/app/api/forecasts/route.ts`.
 * What it calls: forecast/cost repositories and month utility.
 * Junior pitfall: Returning forecasts without persistence, which prevents auditing changes over time.
 */
import { toUtcMonthWindow } from "@/lib/time/month";
import { listAllCostLineItemsByMonth } from "@/repositories/costLineItemRepository";
import { listForecastsByMonth, replaceForecastForMonth } from "@/repositories/forecastRepository";

export async function generateForecastForMonth(tenantId: string, monthStartIso: string) {
  const window = toUtcMonthWindow(monthStartIso);
  const costs = await listAllCostLineItemsByMonth(tenantId, window);

  // ⚠️ SENIOR NOTE: simple-growth is intentionally naive; production models should separate seasonality and one-off spikes.
  const total = costs.reduce((sum, item) => sum + Number(item.amount), 0);
  const predictedTotal = total * 1.08;
  const confidenceLow = predictedTotal * 0.9;
  const confidenceHigh = predictedTotal * 1.15;

  await replaceForecastForMonth({
    tenantId,
    monthStart: window.monthStart,
    predictedTotal,
    confidenceLow,
    confidenceHigh,
    method: "simple-growth-8pct"
  });

  return listForecastsByMonth(tenantId, window);
}

export async function getForecastForMonth(tenantId: string, monthStartIso: string) {
  const window = toUtcMonthWindow(monthStartIso);
  return listForecastsByMonth(tenantId, window);
}
