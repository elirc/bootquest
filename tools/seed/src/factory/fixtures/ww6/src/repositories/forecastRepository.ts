/**
 * What this file does: Persists generated forecasts by tenant and month.
 * What calls it: `src/services/forecastService.ts`.
 * What it calls: Prisma `forecast` model operations.
 * Junior pitfall: Regenerating forecasts without replacing old month records, producing duplicate insights.
 */
import { db } from "@/lib/db";
import type { MonthWindow } from "@/types/domain";

type CreateForecastInput = {
  tenantId: string;
  monthStart: Date;
  predictedTotal: number;
  method: string;
  confidenceLow: number;
  confidenceHigh: number;
};

export async function replaceForecastForMonth(input: CreateForecastInput) {
  // ⚠️ SENIOR NOTE: delete+create can race under concurrent workers; a unique constraint + upsert is safer at scale.
  await db.forecast.deleteMany({
    where: {
      // Delete is tenant-scoped so we never erase another org's forecast snapshot.
      tenantId: input.tenantId,
      monthStart: input.monthStart
    }
  });

  return db.forecast.create({
    data: input
  });
}

export async function listForecastsByMonth(tenantId: string, window: MonthWindow) {
  return db.forecast.findMany({
    where: {
      // Tenant filter is required because forecasting can reveal spend trajectory and business strategy.
      tenantId,
      monthStart: {
        gte: window.monthStart,
        lt: window.monthEnd
      }
    },
    orderBy: [{ monthStart: "asc" }]
  });
}
