/**
 * What this file does: Stores anomaly detections for tenant-scoped operational review.
 * What calls it: `src/services/anomalyService.ts`.
 * What it calls: Prisma `anomaly` model operations.
 * Junior pitfall: Duplicating anomalies every run without idempotent cleanup strategy.
 */
import { db } from "@/lib/db";
import type { AnomalySeverity } from "@prisma/client";
import type { MonthWindow } from "@/types/domain";

type CreateAnomalyInput = {
  tenantId: string;
  costLineItemId: string;
  severity: AnomalySeverity;
  expectedAmount: number;
  actualAmount: number;
  message: string;
};

export async function createAnomalies(inputs: CreateAnomalyInput[]) {
  if (inputs.length === 0) {
    return { count: 0 };
  }

  // ⚠️ SENIOR NOTE: bulk insert keeps anomaly writes efficient and avoids per-row transaction overhead.
  return db.anomaly.createMany({
    data: inputs
  });
}

export async function listAnomaliesByMonth(tenantId: string, window: MonthWindow) {
  return db.anomaly.findMany({
    where: {
      // Tenant scoping prevents a high-severity anomaly leak between organizations.
      tenantId,
      detectedAt: {
        gte: window.monthStart,
        lt: window.monthEnd
      }
    },
    include: {
      costItem: true
    },
    orderBy: [{ detectedAt: "desc" }]
  });
}
